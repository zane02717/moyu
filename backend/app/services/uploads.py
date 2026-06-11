from pathlib import Path
import secrets
import time
from urllib.parse import urlencode
from uuid import uuid4

import httpx
from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Attachment

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}

VERCEL_BLOB_API_URL = "https://vercel.com/api/blob"
VERCEL_BLOB_API_VERSION = "12"


async def save_images(
    db: Session,
    files: list[UploadFile],
    owner_type: str,
    owner_id: int,
    settings: Settings,
) -> list[Attachment]:
    if len(files) > settings.max_images_per_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单次最多上传 {settings.max_images_per_request} 张图片",
        )

    attachments: list[Attachment] = []
    for file in files:
        if not file.filename:
            continue
        suffix = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
        if not suffix:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只支持 jpg/png/gif/webp 图片")

        content = await file.read()
        if len(content) > settings.max_image_bytes:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="单张图片不能超过 5MB")

        filename = f"{uuid4().hex}{suffix}"
        url = await save_image_content(filename, content, file.content_type or "application/octet-stream", settings)

        attachment = Attachment(
            owner_type=owner_type,
            owner_id=owner_id,
            filename=filename,
            original_name=file.filename,
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            url=url,
        )
        db.add(attachment)
        attachments.append(attachment)

    db.flush()
    return attachments


async def save_image_content(filename: str, content: bytes, content_type: str, settings: Settings) -> str:
    if settings.blob_read_write_token:
        return await save_to_vercel_blob(filename, content, content_type, settings.blob_read_write_token)

    target = Path(settings.uploads_dir) / filename
    target.write_bytes(content)
    return f"/uploads/{filename}"


async def save_to_vercel_blob(filename: str, content: bytes, content_type: str, token: str) -> str:
    pathname = f"uploads/{filename}"
    store_id = parse_blob_store_id(token)
    headers = {
        "Authorization": f"Bearer {token}",
        "x-api-version": VERCEL_BLOB_API_VERSION,
        "x-content-length": str(len(content)),
        "x-vercel-blob-access": "public",
        "x-content-type": content_type,
        "x-allow-overwrite": "0",
    }
    if store_id:
        headers.update(
            {
                "x-api-blob-request-id": f"{store_id}:{int(time.time() * 1000)}:{secrets.token_hex(8)}",
                "x-vercel-blob-store-id": store_id,
                "x-api-blob-request-attempt": "0",
            }
        )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.put(f"{VERCEL_BLOB_API_URL}/?{urlencode({'pathname': pathname})}", content=content, headers=headers)
    if response.status_code >= 400:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"图片存储失败: {blob_error_message(response)}")
    data = response.json()
    return data["url"]


def parse_blob_store_id(token: str) -> str | None:
    parts = token.split("_")
    if len(parts) >= 5 and parts[:3] == ["vercel", "blob", "rw"]:
        return parts[3]
    return None


def blob_error_message(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:200] or f"HTTP {response.status_code}"

    error = data.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("code")
        if message:
            return str(message)[:200]
    message = data.get("message")
    if message:
        return str(message)[:200]
    return f"HTTP {response.status_code}"
