import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from ..db import SessionLocal
from ..realtime import Subscriber, hub
from ..security import get_ctx

router = APIRouter(tags=["realtime"])
KEEPALIVE_SECONDS = 15
MAX_STREAM_SECONDS = 3600  # затем клиент (EventSource) переподключается и заново проходит проверку сессии


def _auth(request: Request) -> tuple[str, str, str]:
    db = SessionLocal()
    try:
        ctx = get_ctx(request, db)
        db.commit()
        return ctx.role, str(ctx.user.id), str(ctx.user.organization_id)
    finally:
        db.close()


@router.get("/events/stream")
async def stream(request: Request):
    # аутентификация выполняется до открытия потока; соединение с БД на время потока не удерживается
    role, user_id, org_id = await run_in_threadpool(_auth, request)
    sub = Subscriber(loop=asyncio.get_running_loop(), queue=asyncio.Queue(maxsize=200), role=role, user_id=user_id, org_id=org_id)
    hub.subscribe(sub)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            yield 'event: ready\ndata: {}\n\n'
            waited = 0
            while waited < MAX_STREAM_SECONDS:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(sub.queue.get(), timeout=KEEPALIVE_SECONDS)
                    yield f"event: ticket\ndata: {json.dumps({k: msg[k] for k in ('ticket_id', 'number', 'status', 'type')})}\n\n"
                except asyncio.TimeoutError:
                    waited += KEEPALIVE_SECONDS
                    yield ": keepalive\n\n"
        finally:
            hub.unsubscribe(sub)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
