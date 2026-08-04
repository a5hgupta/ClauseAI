import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class AdminActionLog(Base):
    """Accountability trail for admin-performed changes to other users'
    accounts (role/plan/active-status changes, deletions). Scoped narrowly
    to admin user-management actions — not a general API audit log."""

    __tablename__ = "admin_action_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # target_email is captured redundantly at write time so the log stays
    # readable even after the target user row is deleted (FK above goes NULL).
    target_email: Mapped[str] = mapped_column(String(255), nullable=False)

    action: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "update_role", "update_plan", "suspend", "reactivate", "delete_user"
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)  # e.g. {"from": "user", "to": "admin"}

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    admin = relationship("User", foreign_keys=[admin_id])
