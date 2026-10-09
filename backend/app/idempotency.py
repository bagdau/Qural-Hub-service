import hashlib
import json
import uuid
from datetime import timedelta
from typing import Callable

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from . import clock
from .errors import ApiError
from .models import IdempotencyKey
from .security import Ctx


def canonical_hash(method: str, path: str, body) -> str:
    raw = json.dumps(jsonable_encoder(body), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(f"{method}\n{path}\n{raw}".encode()).hexdigest()


def run(db: DbSession, ctx: Ctx, request: Request, body, fn: Callable[[], tuple[int, object]],
        required: bool = True) -> JSONResponse:
    raw_key = request.headers.get("idempotency-key")
    if not raw_key:
        if required:
            raise ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Требуется заголовок Idempotency-Key.")
        status, out = fn()
        return JSONResponse(jsonable_encoder(out), status_code=status)
    try:
        key = uuid.UUID(raw_key)
    except ValueError:
        raise ApiError(400, "MALFORMED_REQUEST", "Idempotency-Key должен быть UUID.")
    h = canonical_hash(request.method, request.url.path, body)
    lock = int.from_bytes(hashlib.sha256(f"{ctx.user.id}:{key}".encode()).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock})
    now = clock.now()
    row = db.get(IdempotencyKey, (ctx.user.id, key))
    if row and row.expires_at > now:
        if row.request_hash != h:
            raise ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Этот Idempotency-Key уже использован с другим запросом.")
        return JSONResponse(row.response_body, status_code=row.response_status, headers={"Idempotent-Replay": "true"})
    if row:
        db.delete(row)
        db.flush()
    status, out = fn()
    enc = jsonable_encoder(out)
    db.add(IdempotencyKey(user_id=ctx.user.id, key=key, request_hash=h, response_status=status,
                          response_body=enc, created_at=now, expires_at=now + timedelta(hours=24)))
    return JSONResponse(enc, status_code=status)
