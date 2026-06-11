from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    nickname: str
    role: str


class AuthIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterIn(AuthIn):
    nickname: str = Field(min_length=1, max_length=80)
    invite_code: str | None = Field(default=None, max_length=128)


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    original_name: str
    mime_type: str
    size_bytes: int
    url: str
    created_at: datetime


class PostOut(BaseModel):
    id: int
    title: str
    body: str
    style_config: dict = Field(default_factory=dict)
    category: str
    status: str
    is_pinned: bool
    is_hidden: bool
    like_count: int
    comment_count: int
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime
    author: UserOut
    attachments: list[AttachmentOut]
    liked_by_me: bool = False


class CommentOut(BaseModel):
    id: int
    post_id: int
    reply_to_comment_id: int | None = None
    reply_to: dict | None = None
    body: str
    style_config: dict = Field(default_factory=dict)
    like_count: int = 0
    liked_by_me: bool = False
    is_deleted: bool
    created_at: datetime
    author: UserOut
    attachments: list[AttachmentOut]


class AdminPostPatch(BaseModel):
    is_hidden: bool | None = None
    is_pinned: bool | None = None
    status: str | None = Field(default=None, max_length=30)


class PostPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, min_length=1)
    category: str | None = Field(default=None, max_length=40)
    style_config: dict | None = None


class RealtimeEvent(BaseModel):
    type: str
    payload: dict
