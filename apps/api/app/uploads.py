from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Attachment

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


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
        target = Path(settings.uploads_dir) / filename
        target.write_bytes(content)

        attachment = Attachment(
            owner_type=owner_type,
            owner_id=owner_id,
            filename=filename,
            original_name=file.filename,
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            url=f"/uploads/{filename}",
        )
        db.add(attachment)
        attachments.append(attachment)

    db.flush()
    return attachments
