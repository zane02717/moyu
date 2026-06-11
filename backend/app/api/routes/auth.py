from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.helpers import set_session_cookie
from app.core.config import Settings, get_settings
from app.core.security import hash_password, verify_password
from app.db import get_db
from app.models import User
from app.schemas import AuthIn, RegisterIn, UserOut

router = APIRouter()


@router.post("/api/auth/register", response_model=UserOut)
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


@router.post("/api/auth/login", response_model=UserOut)
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


@router.post("/api/auth/logout")
def logout(response: Response, settings: Settings = Depends(get_settings)) -> dict:
    response.delete_cookie(settings.cookie_name)
    return {"ok": True}


@router.get("/api/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
