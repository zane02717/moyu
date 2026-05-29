from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()

    def override_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_settings() -> Settings:
        return Settings(
            database_url="sqlite://",
            jwt_secret="test-secret",
            admin_email="admin@example.com",
            uploads_dir=uploads_dir,
            max_image_bytes=128,
            max_images_per_request=2,
        )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = override_settings
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def register(client: TestClient, email: str = "user@example.com", password: str = "password123") -> dict:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "nickname": "格间用户", "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_register_requires_invite_code_when_configured(tmp_path: Path) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    uploads_dir = tmp_path / "invite-uploads"
    uploads_dir.mkdir()

    def override_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_settings() -> Settings:
        return Settings(
            database_url="sqlite://",
            jwt_secret="test-secret",
            admin_email="admin@example.com",
            uploads_dir=uploads_dir,
            invite_code="open-sesame",
        )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = override_settings
    try:
        with TestClient(app) as test_client:
            missing = test_client.post(
                "/api/auth/register",
                json={"email": "missing@example.com", "nickname": "格间用户", "password": "password123"},
            )
            assert missing.status_code == 403
            assert missing.json()["detail"] == "邀请码不正确"

            wrong = test_client.post(
                "/api/auth/register",
                json={"email": "wrong@example.com", "nickname": "格间用户", "password": "password123", "invite_code": "nope"},
            )
            assert wrong.status_code == 403
            assert wrong.json()["detail"] == "邀请码不正确"

            ok = test_client.post(
                "/api/auth/register",
                json={"email": "ok@example.com", "nickname": "格间用户", "password": "password123", "invite_code": "open-sesame"},
            )
            assert ok.status_code == 200, ok.text
    finally:
        app.dependency_overrides.clear()


def test_register_login_logout_and_me(client: TestClient) -> None:
    user = register(client)
    assert user["email"] == "user@example.com"
    assert user["role"] == "user"

    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["nickname"] == "格间用户"

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    assert client.get("/api/me").status_code == 401

    login = client.post("/api/auth/login", json={"email": "user@example.com", "password": "password123"})
    assert login.status_code == 200
    assert client.get("/api/me").status_code == 200


def test_create_post_with_image_and_comment_with_image(client: TestClient) -> None:
    register(client)
    post_response = client.post(
        "/api/posts",
        data={"title": "图片记录", "body": "这里有一张现场图。", "category": "图片"},
        files=[("files", ("note.png", b"tiny-image", "image/png"))],
    )
    assert post_response.status_code == 201, post_response.text
    post = post_response.json()
    assert post["attachments"][0]["url"].startswith("/uploads/")

    comment_response = client.post(
        f"/api/posts/{post['id']}/comments",
        data={"body": "补充一张现场附件。"},
        files=[("files", ("reply.webp", b"reply-image", "image/webp"))],
    )
    assert comment_response.status_code == 201, comment_response.text
    comment = comment_response.json()
    assert comment["attachments"][0]["mime_type"] == "image/webp"

    comments = client.get(f"/api/posts/{post['id']}/comments")
    assert comments.status_code == 200
    assert len(comments.json()) == 1


def test_comments_default_to_newest_first(client: TestClient) -> None:
    register(client)
    post = client.post("/api/posts", data={"title": "评论排序", "body": "后发在上"}).json()
    first = client.post(f"/api/posts/{post['id']}/comments", data={"body": "第一条"}).json()
    second = client.post(f"/api/posts/{post['id']}/comments", data={"body": "第二条"}).json()

    comments = client.get(f"/api/posts/{post['id']}/comments").json()

    assert [comment["id"] for comment in comments] == [second["id"], first["id"]]


