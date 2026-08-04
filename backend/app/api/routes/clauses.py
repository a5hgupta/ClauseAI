import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.session import get_db
from app.core.deps import get_current_user, limiter
from app.models.user import User
from app.models.analysis import Clause, Analysis
from app.models.contract import Contract
from app.schemas.analysis import RewriteRequest, RewriteOut, NegotiationOut
from app.services import ai_service

router = APIRouter(prefix="/clauses", tags=["clauses"])

ALLOWED_TONES = {"tenant-friendly", "balanced", "aggressive-negotiation"}


def _get_owned_clause(db: Session, clause_id: uuid.UUID, user: User) -> Clause:
    clause = db.get(Clause, clause_id)
    if not clause:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clause not found")
    # Ownership check walks clause -> analysis -> contract -> user.
    analysis = db.get(Analysis, clause.analysis_id)
    contract = db.get(Contract, analysis.contract_id) if analysis else None
    if not contract or contract.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clause not found")
    return clause


@router.post("/{clause_id}/rewrite", response_model=RewriteOut)
@limiter.limit("20/minute")
def rewrite_clause(
    request: Request,
    clause_id: uuid.UUID,
    body: RewriteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    clause = _get_owned_clause(db, clause_id, user)
    tone = body.tone if body.tone in ALLOWED_TONES else "balanced"

    try:
        result = ai_service.rewrite_clause(clause.excerpt, tone)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI rewrite failed: {exc}")
    return result


@router.post("/{clause_id}/negotiation", response_model=NegotiationOut)
@limiter.limit("20/minute")
def negotiation_suggestions(
    request: Request, clause_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    clause = _get_owned_clause(db, clause_id, user)
    try:
        result = ai_service.negotiation_suggestions(clause.excerpt)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI suggestion failed: {exc}")
    return result
