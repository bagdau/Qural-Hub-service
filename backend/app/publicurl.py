"""Публичный адрес приложения для ссылок в QR-кодах.

APP_PUBLIC_URL=auto — адрес берётся из запроса (то, что пользователь открыл в браузере: IP локальной сети, домен),
поэтому QR-коды остаются рабочими при смене IP-адреса компьютера. Иначе используется заданное значение.
"""
from contextvars import ContextVar

from .config import get_settings

_request_base: ContextVar[str | None] = ContextVar("request_base", default=None)


def remember_request(host: str | None, proto: str | None) -> None:
    host = (host or "").split(",")[0].strip()
    proto = (proto or "http").split(",")[0].strip()
    if host and proto in ("http", "https") and all(c.isalnum() or c in ".-:[]" for c in host):
        _request_base.set(f"{proto}://{host}")


def public_base() -> str:
    cfg = get_settings().app_public_url.rstrip("/")
    if cfg.lower() == "auto":
        return _request_base.get() or "http://localhost:8100"
    return cfg
