import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.session import get_db
from app.core.deps import get_current_user, limiter
from app.core.security import hash_password, verify_password, hash_opaque_token
from app.models.user import User
from app.models.token import RefreshToken
from app.schemas.auth import UserOut
from app.schemas.user import UpdateMeRequest, ChangePasswordRequest, DeleteAccountRequest, SessionOut

router = APIRouter(prefix="/users", tags=["users"])


@router.patch("/me", response_model=UserOut)
def update_me(body: UpdateMeRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if body.name is not None:
        user.name = body.name
    db.commit()
    db.refresh(user)
    return user


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def change_password(
    request: Request,
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")

    user.hashed_password = hash_password(body.new_password)

    # Same policy as the forgot/reset-password flow: a password change logs
    # every session out, including the one making this request, since access
    # tokens are stateless and can't be selectively invalidated.
    db.execute(
        RefreshToken.__table__.update()
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    db.commit()
    return None


@router.get("/me/sessions", response_model=list[SessionOut])
def list_sessions(
    request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > now)
        .order_by(RefreshToken.created_at.desc())
    ).all()

    # There's no request-scoped way to know which refresh token belongs to
    # *this* access token (they're independent credentials by design), so
    # "is_current" is heuristic — the most recently created session sharing
    # this request's user-agent — good enough for a "this device" hint in
    # the UI, not a security boundary.
    current_ua = request.headers.get("user-agent", "")[:255]
    marked_current = False
    out = []
    for row in rows:
        is_current = (not marked_current) and row.user_agent == current_ua
        if is_current:
            marked_current = True
        out.append(SessionOut(
            id=row.id, user_agent=row.user_agent, ip_address=row.ip_address,
            created_at=row.created_at, expires_at=row.expires_at, is_current=is_current,
        ))
    return out


@router.delete("/me/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.get(RefreshToken, session_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return None


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
def delete_account(
    request: Request,
    body: DeleteAccountRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Password is incorrect")
    # Cascades to contracts, chat sessions, chunks, refresh tokens, etc. —
    # same cascade="all, delete-orphan" relationships already defined on User.
    db.delete(user)
    db.commit()
    return None
