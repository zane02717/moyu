from fastapi import APIRouter, Depends
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.helpers import notification_out
from app.db import get_db
from app.models import Notification, User

router = APIRouter()


@router.get("/api/notifications")
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(desc(Notification.created_at), desc(Notification.id))
        .limit(80)
        .all()
    )
    unread_count = db.query(func.count(Notification.id)).filter(Notification.user_id == user.id, Notification.is_read.is_(False)).scalar() or 0
    return {"items": [notification_out(db, item) for item in notifications], "unread_count": unread_count}


@router.post("/api/notifications/read")
def mark_notifications_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    db.query(Notification).filter(Notification.user_id == user.id, Notification.is_read.is_(False)).update({"is_read": True})
    db.commit()
    return {"ok": True, "unread_count": 0}