def test_create_post_persists_style_config(client: TestClient) -> None:
    register(client)
    response = client.post(
        "/api/posts",
        data={
            "title": "样式格点",
            "body": "这条内容应该带着字体样式回来。",
            "category": "分享",
            "style_config": '{"fontFamily":"serif","titleSize":"large","bodySize":"compact","titleColor":"red","bodyColor":"blue","accent":"ink","bold":true,"italic":false}',
        },
    )
    assert response.status_code == 201, response.text
    post = response.json()
    assert post["style_config"] == {
        "fontFamily": "serif",
        "titleSize": "large",
        "bodySize": "compact",
        "titleColor": "red",
        "bodyColor": "blue",
        "accent": "ink",
        "bold": True,
        "italic": False,
    }

    posts = client.get("/api/posts").json()
    assert posts[0]["style_config"]["fontFamily"] == "serif"


def test_author_can_edit_post_content_and_style(client: TestClient) -> None:
    register(client)
    post = client.post(
        "/api/posts",
        data={"title": "初版格点", "body": "需要在表格里继续编辑。", "category": "讨论"},
    ).json()

    response = client.patch(
        f"/api/posts/{post['id']}",
        json={
            "title": "编辑后的格点",
            "body": "右侧批注面板保存后的正文。",
            "category": "分享",
            "style_config": {"fontFamily": "song", "titleSize": "large", "titleColor": "gold", "bodyColor": "ink", "accent": "blue", "bold": True},
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["title"] == "编辑后的格点"
    assert updated["body"] == "右侧批注面板保存后的正文。"
    assert updated["category"] == "分享"
    assert updated["style_config"]["fontFamily"] == "song"
    assert updated["style_config"]["titleSize"] == "large"
    assert updated["style_config"]["titleColor"] == "gold"
    assert updated["style_config"]["bodyColor"] == "ink"
    assert updated["style_config"]["accent"] == "blue"
    assert updated["style_config"]["bold"] is True


def test_non_author_cannot_edit_post(client: TestClient) -> None:
    register(client, email="owner@example.com")
    post = client.post("/api/posts", data={"title": "只允许本人编辑", "body": "原始正文"}).json()
    client.post("/api/auth/logout")
    register(client, email="reader@example.com")

    response = client.patch(f"/api/posts/{post['id']}", json={"title": "越权修改"})

    assert response.status_code == 403


def test_user_can_delete_own_post_but_not_others(client: TestClient) -> None:
    register(client, email="owner@example.com")
    post = client.post("/api/posts", data={"title": "可以删除", "body": "自己的帖子"}).json()
    client.post("/api/auth/logout")
    register(client, email="other@example.com")

    forbidden = client.delete(f"/api/posts/{post['id']}")
    assert forbidden.status_code == 403

    client.post("/api/auth/logout")
    login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "password123"})
    assert login.status_code == 200
    deleted = client.delete(f"/api/posts/{post['id']}")
    assert deleted.status_code == 200

    posts = client.get("/api/posts").json()
    assert post["id"] not in [item["id"] for item in posts]
    assert client.get(f"/api/posts/{post['id']}/comments").status_code == 404


def test_comment_realtime_event_is_json_serializable(client: TestClient) -> None:
    register(client)
    post = client.post("/api/posts", data={"title": "实时评论", "body": "检查实时广播"}).json()

    with client.websocket_connect("/ws") as websocket:
        response = client.post(f"/api/posts/{post['id']}/comments", data={"body": "这条评论应该实时出现"})
        assert response.status_code == 201, response.text
        event = websocket.receive_json()

    assert event["type"] == "comment_created"
    assert event["payload"]["body"] == "这条评论应该实时出现"
    assert isinstance(event["payload"]["created_at"], str)


def test_comment_can_reply_to_comment_and_persist_style(client: TestClient) -> None:
    register(client)
    post = client.post("/api/posts", data={"title": "互相回复", "body": "楼里继续聊"}).json()
    first = client.post(f"/api/posts/{post['id']}/comments", data={"body": "第一条评论"}).json()

    response = client.post(
        f"/api/posts/{post['id']}/comments",
        data={
            "body": "指定回复这条",
            "reply_to_comment_id": str(first["id"]),
            "style_config": '{"bodySize":"large","fontFamily":"song","bold":true}',
        },
    )

    assert response.status_code == 201, response.text
    reply = response.json()
    assert reply["reply_to_comment_id"] == first["id"]
    assert reply["reply_to"] == {
        "id": first["id"],
        "author_nickname": "格间用户",
        "body_preview": "第一条评论",
    }
    assert reply["style_config"] == {"bodySize": "large", "fontFamily": "song", "bold": True}

    comments = client.get(f"/api/posts/{post['id']}/comments").json()
    assert comments[0]["reply_to"]["id"] == first["id"]


