"""
Semantic retrieval over indexed contract chunks (pgvector cosine search).

Two entry points:
- retrieve_for_contract: single-document retrieval, used by chat.
- retrieve_multi: search across every ready, indexed contract a user owns,
  used by the standalone /search endpoint. Ownership is always enforced via
  a join against contracts.user_id — callers never pass an unscoped query.
"""
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.chunk import DocumentChunk
from app.models.contract import Contract
from app.services.embeddings import embed_query


@dataclass
class RetrievedChunk:
    chunk_id: uuid.UUID
    contract_id: uuid.UUID
    contract_name: str
    chunk_index: int
    content: str
    char_start: int
    char_end: int
    score: float  # cosine similarity, 1.0 = identical, higher = more relevant


def _rows_to_results(rows) -> list[RetrievedChunk]:
    results = []
    for chunk, contract_name, distance in rows:
        results.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                contract_id=chunk.contract_id,
                contract_name=contract_name,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                char_start=chunk.char_start,
                char_end=chunk.char_end,
                # pgvector's cosine_distance = 1 - cosine_similarity for normalized vectors.
                score=round(1 - float(distance), 4),
            )
        )
    return results


def retrieve_for_contract(
    db: Session, contract_id: uuid.UUID, query: str, top_k: int | None = None
) -> list[RetrievedChunk]:
    top_k = top_k or settings.RAG_TOP_K
    query_vector = embed_query(query)

    distance = DocumentChunk.embedding.cosine_distance(query_vector)
    rows = db.execute(
        select(DocumentChunk, Contract.name, distance.label("distance"))
        .join(Contract, Contract.id == DocumentChunk.contract_id)
        .where(DocumentChunk.contract_id == contract_id)
        .order_by(distance)
        .limit(top_k)
    ).all()
    return _rows_to_results(rows)


def retrieve_multi(
    db: Session, user_id: uuid.UUID, query: str, contract_ids: list[uuid.UUID] | None = None, top_k: int | None = None
) -> list[RetrievedChunk]:
    top_k = top_k or settings.RAG_TOP_K
    query_vector = embed_query(query)

    distance = DocumentChunk.embedding.cosine_distance(query_vector)
    stmt = (
        select(DocumentChunk, Contract.name, distance.label("distance"))
        .join(Contract, Contract.id == DocumentChunk.contract_id)
        .where(Contract.user_id == user_id)  # ownership enforced here, not left to the caller
    )
    if contract_ids:
        stmt = stmt.where(DocumentChunk.contract_id.in_(contract_ids))
    stmt = stmt.order_by(distance).limit(top_k)

    rows = db.execute(stmt).all()
    return _rows_to_results(rows)


def index_contract(db: Session, contract_id: uuid.UUID, raw_text: str) -> int:
    """(Re-)chunks and embeds a contract's raw text, replacing any existing
    chunks. Returns the number of chunks written. Safe to call from the
    pipeline task after every successful extraction, including reanalysis."""
    from app.services.chunking import chunk_text
    from app.services.embeddings import embed_texts

    db.query(DocumentChunk).filter(DocumentChunk.contract_id == contract_id).delete()

    pieces = chunk_text(raw_text)
    if not pieces:
        db.flush()
        return 0

    vectors = embed_texts([p.content for p in pieces])
    for piece, vector in zip(pieces, vectors):
        db.add(
            DocumentChunk(
                contract_id=contract_id,
                chunk_index=piece.index,
                content=piece.content,
                char_start=piece.char_start,
                char_end=piece.char_end,
                embedding=vector,
            )
        )
    db.flush()
    return len(pieces)
