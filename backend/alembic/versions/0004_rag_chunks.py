"""phase 3: RAG — pgvector extension + document_chunks table.

Adds the retrieval layer that was deferred out of Phase 2 (see the
MAX_CHAT_CONTEXT_CHARS comment in config.py: "RAG chunking arrives Phase 3").
Chat and search now retrieve semantically relevant chunks instead of
truncating the full contract text, and can attach citations back to an exact
character range in the source document.

Requires the Postgres server to have the `vector` extension available —
the docker-compose `db` image is switched to `pgvector/pgvector:pg16` in
this same change. On a self-managed Postgres, install pgvector first
(https://github.com/pgvector/pgvector#installation).

An HNSW index is used (not IVFFlat) because it doesn't need a representative
sample of data to "train" on at creation time — safe to create on an empty
table, which is the state of any fresh deployment running this migration.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

from app.core.config import settings

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "document_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "contract_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contracts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("char_start", sa.Integer, nullable=False),
        sa.Column("char_end", sa.Integer, nullable=False),
        sa.Column("embedding", Vector(settings.EMBEDDING_DIM), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_document_chunks_contract_id", "document_chunks", ["contract_id"])
    op.execute(
        "CREATE INDEX ix_document_chunks_embedding_hnsw ON document_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw")
    op.drop_index("ix_document_chunks_contract_id", table_name="document_chunks")
    op.drop_table("document_chunks")
    # Deliberately not dropping the `vector` extension — other objects/DBs on
    # the same Postgres instance may depend on it.
