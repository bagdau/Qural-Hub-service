import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _read_file(path: str | None) -> str | None:
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_env: str = "dev"  # dev | test | demo | pilot
    app_version: str = "0.1.0"
    app_public_url: str = "http://localhost:8080"
    app_timezone_default: str = "Asia/Almaty"
    app_clock_mode: str = "system"  # system | fixed | shifted
    app_fixed_now: str = "2026-03-16T10:00:00Z"

    postgres_host: str = "db"
    postgres_port: int = 5432
    postgres_db: str = "alageum"
    postgres_user: str = "alageum_app"
    postgres_password: str = "alageum"
    postgres_password_file: str | None = None
    database_url: str | None = None

    secret_key: str = "dev-insecure-secret-change-me"
    secret_key_file: str | None = None
    cookie_secure: bool = False

    session_abs_ttl_hours: int = 168
    session_idle_ttl_hours: int = 24
    login_max_failures: int = 5
    login_lock_minutes: int = 15
    temp_password_ttl_hours: int = 72

    files_dir: str = "/var/lib/alageum/files"
    max_photo_mb: int = 10
    max_doc_mb: int = 20
    max_attachments_per_ticket: int = 40

    worker_enabled: bool = True
    log_level: str = "INFO"
    allow_demo_seed: bool = False
    demo_user_password: str | None = None
    demo_user_password_file: str | None = None
    enable_docs: bool = False

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        pw = _read_file(self.postgres_password_file) or self.postgres_password
        return (
            f"postgresql+psycopg://{self.postgres_user}:{pw}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def secret(self) -> str:
        return _read_file(self.secret_key_file) or self.secret_key

    @property
    def demo_password(self) -> str | None:
        return _read_file(self.demo_user_password_file) or self.demo_user_password

    def validate_for_env(self) -> None:
        if self.app_env == "pilot":
            if not self.cookie_secure:
                raise RuntimeError("COOKIE_SECURE must be true when APP_ENV=pilot")
            if self.allow_demo_seed:
                raise RuntimeError("ALLOW_DEMO_SEED must be false when APP_ENV=pilot")
            if self.secret == "dev-insecure-secret-change-me":
                raise RuntimeError("SECRET_KEY must be set when APP_ENV=pilot")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.validate_for_env()
    return s
