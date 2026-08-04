import uuid
from pydantic import BaseModel, field_validator


class SearchRequest(BaseModel):
    query: str
    contract_ids: list[uuid.UUID] | None = None  # None = search across all of the user's ready contracts
    top_k: int = 6

    @field_validator("query")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Query cannot be empty")
        if len(v) > 2000:
            raise ValueError("Query too long (max 2000 characters)")
        return v

    @field_validator("top_k")
    @classmethod
    def clamp_top_k(cls, v: int) -> int:
        return max(1, min(v, 20))


class SearchResultOut(BaseModel):
    contract_id: uuid.UUID
    contract_name: str
    chunk_id: uuid.UUID
    chunk_index: int
    content: str
    char_start: int
    char_end: int
    score: float


class SearchResponseOut(BaseModel):
    query: str
    results: list[SearchResultOut]
