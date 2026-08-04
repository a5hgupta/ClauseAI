import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Analysis(Base):
    """One row per completed analysis run of a contract. Re-running analysis
    (e.g. after a re-upload) creates a new row rather than overwriting —
    keeps a history and makes 'model_used' auditable."""
    __tablename__ = "analyses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"))

    doc_type: Mapped[str | None] = mapped_column(String(255), nullable=True)  # e.g. "Rental Agreement"
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-100
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {"simple": "...", "intermediate": "...", "lawStudent": "..."}
    categories: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)  # e.g. {"financial": 0-100, ...}
    missing_clauses: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    obligations: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # [{"party": ..., "obligation": ...}]
    key_dates: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)  # [{"label": ..., "date": iso|None, "note": ...}]
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    contract = relationship("Contract", back_populates="analyses")
    clauses = relationship(
        "Clause", back_populates="analysis", cascade="all, delete-orphan", order_by="Clause.position"
    )


class Clause(Base):
    __tablename__ = "clauses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="CASCADE"))

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    risk_level: Mapped[str] = mapped_column(String(10), nullable=False)  # low|medium|high
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)  # verbatim snippet from the contract
    explanation: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {"simple": ..., "intermediate": ..., "lawStudent": ...}
    dispute_likelihood: Mapped[str | None] = mapped_column(String(10), nullable=True)  # low|medium|high|None
    dispute_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # ordering / rough location

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    analysis = relationship("Analysis", back_populates="clauses")
