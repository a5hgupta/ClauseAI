"""
Storage abstraction so the rest of the app never touches boto3 or the
filesystem directly. Switch STORAGE_BACKEND=s3 in .env for production —
local disk is fine for single-instance dev/staging only (it will not
survive a redeploy or scale past one container).
"""
import os
import uuid
from pathlib import Path

from fastapi import UploadFile, HTTPException, status

from app.core.config import settings


def _safe_ext(filename: str) -> str:
    ext = Path(filename).suffix.lstrip(".").lower()
    return ext


def validate_upload(file: UploadFile, size_bytes: int) -> str:
    ext = _safe_ext(file.filename or "")
    if ext not in settings.allowed_extensions_list:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type '.{ext}' not allowed. Allowed: {', '.join(settings.allowed_extensions_list)}",
        )
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if size_bytes > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit",
        )
    return ext


class LocalStorage:
    def save(self, user_id: str, ext: str, data: bytes) -> str:
        user_dir = Path(settings.LOCAL_STORAGE_PATH) / user_id
        user_dir.mkdir(parents=True, exist_ok=True)
        key = f"{user_id}/{uuid.uuid4()}.{ext}"
        full_path = Path(settings.LOCAL_STORAGE_PATH) / key
        with open(full_path, "wb") as f:
            f.write(data)
        return key

    def delete(self, key: str) -> None:
        full_path = Path(settings.LOCAL_STORAGE_PATH) / key
        if full_path.exists():
            os.remove(full_path)

    def read(self, key: str) -> bytes:
        full_path = Path(settings.LOCAL_STORAGE_PATH) / key
        with open(full_path, "rb") as f:
            return f.read()


class S3Storage:
    def __init__(self):
        import boto3
        self.client = boto3.client(
            "s3",
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION,
        )
        self.bucket = settings.S3_BUCKET_NAME

    def save(self, user_id: str, ext: str, data: bytes) -> str:
        key = f"{user_id}/{uuid.uuid4()}.{ext}"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ServerSideEncryption="AES256",
        )
        return key

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def read(self, key: str) -> bytes:
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        return obj["Body"].read()


def get_storage():
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()
