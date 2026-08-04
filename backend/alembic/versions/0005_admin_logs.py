"""phase 3: admin/user management — admin_action_logs table.

Backs the new admin endpoints (list/update/suspend/delete users) with an
accountability trail: every admin-performed change to another user's
account is recorded here, independent of that user's own row (so the log
survives even if the target account is later deleted).

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_action_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "admin_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "target_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("target_email", sa.String(255), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("detail", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_admin_action_logs_admin_id", "admin_action_logs", ["admin_id"])
    op.create_index("ix_admin_action_logs_target_user_id", "admin_action_logs", ["target_user_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_action_logs_target_user_id", table_name="admin_action_logs")
    op.drop_index("ix_admin_action_logs_admin_id", table_name="admin_action_logs")
    op.drop_table("admin_action_logs")
