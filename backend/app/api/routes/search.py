from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user, limiter
from app.models.user import User
from app.models.contract import Contract
from app.schemas.search import SearchRequest, SearchResponseOut, SearchResultOut
from app.services import retrieval

router = APIRouter(prefix="/search", tags=["search"])


@router.post("", response_model=SearchResponseOut)
@limiter.limit("30/minute")
def semantic_search(request: Request, body: SearchRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Multi-document semantic search across the caller's own contracts
    (optionally scoped to a subset via contract_ids). Ownership is enforced
    inside retrieval.retrieve_multi via a join on Contract.user_id — a
    contract_id belonging to another user simply returns no rows, never an
    error that would confirm its existence."""
    if body.contract_ids:
        owned_count = (
            db.query(Contract.id)
            .filter(Contract.user_id == user.id, Contract.id.in_(body.contract_ids))
            .count()
        )
        if owned_count == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No matching contracts found")

    try:
        results = retrieval.retrieve_multi(db, user.id, body.query, body.contract_ids, body.top_k)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Search failed: {exc}")

    return SearchResponseOut(
        query=body.query,
        results=[
            SearchResultOut(
                contract_id=r.contract_id,
                contract_name=r.contract_name,
                chunk_id=r.chunk_id,
                chunk_index=r.chunk_index,
                content=r.content,
                char_start=r.char_start,
                char_end=r.char_end,
                score=r.score,
            )
            for r in results
        ],
    )
