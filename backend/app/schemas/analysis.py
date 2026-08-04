import uuid
from datetime import datetime
from pydantic import BaseModel, field_validator


class LevelText(BaseModel):
    """Same content pitched at three reading levels."""
    simple: str = ""
    intermediate: str = ""
    lawStudent: str = ""


class ClauseOut(BaseModel):
    id: uuid.UUID
    title: str
    category: str
    risk_level: str
    excerpt: str
    explanation: LevelText
    dispute_likelihood: str | None = None
    dispute_reason: str | None = None
    position: int

    model_config = {"from_attributes": True}


class ObligationOut(BaseModel):
    party: str
    obligation: str


class KeyDateOut(BaseModel):
    label: str
    date: str | None = None
    note: str = ""


class AnalysisOut(BaseModel):
    id: uuid.UUID
    doc_type: str | None = None
    risk_score: int
    summary: LevelText
    categories: dict
    missing_clauses: list
    obligations: list[ObligationOut] = []
    key_dates: list[KeyDateOut] = []
    model_used: str
    created_at: datetime
    clauses: list[ClauseOut]

    model_config = {"from_attributes": True}


class RewriteRequest(BaseModel):
    tone: str = "balanced"  # tenant-friendly | balanced | aggressive-negotiation


class RewriteOut(BaseModel):
    rewritten_text: str
    rationale: str


class NegotiationOut(BaseModel):
    suggestions: list[str]


class CompareRequest(BaseModel):
    contract_ids: list[uuid.UUID]

    @field_validator("contract_ids")
    @classmethod
    def two_to_three(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        if not (2 <= len(v) <= 3):
            raise ValueError("Provide between 2 and 3 contract IDs to compare")
        if len(set(v)) != len(v):
            raise ValueError("Duplicate contract IDs")
        return v


class CompareRowOut(BaseModel):
    topic: str
    flag: str  # "risk" | "neutral" | "favorable"
    values: list[str]


class CompareMissingOut(BaseModel):
    topic: str
    presentIn: list[str]
    missingIn: list[str]


class CompareOut(BaseModel):
    summary: str
    rows: list[CompareRowOut]
    missing: list[CompareMissingOut] = []


class BenchmarkRowOut(BaseModel):
    topic: str
    thisContract: str
    typical: str
    flag: str  # "worse" | "typical" | "better"


class BenchmarkOut(BaseModel):
    disclaimer: str
    rows: list[BenchmarkRowOut]
