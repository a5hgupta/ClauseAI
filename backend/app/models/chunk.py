import uuid
from datetime import datetime

from sqlalchemy import Integer, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.db.session import Base
from app.core.config import settings


class DocumentChunk(Base):
    """One retrievable slice of a contract's extracted text, embedded for
    semantic search (RAG). Populated by the indexing step of the Celery
    pipeline right after text extraction succeeds — independent of and in
    addition to the full-document AI analysis, which still runs over the
    complete raw_text for the highest-quality single-pass summary.

    Re-processing a contract (reanalyze) deletes and recreates all of its
    chunks so search/chat citations never point at stale text.
    """

    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), index=True
    )

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding: Mapped[list] = mapped_column(Vector(settings.EMBEDDING_DIM), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    contract = relationship("Contract", back_populates="chunks")
