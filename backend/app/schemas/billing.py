from datetime import datetime

from pydantic import BaseModel


class CheckoutRequest(BaseModel):
    plan: str  # "pro" | "business"


class CheckoutSessionOut(BaseModel):
    checkout_url: str


class PortalSessionOut(BaseModel):
    portal_url: str


class SubscriptionOut(BaseModel):
    plan: str
    status: str
    current_period_end: datetime | None
    cancel_at_period_end: bool

    model_config = {"from_attributes": True}
