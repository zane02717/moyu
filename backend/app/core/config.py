from functools import lru_cache
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "格间"
    database_url: str = "sqlite:///./gejian.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    cookie_name: str = "gejian_session"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    admin_email: str | None = None
    invite_code: str | None = None
    uploads_dir: Path = Path("uploads")
    blob_read_write_token: str | None = None
    max_image_bytes: int = 5 * 1024 * 1024
    max_images_per_request: int = 4

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if os.getenv("VERCEL") and settings.uploads_dir == Path("uploads"):
        settings.uploads_dir = Path("/tmp/uploads")
    if os.getenv("VERCEL") and settings.database_url == "sqlite:///./gejian.db":
        settings.database_url = "sqlite:////tmp/gejian.db"
    if settings.database_url.startswith("postgres://"):
        settings.database_url = settings.database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif settings.database_url.startswith("postgresql://"):
        settings.database_url = settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return settings
