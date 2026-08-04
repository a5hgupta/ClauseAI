import uuid
from datetime import datetime
from pydantic import BaseModel, field_validator


class ChatSessionOut(BaseModel):
    id: uuid.UUID
    contract_id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


ALLOWED_LEVELS = {"simple", "intermediate", "lawStudent"}


class SendMessageRequest(BaseModel):
    message: str
    explain_level: str = "simple"

    @field_validator("message")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        if len(v) > 4000:
            raise ValueError("Message too long (max 4000 characters)")
        return v

    @field_validator("explain_level")
    @classmethod
    def valid_level(cls, v: str) -> str:
        return v if v in ALLOWED_LEVELS else "simple"
