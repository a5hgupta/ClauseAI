import uuid

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.db.session import get_db
from app.core.deps import get_current_user, limiter
from app.models.user import User
from app.models.contract import Contract
from app.models.analysis import Analysis
from app.schemas.contract import ContractOut, ContractListOut
from app.schemas.analysis import AnalysisOut, CompareRequest, CompareOut, BenchmarkOut
from app.services.storage import get_storage, validate_upload
from app.services import ai_service
from app.core.config import settings
from app.tasks.pipeline import process_contract

router = APIRouter(prefix="/contracts", tags=["contracts"])


def _get_owned_contract(db: Session, contract_id: uuid.UUID, user: User) -> Contract:
    contract = db.get(Contract, contract_id)
    # Row-level ownership check — never trust contract_id from the client
    # alone. 404 (not 403) so we don't confirm existence of other users' data.
    if not contract or contract.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    return contract


@router.post("", response_model=ContractOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def upload_contract(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await file.read()
    ext = validate_upload(file, len(data))

    storage = get_storage()
    key = storage.save(str(user.id), ext, data)

    contract = Contract(
        user_id=user.id,
        name=file.filename or "Untitled contract",
        original_filename=file.filename or "upload",
        file_type=ext,
        size_bytes=len(data),
        storage_backend=settings.STORAGE_BACKEND,
        storage_key=key,
        status="queued",
        status_detail="Waiting for an extraction worker",
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)

    process_contract.delay(str(contract.id))

    return contract


@router.get("", response_model=ContractListOut)
def list_contracts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    total = db.scalar(select(func.count()).select_from(Contract).where(Contract.user_id == user.id))
    items = db.scalars(
        select(Contract)
        .where(Contract.user_id == user.id)
        .order_by(Contract.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ContractListOut(total=total or 0, items=list(items))


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_owned_contract(db, contract_id, user)


@router.delete("/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contract(contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    contract = _get_owned_contract(db, contract_id, user)
    storage = get_storage()
    try:
        storage.delete(contract.storage_key)
    except FileNotFoundError:
        pass
    db.delete(contract)
    db.commit()
    return None


@router.post("/{contract_id}/reanalyze", response_model=ContractOut)
@limiter.limit("10/minute")
def reanalyze_contract(
    request: Request, contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    contract = _get_owned_contract(db, contract_id, user)
    if contract.status in ("queued", "extracting", "analyzing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract is already processing")
    contract.status = "queued"
    contract.status_detail = "Re-analysis requested"
    db.commit()
    db.refresh(contract)
    process_contract.delay(str(contract.id))
    return contract


@router.get("/{contract_id}/analysis", response_model=AnalysisOut)
def get_analysis(contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    contract = _get_owned_contract(db, contract_id, user)
    latest = db.scalar(
        select(Analysis).where(Analysis.contract_id == contract.id).order_by(Analysis.created_at.desc())
    )
    if not latest:
        detail = "Analysis not ready yet" if contract.status != "failed" else (contract.status_detail or "Analysis failed")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return latest


@router.post("/compare", response_model=CompareOut)
@limiter.limit("10/minute")
def compare_contracts(
    request: Request, body: CompareRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    contracts = [_get_owned_contract(db, cid, user) for cid in body.contract_ids]

    for c in contracts:
        if not c.raw_text:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Contract '{c.name}' hasn't finished processing yet",
            )

    try:
        result = ai_service.compare_contracts([(c.name, c.raw_text) for c in contracts])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI comparison failed: {exc}")

    return result


@router.post("/{contract_id}/benchmark", response_model=BenchmarkOut)
@limiter.limit("10/minute")
def benchmark_contract(
    request: Request, contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    contract = _get_owned_contract(db, contract_id, user)
    if not contract.raw_text:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract hasn't finished processing yet")

    latest = db.scalar(
        select(Analysis).where(Analysis.contract_id == contract.id).order_by(Analysis.created_at.desc())
    )
    doc_type = latest.doc_type if latest else None

    try:
        result = ai_service.benchmark_contract(doc_type or "contract", contract.raw_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI benchmark failed: {exc}")

    return result
