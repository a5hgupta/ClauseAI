import logging

import stripe as stripe_sdk
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user, limiter
from app.models.user import User
from app.models.subscription import Subscription
from app.schemas.billing import CheckoutRequest, CheckoutSessionOut, PortalSessionOut, SubscriptionOut
from app.services import billing

logger = logging.getLogger("clauseiq.billing")

router = APIRouter(prefix="/billing", tags=["billing"])

_ALLOWED_PLANS = {"pro", "business"}


@router.get("/subscription", response_model=SubscriptionOut)
def get_subscription(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    if sub is None:
        # No billing interaction yet — user is on the free plan by default,
        # no Stripe customer needed until they try to upgrade.
        return SubscriptionOut(plan="free", status="active", current_period_end=None, cancel_at_period_end=False)
    return sub


@router.post("/checkout", response_model=CheckoutSessionOut)
@limiter.limit("10/minute")
def create_checkout(
    request: Request,
    body: CheckoutRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.plan not in _ALLOWED_PLANS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"plan must be one of {_ALLOWED_PLANS}")
    try:
        url = billing.create_checkout_session(user, body.plan, db)
    except billing.BillingError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return CheckoutSessionOut(checkout_url=url)


@router.post("/portal", response_model=PortalSessionOut)
@limiter.limit("10/minute")
def create_portal(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        url = billing.create_portal_session(user, db)
    except billing.BillingError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return PortalSessionOut(portal_url=url)


@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Stripe calls this directly — no auth dependency (Stripe doesn't have our
    JWT), no rate limiting (Stripe's own retry behavior handles delivery,
    and rate-limiting a webhook risks silently dropping billing events).
    Trust boundary is entirely the signature check below: the raw body must
    be read before any JSON parsing, since the signature is computed over
    the exact bytes Stripe sent.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = billing.construct_event(payload, sig_header)
    except billing.BillingError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except stripe_sdk.error.SignatureVerificationError:
        logger.warning("billing: webhook signature verification failed")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")

    try:
        billing.handle_event(event, db)
    except Exception:
        # Return 500 so Stripe retries with backoff rather than marking the
        # event as delivered when we failed to apply it.
        logger.exception("billing: failed to process webhook event %s", event.get("id"))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Webhook processing failed")

    return {"received": True}
