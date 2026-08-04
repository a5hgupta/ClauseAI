from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.session import get_db
from app.core.deps import limiter, get_current_user
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    generate_opaque_token,
    hash_opaque_token,
    refresh_token_expiry,
)
from app.core.config import settings
from app.models.user import User
from app.models.token import RefreshToken, EmailVerificationToken, PasswordResetToken
from app.schemas.auth import (
    SignupRequest, LoginRequest, TokenResponse, UserOut,
    ForgotPasswordRequest, ResetPasswordRequest, VerifyEmailRequest, RefreshRequest,
)
from app.services.email import send_verification_email, send_password_reset_email
from datetime import timedelta

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(db: Session, user: User, request: Request) -> TokenResponse:
    access = create_access_token(str(user.id), extra_claims={"role": user.role})

    raw_refresh = generate_opaque_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_opaque_token(raw_refresh),
        expires_at=refresh_token_expiry(),
        user_agent=request.headers.get("user-agent", "")[:255],
        ip_address=request.client.host if request.client else None,
    ))
    db.commit()
    return TokenResponse(access_token=access, refresh_token=raw_refresh)


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def signup(request: Request, body: SignupRequest, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == body.email.lower()))
    if existing:
        # Deliberately vague to avoid leaking which emails are registered.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not create account")

    user = User(
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        name=body.name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    raw_token = generate_opaque_token()
    db.add(EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_opaque_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    ))
    db.commit()
    send_verification_email(user.email, raw_token)

    return _issue_tokens(db, user, request)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    return _issue_tokens(db, user, request)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
def refresh(request: Request, body: RefreshRequest, db: Session = Depends(get_db)):
    token_hash = hash_opaque_token(body.refresh_token)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    if not row:
        raise invalid
    if row.revoked_at is not None:
        # Reuse of a revoked/rotated token — possible theft. Revoke the whole
        # session family for this user as a precaution.
        db.execute(
            RefreshToken.__table__.update()
            .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc))
        )
        db.commit()
        raise invalid
    if row.expires_at < datetime.now(timezone.utc):
        raise invalid

    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise invalid

    # Rotate: revoke old, issue new
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()

    return _issue_tokens(db, user, request)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def logout(request: Request, body: RefreshRequest, db: Session = Depends(get_db)):
    token_hash = hash_opaque_token(body.refresh_token)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if row and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return None


@router.post("/verify-email", response_model=UserOut)
@limiter.limit("10/minute")
def verify_email(request: Request, body: VerifyEmailRequest, db: Session = Depends(get_db)):
    token_hash = hash_opaque_token(body.token)
    row = db.scalar(select(EmailVerificationToken).where(EmailVerificationToken.token_hash == token_hash))

    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link")
    if not row or row.used_at is not None or row.expires_at < datetime.now(timezone.utc):
        raise invalid

    user = db.get(User, row.user_id)
    if not user:
        raise invalid

    user.is_email_verified = True
    row.used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


@router.post("/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
def resend_verification(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_email_verified:
        return None
    raw_token = generate_opaque_token()
    db.add(EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_opaque_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    ))
    db.commit()
    send_verification_email(user.email, raw_token)
    return None


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    # Always return 204 regardless of whether the account exists, to avoid
    # leaking which emails are registered via response timing/content.
    if user:
        raw_token = generate_opaque_token()
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_opaque_token(raw_token),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        ))
        db.commit()
        send_password_reset_email(user.email, raw_token)
    return None


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    token_hash = hash_opaque_token(body.token)
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash))

    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link")
    if not row or row.used_at is not None or row.expires_at < datetime.now(timezone.utc):
        raise invalid

    user = db.get(User, row.user_id)
    if not user:
        raise invalid

    user.hashed_password = hash_password(body.new_password)
    row.used_at = datetime.now(timezone.utc)

    # Password changed — revoke every existing refresh token (logout everywhere).
    db.execute(
        RefreshToken.__table__.update()
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    db.commit()
    return None


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
