"""phase 3: richer analysis output — doc type, multi-level summary/explanations,
obligations, key dates, per-clause dispute signal.

The frontend (ClauseIQ artifact) was built against a richer analysis shape
than Phase 2 stored: a summary/explanation pitched at three reading levels
(simple / intermediate / lawStudent), extracted obligations and key dates,
and a dispute-likelihood signal per clause. Rather than dumb the frontend
down to the old shape, this migration extends storage to match — the AI
service and pipeline are updated in the same change to populate it.

`summary` and `clauses.explanation` move from a single TEXT value to JSONB
holding all three reading levels. Existing rows (if any) are wrapped so a
downgrade/upgrade cycle on a populated table doesn't lose data outright,
though the "intermediate"/"lawStudent" levels obviously won't exist for
pre-migration rows until the contract is re-analyzed.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-01

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- analyses: doc_type, obligations, key_dates; summary -> JSONB ---
    op.add_column("analyses", sa.Column("doc_type", sa.String(255), nullable=True))
    op.add_column(
        "analyses",
        sa.Column("obligations", postgresql.JSONB, nullable=False, server_default="[]"),
    )
    op.add_column(
        "analyses",
        sa.Column("key_dates", postgresql.JSONB, nullable=False, server_default="[]"),
    )
    op.execute(
        "ALTER TABLE analyses "
        "ALTER COLUMN summary TYPE JSONB USING "
        "jsonb_build_object('simple', summary, 'intermediate', summary, 'lawStudent', summary)"
    )

    # --- clauses: dispute signal; explanation -> JSONB ---
    op.add_column("clauses", sa.Column("dispute_likelihood", sa.String(10), nullable=True))
    op.add_column("clauses", sa.Column("dispute_reason", sa.Text, nullable=True))
    op.execute(
        "ALTER TABLE clauses "
        "ALTER COLUMN explanation TYPE JSONB USING "
        "jsonb_build_object('simple', explanation, 'intermediate', explanation, 'lawStudent', explanation)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE clauses ALTER COLUMN explanation TYPE TEXT USING explanation->>'simple'")
    op.drop_column("clauses", "dispute_reason")
    op.drop_column("clauses", "dispute_likelihood")

    op.execute("ALTER TABLE analyses ALTER COLUMN summary TYPE TEXT USING summary->>'simple'")
    op.drop_column("analyses", "key_dates")
    op.drop_column("analyses", "obligations")
    op.drop_column("analyses", "doc_type")
