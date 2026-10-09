"""Единственный источник времени (UTC). Режимы: system | fixed | shifted."""
import time
from datetime import datetime, timedelta, timezone

from .config import get_settings

_started_mono = time.monotonic()
_override: datetime | None = None  # только для тестов


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def now() -> datetime:
    if _override is not None:
        return _override
    s = get_settings()
    if s.app_clock_mode == "fixed":
        return _parse(s.app_fixed_now)
    if s.app_clock_mode == "shifted":
        return _parse(s.app_fixed_now) + timedelta(seconds=time.monotonic() - _started_mono)
    return datetime.now(timezone.utc)


def set_override(dt: datetime | None) -> None:
    global _override
    _override = dt


def parse_iso(s: str) -> datetime:
    return _parse(s)
