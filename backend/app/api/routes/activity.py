from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import Comment, Post, User
from app.services.serializers import comment_out, post_out

router = APIRouter()


@router.get("/api/me/activity")
def me_activity(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    posts = (
        db.query(Post)
        .filter(Post.author_id == user.id, Post.is_hidden.is_(False))
        .order_by(desc(Post.created_at), desc(Post.id))
        .limit(50)
        .all()
    )
    comments = (
        db.query(Comment)
        .filter(Comment.author_id == user.id, Comment.is_deleted.is_(False))
        .order_by(desc(Comment.created_at), desc(Comment.id))
        .limit(80)
        .all()
    )
    comment_items = []
    for comment in comments:
        post = db.get(Post, comment.post_id)
        if post and not post.is_hidden:
            item = comment_out(db, comment, user.id)
            item["post"] = {"id": post.id, "title": post.title}
            comment_items.append(item)
    return {"posts": [post_out(db, post, user.id) for post in posts], "comments": comment_items}
