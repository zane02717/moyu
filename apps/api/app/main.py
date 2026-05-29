import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import Base, engine, get_db
from app.deps import get_current_user, require_admin
from app.models import Comment, CommentLike, Like, Notification, Post, User
from app.realtime import manager
from app.schemas import AdminPostPatch, AuthIn, PostPatch, RegisterIn, UserOut
from app.security import create_session_token, hash_password, verify_password
from app.serializers import comment_out, post_out
from app.uploads import save_images


Base.metadata.create_all(bind=engine)

app = FastAPI(title="格间 API")
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")


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
    allowed = {"fontFamily", "titleSize", "bodySize", "titleColor", "bodyColor", "accent", "bold", "italic", "underline"}
    return {key: value[key] for key in allowed if key in value}


def clean_style_config(value: dict | None) -> dict:
    if value is None:
        return {}
    allowed = {"fontFamily", "titleSize", "bodySize", "titleColor", "bodyColor", "accent", "bold", "italic", "underline"}
    return {key: value[key] for key in allowed if key in value}


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


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/auth/register", response_model=UserOut)
def register(
    payload: RegisterIn,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    email = payload.email.lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="邮箱已注册")
    if settings.invite_code and payload.invite_code != settings.invite_code:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="邀请码不正确")
    role = "admin" if settings.admin_email and email == settings.admin_email.lower() else "user"
    user = User(email=email, nickname=payload.nickname.strip(), password_hash=hash_password(payload.password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, user, settings)
    return user


@app.post("/api/auth/login", response_model=UserOut)
def login(
    payload: AuthIn,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码错误")
    if settings.admin_email and user.email == settings.admin_email.lower() and user.role != "admin":
        user.role = "admin"
        db.commit()
        db.refresh(user)
    set_session_cookie(response, user, settings)
    return user


@app.post("/api/auth/logout")
def logout(response: Response, settings: Settings = Depends(get_settings)) -> dict:
    response.delete_cookie(settings.cookie_name)
    return {"ok": True}


@app.get("/api/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@app.get("/api/notifications")
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


@app.post("/api/notifications/read")
def mark_notifications_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    db.query(Notification).filter(Notification.user_id == user.id, Notification.is_read.is_(False)).update({"is_read": True})
    db.commit()
    return {"ok": True, "unread_count": 0}


@app.get("/api/me/activity")
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


@app.get("/api/posts")
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


@app.get("/api/admin/posts")
def list_posts_admin(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
) -> list[dict]:
    posts = db.query(Post).order_by(desc(Post.is_hidden), desc(Post.is_pinned), desc(Post.last_activity_at), desc(Post.id)).all()
    return [post_out(db, post, user.id) for post in posts]


@app.post("/api/posts", status_code=status.HTTP_201_CREATED)
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


@app.patch("/api/posts/{post_id}")
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


@app.delete("/api/posts/{post_id}")
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


@app.post("/api/posts/{post_id}/like")
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


@app.delete("/api/posts/{post_id}/like")
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


@app.get("/api/posts/{post_id}/comments")
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


@app.post("/api/posts/{post_id}/comments", status_code=status.HTTP_201_CREATED)
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


@app.post("/api/comments/{comment_id}/like")
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


@app.delete("/api/comments/{comment_id}/like")
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


@app.patch("/api/admin/posts/{post_id}")
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


@app.delete("/api/admin/comments/{comment_id}")
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


@app.delete("/api/comments/{comment_id}")
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


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
