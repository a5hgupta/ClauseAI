"""
Stripe integration. Stripe remains the source of truth for subscription
state; the local `subscriptions` table (and User.plan, kept for fast
plan-gating checks elsewhere in the app) are a cache that this module keeps
in sync via webhook events. Nothing outside this module should call the
Stripe SDK directly or write to Subscription.plan / User.plan for billing
reasons.
"""
import logging

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User
from app.models.subscription import Subscription

logger = logging.getLogger("clauseiq.billing")

stripe.api_key = settings.STRIPE_SECRET_KEY


class BillingError(Exception):
    """Raised for billing operations that fail in an expected, user-facing way."""


def _require_configured() -> None:
    if not settings.STRIPE_SECRET_KEY:
        raise BillingError("Billing is not configured on this server yet.")


def _plan_to_price_id(plan: str) -> str:
    mapping = {
        "pro": settings.STRIPE_PRICE_ID_PRO,
        "business": settings.STRIPE_PRICE_ID_BUSINESS,
    }
    price_id = mapping.get(plan)
    if not price_id:
        raise BillingError(f"Unknown or unconfigured plan: {plan!r}")
    return price_id


def get_or_create_subscription_row(user: User, db: Session) -> Subscription:
    """Every user gets a Subscription row lazily, on first billing interaction —
    not at signup — so free users who never touch billing don't need a Stripe
    customer created for them until they actually do something billing-related."""
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    if sub:
        return sub

    _require_configured()
    customer = stripe.Customer.create(email=user.email, name=user.name, metadata={"user_id": str(user.id)})
    sub = Subscription(user_id=user.id, stripe_customer_id=customer.id, plan="free", status="active")
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def create_checkout_session(user: User, plan: str, db: Session) -> str:
    _require_configured()
    price_id = _plan_to_price_id(plan)
    sub = get_or_create_subscription_row(user, db)

    session = stripe.checkout.Session.create(
        customer=sub.stripe_customer_id,
        mode="subscription",
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=settings.billing_success_url,
        cancel_url=settings.billing_cancel_url,
        client_reference_id=str(user.id),
        subscription_data={"metadata": {"user_id": str(user.id)}},
        allow_promotion_codes=True,
    )
    return session.url


def create_portal_session(user: User, db: Session) -> str:
    """Stripe's hosted Billing Portal — lets the user update card details,
    change plan, view invoices, or cancel, without us building any of that
    UI ourselves."""
    _require_configured()
    sub = get_or_create_subscription_row(user, db)
    if not sub.stripe_customer_id:
        raise BillingError("No billing account found for this user yet.")

    portal = stripe.billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=settings.FRONTEND_URL + "/billing",
    )
    return portal.url


def construct_event(payload: bytes, sig_header: str) -> stripe.Event:
    """Verifies the webhook signature. Raises stripe.error.SignatureVerificationError
    on tampering/misconfiguration — the route layer turns that into a 400."""
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise BillingError("Webhook secret is not configured on this server.")
    return stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)


def _sub_by_customer(db: Session, customer_id: str) -> Subscription | None:
    return db.query(Subscription).filter(Subscription.stripe_customer_id == customer_id).one_or_none()


def _apply_plan_to_user(db: Session, sub: Subscription) -> None:
    """Keeps User.plan (used everywhere else in the app for quick plan checks)
    in sync with the Subscription row. A canceled/unpaid subscription always
    drops the user back to "free", never leaves them on a stale paid plan."""
    user = db.get(User, sub.user_id)
    if user is None:
        return
    user.plan = sub.plan if sub.status in ("active", "trialing") else "free"
    db.add(user)


def handle_event(event: stripe.Event, db: Session) -> None:
    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data, db)
    elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
        _handle_subscription_updated(data, db)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data, db)
    elif event_type == "invoice.payment_failed":
        _handle_payment_failed(data, db)
    else:
        logger.info("billing: ignoring unhandled Stripe event type %s", event_type)
        return

    db.commit()


def _handle_checkout_completed(data: dict, db: Session) -> None:
    customer_id = data.get("customer")
    subscription_id = data.get("subscription")
    sub = _sub_by_customer(db, customer_id)
    if sub is None:
        logger.error("billing: checkout.session.completed for unknown customer %s", customer_id)
        return
    sub.stripe_subscription_id = subscription_id
    # Plan/status/period end are set precisely by the subscription.updated
    # event that Stripe fires immediately after this one — this handler just
    # links the subscription ID so we don't have to guess the price here.
    db.add(sub)


def _handle_subscription_updated(data: dict, db: Session) -> None:
    customer_id = data.get("customer")
    sub = _sub_by_customer(db, customer_id)
    if sub is None:
        logger.error("billing: subscription.updated for unknown customer %s", customer_id)
        return

    sub.stripe_subscription_id = data.get("id")
    sub.status = data.get("status", sub.status)
    sub.cancel_at_period_end = bool(data.get("cancel_at_period_end"))

    items = data.get("items", {}).get("data", [])
    if items:
        price_id = items[0]["price"]["id"]
        sub.stripe_price_id = price_id
        sub.plan = settings.stripe_price_to_plan.get(price_id, sub.plan)

    period_end = data.get("current_period_end")
    if period_end:
        from datetime import datetime, timezone
        sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)

    db.add(sub)
    _apply_plan_to_user(db, sub)


def _handle_subscription_deleted(data: dict, db: Session) -> None:
    customer_id = data.get("customer")
    sub = _sub_by_customer(db, customer_id)
    if sub is None:
        return
    sub.status = "canceled"
    sub.plan = "free"
    sub.cancel_at_period_end = False
    db.add(sub)
    _apply_plan_to_user(db, sub)


def _handle_payment_failed(data: dict, db: Session) -> None:
    customer_id = data.get("customer")
    sub = _sub_by_customer(db, customer_id)
    if sub is None:
        return
    # Don't immediately downgrade — Stripe's dunning/retry schedule handles
    # this, and the subscription.updated event will carry status="past_due".
    # This handler exists mainly as a hook for sending a "payment failed"
    # email, which isn't wired yet — see note in billing route.
    logger.warning("billing: payment failed for customer %s", customer_id)
