import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Subscription(Base):
    """
    Mirrors the state of a Stripe Subscription object for one user. This is
    a cache/audit trail, not the source of truth — Stripe is. It exists so
    we can query "is this user currently paying" without calling the Stripe
    API on every request, and so support has a local record of billing
    history even if the Stripe dashboard is unavailable.

    Kept in sync exclusively by the webhook handler (app/services/billing.py)
    reacting to checkout.session.completed / customer.subscription.updated /
    customer.subscription.deleted / invoice.payment_failed events. Nothing
    else should write to this table.
    """
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )

    stripe_customer_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    stripe_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    plan: Mapped[str] = mapped_column(String(20), default="free", nullable=False)  # free|pro|business|enterprise
    # Mirrors Stripe subscription.status: trialing|active|past_due|canceled|
    # unpaid|incomplete|incomplete_expired|paused
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)

    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user = relationship("User", back_populates="subscription")