def test_comment_like_and_unlike(client: TestClient) -> None:
    register(client)
    post = client.post("/api/posts", data={"title": "评论喜欢", "body": "评论也能点赞"}).json()
    comment = client.post(f"/api/posts/{post['id']}/comments", data={"body": "值得顶一下"}).json()

    liked = client.post(f"/api/comments/{comment['id']}/like")
    assert liked.status_code == 200, liked.text
    assert liked.json()["like_count"] == 1
    assert liked.json()["liked_by_me"] is True

    comments = client.get(f"/api/posts/{post['id']}/comments").json()
    assert comments[0]["like_count"] == 1
    assert comments[0]["liked_by_me"] is True

    unliked = client.delete(f"/api/comments/{comment['id']}/like")
    assert unliked.status_code == 200
    assert unliked.json()["like_count"] == 0
    assert unliked.json()["liked_by_me"] is False


def test_notifications_for_likes_comments_and_replies(client: TestClient) -> None:
    register(client, email="owner@example.com")
    post = client.post("/api/posts", data={"title": "通知测试", "body": "有人互动会提醒"}).json()
    own_comment = client.post(f"/api/posts/{post['id']}/comments", data={"body": "楼主自己的评论"}).json()
    client.post("/api/auth/logout")
    register(client, email="visitor@example.com")

    liked_post = client.post(f"/api/posts/{post['id']}/like")
    assert liked_post.status_code == 200
    commented = client.post(f"/api/posts/{post['id']}/comments", data={"body": "来评论一下"})
    assert commented.status_code == 201
    replied = client.post(
        f"/api/posts/{post['id']}/comments",
        data={"body": "回复楼主评论", "reply_to_comment_id": str(own_comment["id"])},
    )
    assert replied.status_code == 201
    liked_comment = client.post(f"/api/comments/{own_comment['id']}/like")
    assert liked_comment.status_code == 200

    client.post("/api/auth/logout")
    login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "password123"})
    assert login.status_code == 200

    notifications = client.get("/api/notifications")
    assert notifications.status_code == 200
    payload = notifications.json()
    assert payload["unread_count"] == 4
    assert {item["type"] for item in payload["items"]} == {"post_liked", "post_commented", "comment_replied", "comment_liked"}

    read = client.post("/api/notifications/read")
    assert read.status_code == 200
    assert read.json()["unread_count"] == 0
    assert client.get("/api/notifications").json()["unread_count"] == 0


def test_user_can_delete_own_comment_but_not_others(client: TestClient) -> None:
    register(client, email="owner@example.com")
    post = client.post("/api/posts", data={"title": "评论删除", "body": "只删自己的"}).json()
    own = client.post(f"/api/posts/{post['id']}/comments", data={"body": "自己的评论"}).json()
    client.post("/api/auth/logout")
    register(client, email="other@example.com")
    other = client.post(f"/api/posts/{post['id']}/comments", data={"body": "别人的评论"}).json()

    forbidden = client.delete(f"/api/comments/{own['id']}")
    assert forbidden.status_code == 403

    deleted = client.delete(f"/api/comments/{other['id']}")
    assert deleted.status_code == 200

    comments = client.get(f"/api/posts/{post['id']}/comments").json()
    assert [comment["id"] for comment in comments] == [own["id"]]


