import uuid
from datetime import datetime
from pydantic import BaseModel


class ContractOut(BaseModel):
    id: uuid.UUID
    name: str
    original_filename: str
    file_type: str
    size_bytes: int
    status: str
    status_detail: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContractListOut(BaseModel):
    total: int
    items: list[ContractOut]
