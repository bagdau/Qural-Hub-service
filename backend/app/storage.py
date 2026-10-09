"""Приватное файловое хранилище (том), выдача только через API."""
import hashlib
import os
import uuid
from pathlib import Path

from .clock import now
from .config import get_settings


def root() -> Path:
    return Path(get_settings().files_dir)


def ensure() -> None:
    for d in ("tmp", "attachments", "thumbs", "acts"):
        (root() / d).mkdir(parents=True, exist_ok=True)


def new_key(kind: str, ext: str) -> str:
    n = now()
    return f"{kind}/{n:%Y}/{n:%m}/{uuid.uuid4().hex}.{ext}"


def put(key: str, data: bytes) -> None:
    ensure()
    final = root() / key
    final.parent.mkdir(parents=True, exist_ok=True)
    tmp = root() / "tmp" / (uuid.uuid4().hex + ".part")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, final)


def read(key: str) -> bytes:
    with open(root() / key, "rb") as f:
        return f.read()


def exists(key: str) -> bool:
    return (root() / key).exists()


def delete(key: str | None) -> None:
    if key:
        try:
            (root() / key).unlink()
        except FileNotFoundError:
            pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def writable() -> bool:
    try:
        ensure()
        p = root() / "tmp" / ".probe"
        p.write_bytes(b"ok")
        p.unlink()
        return True
    except OSError:
        return False
