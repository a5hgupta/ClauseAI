import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func, or_

from app.db.session import get_db
from app.core.deps import require_admin, limiter
from app.models.user import User
from app.models.contract import Contract
from app.models.chat import ChatSession
from app.models.token import RefreshToken
from app.models.admin_log import AdminActionLog
from app.schemas.user import AdminUserOut, AdminUserListOut, AdminUpdateUserRequest, AdminStatsOut

router = APIRouter(prefix="/admin", tags=["admin"])


def _to_admin_user_out(db: Session, user: User) -> AdminUserOut:
    contract_count = db.scalar(select(func.count()).select_from(Contract).where(Contract.user_id == user.id)) or 0
    chat_count = db.scalar(select(func.count()).select_from(ChatSession).where(ChatSession.user_id == user.id)) or 0
    return AdminUserOut(
        id=user.id, email=user.email, name=user.name, role=user.role, plan=user.plan,
        is_active=user.is_active, is_email_verified=user.is_email_verified,
        created_at=user.created_at, updated_at=user.updated_at,
        contract_count=contract_count, chat_session_count=chat_count,
    )


def _log_action(db: Session, admin: User, target: User, action: str, detail: dict) -> None:
    db.add(AdminActionLog(
        admin_id=admin.id, target_user_id=target.id, target_email=target.email,
        action=action, detail=detail,
    ))


@router.get("/users", response_model=AdminUserListOut)
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    q: str | None = None,
    role: str | None = None,
    plan: str | None = None,
    is_active: bool | None = None,
    limit: int = 20,
    offset: int = 0,
):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    stmt = select(User)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.name.ilike(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if plan:
        stmt = stmt.where(User.plan == plan)
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)).all()

    return AdminUserListOut(total=total, items=[_to_admin_user_out(db, u) for u in rows])


@router.get("/users/{user_id}", response_model=AdminUserOut)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _to_admin_user_out(db, target)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
@limiter.limit("30/minute")
def update_user(
    request: Request,
    user_id: uuid.UUID,
    body: AdminUpdateUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # An admin can't change their own role or active status through this
    # endpoint — prevents accidental self-lockout (revoking your own admin
    # rights or suspending yourself with no one left to undo it).
    if target.id == admin.id and (body.role is not None or body.is_active is not None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins cannot change their own role or active status here",
        )

    changes: dict = {}
    if body.role is not None and body.role != target.role:
        changes["role"] = {"from": target.role, "to": body.role}
        target.role = body.role
    if body.plan is not None and body.plan != target.plan:
        changes["plan"] = {"from": target.plan, "to": body.plan}
        target.plan = body.plan
    if body.is_active is not None and body.is_active != target.is_active:
        changes["is_active"] = {"from": target.is_active, "to": body.is_active}
        target.is_active = body.is_active

    if changes:
        # Role/active-status changes affect authorization — force a fresh
        # login everywhere so the change takes effect immediately rather
        # than waiting out the existing (short-lived) access token plus
        # however long the old refresh tokens would otherwise live.
        if "role" in changes or "is_active" in changes:
            db.execute(
                RefreshToken.__table__.update()
                .where(RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None))
                .values(revoked_at=datetime.now(timezone.utc))
            )
        action = "suspend" if changes.get("is_active", {}).get("to") is False else (
            "reactivate" if "is_active" in changes else
            "update_role" if "role" in changes else "update_plan"
        )
        _log_action(db, admin, target, action, changes)
        db.commit()
        db.refresh(target)

    return _to_admin_user_out(db, target)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
def delete_user(
    request: Request, user_id: uuid.UUID, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    if user_id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use DELETE /users/me to delete your own account")

    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _log_action(db, admin, target, "delete_user", {"email": target.email})
    db.commit()  # persist the log before the target row (and its FK) disappears

    db.delete(target)  # cascades to contracts, chat sessions, chunks, refresh tokens
    db.commit()
    return None


@router.get("/stats", response_model=AdminStatsOut)
def get_stats(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    active_users = db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0
    verified_users = db.scalar(select(func.count()).select_from(User).where(User.is_email_verified.is_(True))) or 0

    role_rows = db.execute(select(User.role, func.count()).group_by(User.role)).all()
    plan_rows = db.execute(select(User.plan, func.count()).group_by(User.plan)).all()

    total_contracts = db.scalar(select(func.count()).select_from(Contract)) or 0
    status_rows = db.execute(select(Contract.status, func.count()).group_by(Contract.status)).all()

    total_chat_sessions = db.scalar(select(func.count()).select_from(ChatSession)) or 0

    return AdminStatsOut(
        total_users=total_users,
        active_users=active_users,
        verified_users=verified_users,
        users_by_role={r: c for r, c in role_rows},
        users_by_plan={p: c for p, c in plan_rows},
        total_contracts=total_contracts,
        contracts_by_status={s: c for s, c in status_rows},
        total_chat_sessions=total_chat_sessions,
    )
