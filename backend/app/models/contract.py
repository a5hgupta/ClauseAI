import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, BigInteger, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))

    name: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(10), nullable=False)  # pdf|docx|doc|png|jpg
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    storage_backend: Mapped[str] = mapped_column(String(10), nullable=False)  # local|s3
    storage_key: Mapped[str] = mapped_column(String(1000), nullable=False)

    # queued -> extracting -> analyzing -> ready -> failed
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    status_detail: Mapped[str | None] = mapped_column(String(500), nullable=True)

    raw_text: Mapped[str | None] = mapped_column(nullable=True)  # populated by extraction in Phase 2

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="contracts")
    analyses = relationship("Analysis", back_populates="contract", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="contract", cascade="all, delete-orphan")
    chunks = relationship(
        "DocumentChunk", back_populates="contract", cascade="all, delete-orphan", order_by="DocumentChunk.chunk_index"
    )
