from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import desc, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.helpers import clean_style_config, create_notification, parse_style_config
from app.api.realtime import manager
from app.core.config import Settings, get_settings
from app.db import get_db
from app.models import Like, Post, User
from app.schemas import PostPatch
from app.services.serializers import post_out
from app.services.uploads import save_images

router = APIRouter()


@router.get("/api/posts")
def list_posts(
    sort: str = "hot",
    q: str = "",
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    query = db.query(Post).filter(Post.is_hidden.is_(False))
    search = q.strip()
    if search:
        pattern = f"%{search}%"
        query = query.join(User, Post.author_id == User.id).filter(
            or_(Post.title.ilike(pattern), Post.body.ilike(pattern), Post.category.ilike(pattern), User.nickname.ilike(pattern))
        )
    if sort == "latest":
        query = query.order_by(desc(Post.is_pinned), desc(Post.last_activity_at), desc(Post.id))
    else:
        query = query.order_by(desc(Post.is_pinned), desc(Post.like_count), desc(Post.last_activity_at), desc(Post.id))
    return [post_out(db, post, user.id) for post in query.all()]


@router.post("/api/posts", status_code=status.HTTP_201_CREATED)
async def create_post(
    title: str = Form(..., min_length=1, max_length=160),
    body: str = Form(..., min_length=1),
    category: str = Form("讨论", max_length=40),
    style_config: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    now = datetime.now(timezone.utc)
    post = Post(
        author_id=user.id,
        title=title.strip(),
        body=body.strip(),
        style_config=parse_style_config(style_config),
        category=category.strip() or "讨论",
        last_activity_at=now,
    )
    db.add(post)
    db.flush()
    await save_images(db, files, "post", post.id, settings)
    db.commit()
    db.refresh(post)
    payload = post_out(db, post, user.id)
    await manager.broadcast("post_created", payload)
    if payload["attachments"]:
        await manager.broadcast("image_added", {"owner_type": "post", "owner_id": post.id, "attachments": payload["attachments"]})
    return payload


@router.patch("/api/posts/{post_id}")
async def update_post(
    post_id: int,
    payload: PostPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    post = db.get(Post, post_id)
    if not post or (post.is_hidden and user.role != "admin"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    if post.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能编辑自己的格点")
    if payload.title is not None:
        post.title = payload.title.strip()
    if payload.body is not None:
        post.body = payload.body.strip()
    if payload.category is not None:
        post.category = payload.category.strip() or "讨论"
    if payload.style_config is not None:
        post.style_config = clean_style_config(payload.style_config)
    post.updated_at = datetime.now(timezone.utc)
    post.last_activity_at = post.updated_at
    db.commit()
    db.refresh(post)
    result = post_out(db, post, user.id)
    await manager.broadcast("post_updated", result)
    return result


@router.delete("/api/posts/{post_id}")
async def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    if post.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能删除自己的帖子")
    if not post.is_hidden:
        post.is_hidden = True
        post.status = "deleted"
        post.updated_at = datetime.now(timezone.utc)
        post.last_activity_at = post.updated_at
        db.commit()
        db.refresh(post)
    await manager.broadcast("post_deleted", {"id": post.id})
    return {"ok": True}


@router.post("/api/posts/{post_id}/like")
async def like_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    post = db.get(Post, post_id)
    if not post or post.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    existing = db.query(Like).filter(Like.post_id == post.id, Like.user_id == user.id).first()
    if not existing:
        db.add(Like(post_id=post.id, user_id=user.id))
        post.like_count += 1
        post.last_activity_at = datetime.now(timezone.utc)
        await create_notification(db, user_id=post.author_id, actor=user, type_="post_liked", post_id=post.id)
        db.commit()
        db.refresh(post)
    payload = post_out(db, post, user.id)
    await manager.broadcast("like_changed", payload)
    return payload


@router.delete("/api/posts/{post_id}/like")
async def unlike_post(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    post = db.get(Post, post_id)
    if not post or post.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    existing = db.query(Like).filter(Like.post_id == post.id, Like.user_id == user.id).first()
    if existing:
        db.delete(existing)
        post.like_count = max(0, post.like_count - 1)
        post.last_activity_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(post)
    payload = post_out(db, post, user.id)
    await manager.broadcast("like_changed", payload)
    return payload
