"""
Password hashing + JWT issuance/verification.

Access tokens are short-lived and stateless.
Refresh tokens are long-lived, opaque, stored hashed in the DB (refresh_tokens
table) so they can be revoked individually (logout) or in bulk (logout-all,
password change, suspected compromise). We never store a raw refresh token.
"""
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

from jose import jwt, JWTError
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(subject: str, extra_claims: Optional[dict] = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises JWTError on invalid/expired token."""
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


def generate_opaque_token() -> str:
    """Used for refresh tokens, email verification tokens, password reset tokens."""
    return secrets.token_urlsafe(48)


def hash_opaque_token(token: str) -> str:
    """
    Refresh/verification/reset tokens are stored hashed (SHA-256 is fine here —
    these are high-entropy random tokens, not user-chosen passwords, so no
    need for bcrypt's deliberate slowness).
    """
    return hashlib.sha256(token.encode()).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