def test_me_activity_lists_my_posts_and_comments(client: TestClient) -> None:
    register(client)
    own_post = client.post("/api/posts", data={"title": "我的发帖", "body": "会出现在记录里"}).json()
    comment = client.post(f"/api/posts/{own_post['id']}/comments", data={"body": "我的评论"}).json()

    activity = client.get("/api/me/activity")

    assert activity.status_code == 200
    payload = activity.json()
    assert payload["posts"][0]["id"] == own_post["id"]
    assert payload["comments"][0]["id"] == comment["id"]
    assert payload["comments"][0]["post"]["id"] == own_post["id"]


def test_rejects_non_image_and_too_large_image(client: TestClient) -> None:
    register(client)
    bad_type = client.post(
        "/api/posts",
        data={"title": "附件异常", "body": "这个应该失败。"},
        files=[("files", ("bad.txt", b"hello", "text/plain"))],
    )
    assert bad_type.status_code == 400

    too_large = client.post(
        "/api/posts",
        data={"title": "附件过大", "body": "这个也应该失败。"},
        files=[("files", ("large.png", b"x" * 129, "image/png"))],
    )
    assert too_large.status_code == 400


def test_like_sorting_and_admin_visibility(client: TestClient) -> None:
    register(client)
    low = client.post("/api/posts", data={"title": "普通记录", "body": "低热度"}).json()
    high = client.post("/api/posts", data={"title": "高赞记录", "body": "高热度"}).json()
    client.post(f"/api/posts/{high['id']}/like")

    posts = client.get("/api/posts?sort=hot").json()
    assert [post["id"] for post in posts][:2] == [high["id"], low["id"]]

    forbidden = client.patch(f"/api/admin/posts/{low['id']}", json={"is_hidden": True})
    assert forbidden.status_code == 403

    client.post("/api/auth/logout")
    admin = register(client, "admin@example.com")
    assert admin["role"] == "admin"
    hide = client.patch(f"/api/admin/posts/{low['id']}", json={"is_hidden": True})
    assert hide.status_code == 200
    admin_posts = client.get("/api/admin/posts")
    assert admin_posts.status_code == 200
    assert low["id"] in [post["id"] for post in admin_posts.json()]

    client.post("/api/auth/logout")
    register(client, "second@example.com")
    visible_posts = client.get("/api/posts").json()
    assert low["id"] not in [post["id"] for post in visible_posts]


def test_search_posts_matches_title_body_category_and_author(client: TestClient) -> None:
    register(client, email="lin@example.com")
    first = client.post(
        "/api/posts",
        data={"title": "前端组件讨论", "body": "按钮状态需要收口", "category": "讨论"},
    ).json()
    second = client.post(
        "/api/posts",
        data={"title": "接口排查", "body": "上传链路有一个疑问", "category": "求助"},
    ).json()

    by_title = client.get("/api/posts?q=前端").json()
    assert [post["id"] for post in by_title] == [first["id"]]

    by_body = client.get("/api/posts?q=上传").json()
    assert [post["id"] for post in by_body] == [second["id"]]

    by_category = client.get("/api/posts?q=求助").json()
    assert [post["id"] for post in by_category] == [second["id"]]

    by_author = client.get("/api/posts?q=格间用户").json()
    assert {post["id"] for post in by_author} == {first["id"], second["id"]}


def test_admin_can_restore_hidden_post(client: TestClient) -> None:
    register(client)
    post = client.post("/api/posts", data={"title": "需要恢复", "body": "先隐藏再恢复"}).json()
    client.post("/api/auth/logout")
    register(client, "admin@example.com")

    hidden = client.patch(f"/api/admin/posts/{post['id']}", json={"is_hidden": True})
    assert hidden.status_code == 200
    assert hidden.json()["is_hidden"] is True

    restored = client.patch(f"/api/admin/posts/{post['id']}", json={"is_hidden": False})
    assert restored.status_code == 200
    assert restored.json()["is_hidden"] is False

    client.post("/api/auth/logout")
    register(client, "third@example.com")
    visible_posts = client.get("/api/posts").json()
    assert post["id"] in [item["id"] for item in visible_posts]
