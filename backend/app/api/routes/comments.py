from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.helpers import create_notification, parse_style_config
from app.api.realtime import manager
from app.core.config import Settings, get_settings
from app.db import get_db
from app.models import Comment, CommentLike, Post, User
from app.services.serializers import comment_out
from app.services.uploads import save_images

router = APIRouter()


@router.get("/api/posts/{post_id}/comments")
def list_comments(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    post = db.get(Post, post_id)
    if not post or (post.is_hidden and user.role != "admin"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    comments = (
        db.query(Comment)
        .filter(Comment.post_id == post.id, Comment.is_deleted.is_(False))
        .order_by(desc(Comment.created_at), desc(Comment.id))
        .all()
    )
    return [comment_out(db, comment, user.id) for comment in comments]


@router.post("/api/posts/{post_id}/comments", status_code=status.HTTP_201_CREATED)
async def create_comment(
    post_id: int,
    body: str = Form(..., min_length=1),
    reply_to_comment_id: int | None = Form(None),
    style_config: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    post = db.get(Post, post_id)
    if not post or post.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    parent: Comment | None = None
    if reply_to_comment_id is not None:
        parent = db.get(Comment, reply_to_comment_id)
        if not parent or parent.post_id != post.id or parent.is_deleted:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="回复对象不存在")
    comment = Comment(
        post_id=post.id,
        author_id=user.id,
        reply_to_comment_id=reply_to_comment_id,
        body=body.strip(),
        style_config=parse_style_config(style_config),
    )
    db.add(comment)
    db.flush()
    await save_images(db, files, "comment", comment.id, settings)
    post.comment_count += 1
    post.last_activity_at = datetime.now(timezone.utc)
    if parent and parent.author_id == post.author_id:
        await create_notification(db, user_id=parent.author_id, actor=user, type_="comment_replied", post_id=post.id, comment_id=comment.id)
    else:
        await create_notification(db, user_id=post.author_id, actor=user, type_="post_commented", post_id=post.id, comment_id=comment.id)
        if parent:
            await create_notification(db, user_id=parent.author_id, actor=user, type_="comment_replied", post_id=post.id, comment_id=comment.id)
    db.commit()
    db.refresh(comment)
    payload = comment_out(db, comment, user.id)
    await manager.broadcast("comment_created", payload)
    if payload["attachments"]:
        await manager.broadcast("image_added", {"owner_type": "comment", "owner_id": comment.id, "attachments": payload["attachments"]})
    return payload


@router.post("/api/comments/{comment_id}/like")
async def like_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    comment = db.get(Comment, comment_id)
    if not comment or comment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    post = db.get(Post, comment.post_id)
    if not post or post.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    existing = db.query(CommentLike).filter(CommentLike.comment_id == comment.id, CommentLike.user_id == user.id).first()
    if not existing:
        db.add(CommentLike(comment_id=comment.id, user_id=user.id))
        comment.like_count += 1
        post.last_activity_at = datetime.now(timezone.utc)
        await create_notification(db, user_id=comment.author_id, actor=user, type_="comment_liked", post_id=post.id, comment_id=comment.id)
        db.commit()
        db.refresh(comment)
    payload = comment_out(db, comment, user.id)
    await manager.broadcast("comment_like_changed", payload)
    return payload


@router.delete("/api/comments/{comment_id}/like")
async def unlike_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    comment = db.get(Comment, comment_id)
    if not comment or comment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    post = db.get(Post, comment.post_id)
    if not post or post.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    existing = db.query(CommentLike).filter(CommentLike.comment_id == comment.id, CommentLike.user_id == user.id).first()
    if existing:
        db.delete(existing)
        comment.like_count = max(0, comment.like_count - 1)
        post.last_activity_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(comment)
    payload = comment_out(db, comment, user.id)
    await manager.broadcast("comment_like_changed", payload)
    return payload


@router.delete("/api/comments/{comment_id}")
async def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    comment = db.get(Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    if comment.author_id != user.id and user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能删除自己的评论")
    if not comment.is_deleted:
        comment.is_deleted = True
        post = db.get(Post, comment.post_id)
        if post:
            post.comment_count = max(0, post.comment_count - 1)
            post.last_activity_at = datetime.now(timezone.utc)
        db.commit()
    await manager.broadcast("comment_deleted", {"id": comment_id, "post_id": comment.post_id})
    return {"ok": True}
