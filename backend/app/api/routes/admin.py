from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.api.realtime import manager
from app.db import get_db
from app.models import Comment, Post, User
from app.schemas import AdminPostPatch
from app.services.serializers import post_out

router = APIRouter()


@router.get("/api/admin/posts")
def list_posts_admin(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict]:
    posts = db.query(Post).order_by(desc(Post.is_hidden), desc(Post.is_pinned), desc(Post.last_activity_at), desc(Post.id)).all()
    return [post_out(db, post, user.id) for post in posts]


@router.patch("/api/admin/posts/{post_id}")
async def update_post_admin(
    post_id: int,
    payload: AdminPostPatch,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")
    if payload.is_hidden is not None:
        post.is_hidden = payload.is_hidden
    if payload.is_pinned is not None:
        post.is_pinned = payload.is_pinned
    if payload.status is not None:
        post.status = payload.status
    post.last_activity_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(post)
    event = "post_hidden" if post.is_hidden and payload.is_hidden is True else "post_updated"
    result = post_out(db, post)
    await manager.broadcast(event, result)
    return result


@router.delete("/api/admin/comments/{comment_id}")
async def delete_comment_admin(
    comment_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    comment = db.get(Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    if not comment.is_deleted:
        comment.is_deleted = True
        post = db.get(Post, comment.post_id)
        if post:
            post.comment_count = max(0, post.comment_count - 1)
            post.last_activity_at = datetime.now(timezone.utc)
        db.commit()
    await manager.broadcast("comment_deleted", {"id": comment_id, "post_id": comment.post_id})
    return {"ok": True}
