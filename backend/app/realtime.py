"""События в реальном времени (SSE) поверх PostgreSQL LISTEN/NOTIFY.

pg_notify вызывается внутри транзакции действия и доставляется только после COMMIT, поэтому
подписчики никогда не видят событие откатившегося действия. Сообщение не содержит данных заявки —
клиент перечитывает её через REST, где применяется политика видимости.
"""
import asyncio
import json
import logging
import threading
import time
from dataclasses import dataclass

import psycopg
from sqlalchemy import text

from .config import get_settings

log = logging.getLogger("realtime")
CHANNEL = "ash_events"
STAFF_ALL = ("admin", "dispatcher", "manager")


def notify(db, ticket, event_type: str, visibility: str = "public", extra_engineers=()) -> None:
    engineers = [str(x) for x in [ticket.assigned_engineer_id, *extra_engineers] if x]
    payload = {"ticket_id": str(ticket.id), "number": ticket.number, "status": ticket.status, "type": event_type,
               "org": str(ticket.organization_id), "engineers": engineers, "visibility": visibility}
    db.execute(text("SELECT pg_notify(:c, :p)"), {"c": CHANNEL, "p": json.dumps(payload)})


@dataclass(eq=False)
class Subscriber:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue
    role: str
    user_id: str
    org_id: str


def allowed(sub: Subscriber, msg: dict) -> bool:
    """Кому можно сообщить, что заявка изменилась (детали всё равно проверяются при чтении по REST)."""
    if sub.role in STAFF_ALL:
        return True
    if sub.role == "client":
        return msg.get("org") == sub.org_id and msg.get("visibility") == "public"
    if sub.role == "engineer":
        return sub.user_id in msg.get("engineers", [])
    return False


class Hub:
    def __init__(self):
        self.subs: set[Subscriber] = set()
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.stop = threading.Event()

    def subscribe(self, sub: Subscriber):
        with self.lock:
            self.subs.add(sub)

    def unsubscribe(self, sub: Subscriber):
        with self.lock:
            self.subs.discard(sub)

    def dispatch(self, msg: dict):
        with self.lock:
            targets = [s for s in self.subs if allowed(s, msg)]
        for s in targets:
            def put(s=s):
                try:
                    s.queue.put_nowait(msg)
                except asyncio.QueueFull:
                    pass
            try:
                s.loop.call_soon_threadsafe(put)
            except RuntimeError:
                pass

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stop.clear()
        self.thread = threading.Thread(target=self._run, name="pg-listen", daemon=True)
        self.thread.start()

    def _run(self):
        dsn = get_settings().db_url.replace("postgresql+psycopg://", "postgresql://")
        delay = 1.0
        while not self.stop.is_set():
            try:
                with psycopg.connect(dsn, autocommit=True) as conn:
                    conn.execute(f"LISTEN {CHANNEL}")
                    delay = 1.0
                    while not self.stop.is_set():
                        for n in conn.notifies(timeout=5):
                            try:
                                self.dispatch(json.loads(n.payload))
                            except Exception:  # noqa: BLE001
                                log.exception("не удалось разобрать событие")
            except Exception as exc:  # noqa: BLE001
                log.warning("LISTEN: соединение потеряно (%s), повтор через %.0f с", exc.__class__.__name__, delay)
                time.sleep(delay)
                delay = min(delay * 2, 15)


hub = Hub()
