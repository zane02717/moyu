from functools import lru_cache
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
    max_image_bytes: int = 5 * 1024 * 1024
    max_images_per_request: int = 4

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings
