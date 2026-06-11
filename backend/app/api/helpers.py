import json

from fastapi import HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.realtime import manager
from app.core.config import Settings
from app.core.security import create_session_token
from app.models import Comment, Notification, Post, User

STYLE_CONFIG_KEYS = {"fontFamily", "titleSize", "bodySize", "titleColor", "bodyColor", "accent", "bold", "italic", "underline"}


def set_session_cookie(response: Response, user: User, settings: Settings) -> None:
    token = create_session_token(user.id)
    response.set_cookie(
        settings.cookie_name,
        token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=14 * 24 * 60 * 60,
    )


def parse_style_config(raw: str) -> dict:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="样式配置格式错误") from None
    if not isinstance(value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="样式配置必须是对象")
    return {key: value[key] for key in STYLE_CONFIG_KEYS if key in value}


def clean_style_config(value: dict | None) -> dict:
    if value is None:
        return {}
    return {key: value[key] for key in STYLE_CONFIG_KEYS if key in value}


def notification_out(db: Session, notification: Notification) -> dict:
    actor = db.get(User, notification.actor_id)
    post = db.get(Post, notification.post_id) if notification.post_id else None
    comment = db.get(Comment, notification.comment_id) if notification.comment_id else None
    return {
        "id": notification.id,
        "type": notification.type,
        "post_id": notification.post_id,
        "comment_id": notification.comment_id,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat(),
        "actor": {"id": actor.id, "nickname": actor.nickname} if actor else None,
        "post_title": post.title if post else None,
        "comment_preview": comment.body[:80] if comment else None,
    }


async def create_notification(
    db: Session,
    *,
    user_id: int,
    actor: User,
    type_: str,
    post_id: int | None = None,
    comment_id: int | None = None,
) -> None:
    if user_id == actor.id:
        return
    notification = Notification(
        user_id=user_id,
        actor_id=actor.id,
        type=type_,
        post_id=post_id,
        comment_id=comment_id,
    )
    db.add(notification)
    db.flush()
    payload = notification_out(db, notification)
    unread_count = db.query(func.count(Notification.id)).filter(Notification.user_id == user_id, Notification.is_read.is_(False)).scalar() or 0
    await manager.broadcast("notification_created", {"notification": payload, "user_id": user_id, "unread_count": unread_count})
