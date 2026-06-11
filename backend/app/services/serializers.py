from sqlalchemy.orm import Session

from app.models import Attachment, Comment, CommentLike, Like, Post, User


def dt(value) -> str:
    return value.isoformat()


def user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "nickname": user.nickname, "role": user.role}


def attachment_out(attachment: Attachment) -> dict:
    return {
        "id": attachment.id,
        "filename": attachment.filename,
        "original_name": attachment.original_name,
        "mime_type": attachment.mime_type,
        "size_bytes": attachment.size_bytes,
        "url": attachment.url,
        "created_at": dt(attachment.created_at),
    }


def attachments_for(db: Session, owner_type: str, owner_id: int) -> list[Attachment]:
    return (
        db.query(Attachment)
        .filter(Attachment.owner_type == owner_type, Attachment.owner_id == owner_id)
        .order_by(Attachment.created_at.asc(), Attachment.id.asc())
        .all()
    )


def post_out(db: Session, post: Post, current_user_id: int | None = None) -> dict:
    liked_by_me = False
    if current_user_id:
        liked_by_me = (
            db.query(Like)
            .filter(Like.post_id == post.id, Like.user_id == current_user_id)
            .first()
            is not None
        )
    return {
        "id": post.id,
        "title": post.title,
        "body": post.body,
        "style_config": post.style_config or {},
        "category": post.category,
        "status": post.status,
        "is_pinned": post.is_pinned,
        "is_hidden": post.is_hidden,
        "like_count": post.like_count,
        "comment_count": post.comment_count,
        "last_activity_at": dt(post.last_activity_at),
        "created_at": dt(post.created_at),
        "updated_at": dt(post.updated_at),
        "author": user_out(post.author),
        "attachments": [attachment_out(item) for item in attachments_for(db, "post", post.id)],
        "liked_by_me": liked_by_me,
    }


def comment_out(db: Session, comment: Comment, current_user_id: int | None = None) -> dict:
    reply_to = None
    liked_by_me = False
    if current_user_id:
        liked_by_me = (
            db.query(CommentLike)
            .filter(CommentLike.comment_id == comment.id, CommentLike.user_id == current_user_id)
            .first()
            is not None
        )
    if comment.reply_to_comment_id:
        parent = db.get(Comment, comment.reply_to_comment_id)
        if parent and not parent.is_deleted:
            reply_to = {
                "id": parent.id,
                "author_nickname": parent.author.nickname,
                "body_preview": parent.body[:80],
            }
    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "reply_to_comment_id": comment.reply_to_comment_id,
        "reply_to": reply_to,
        "body": comment.body,
        "style_config": comment.style_config or {},
        "like_count": comment.like_count,
        "liked_by_me": liked_by_me,
        "is_deleted": comment.is_deleted,
        "created_at": dt(comment.created_at),
        "author": user_out(comment.author),
        "attachments": [attachment_out(item) for item in attachments_for(db, "comment", comment.id)],
    }
