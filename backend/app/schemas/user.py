import re
import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr, field_validator


def _validate_password_strength(v: str) -> str:
    if len(v) < 10:
        raise ValueError("Password must be at least 10 characters")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Password must contain an uppercase letter")
    if not re.search(r"[a-z]", v):
        raise ValueError("Password must contain a lowercase letter")
    if not re.search(r"\d", v):
        raise ValueError("Password must contain a digit")
    return v


# --- Self-service ---

class UpdateMeRequest(BaseModel):
    name: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (1 <= len(v) <= 255):
            raise ValueError("Name must be between 1 and 255 characters")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class DeleteAccountRequest(BaseModel):
    password: str


class SessionOut(BaseModel):
    id: uuid.UUID
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    expires_at: datetime
    is_current: bool

    model_config = {"from_attributes": True}


# --- Admin ---

class AdminUserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    role: str
    plan: str
    is_active: bool
    is_email_verified: bool
    created_at: datetime
    updated_at: datetime
    contract_count: int
    chat_session_count: int

    model_config = {"from_attributes": True}


class AdminUserListOut(BaseModel):
    total: int
    items: list[AdminUserOut]


class AdminUpdateUserRequest(BaseModel):
    role: str | None = None
    plan: str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str | None) -> str | None:
        if v is not None and v not in {"user", "admin"}:
            raise ValueError("role must be 'user' or 'admin'")
        return v

    @field_validator("plan")
    @classmethod
    def valid_plan(cls, v: str | None) -> str | None:
        if v is not None and v not in {"free", "pro", "business", "enterprise"}:
            raise ValueError("plan must be one of: free, pro, business, enterprise")
        return v


class AdminStatsOut(BaseModel):
    total_users: int
    active_users: int
    verified_users: int
    users_by_role: dict[str, int]
    users_by_plan: dict[str, int]
    total_contracts: int
    contracts_by_status: dict[str, int]
    total_chat_sessions: int
