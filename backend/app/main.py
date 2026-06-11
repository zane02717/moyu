from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import activity, admin, auth, comments, health, notifications, posts, websocket
from app.core.config import get_settings
from app.db import Base, engine

settings = get_settings()
app = FastAPI(title="格间 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")


@app.on_event("startup")
def initialize_runtime() -> None:
    Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(notifications.router)
app.include_router(activity.router)
app.include_router(posts.router)
app.include_router(comments.router)
app.include_router(admin.router)
app.include_router(websocket.router)
