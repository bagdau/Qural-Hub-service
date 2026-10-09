"""Планировщик: один активный экземпляр (advisory-lock), heartbeat для healthcheck."""
import logging
import time
from pathlib import Path

from sqlalchemy import text

from . import clock, jobs
from .config import get_settings
from .db import SessionLocal, engine
from .main import setup_logging, wait_for_db

log = logging.getLogger("worker")
LOCK_ID = 7101
HEARTBEAT = Path("/tmp/worker.heartbeat")


def beat():
    try:
        HEARTBEAT.write_text(str(time.time()))
    except OSError:
        pass


def tick(include_cleanup: bool):
    db = SessionLocal()
    try:
        res = jobs.run_all(db, clock.now(), include_cleanup=include_cleanup)
        db.commit()
        if any(v for v in res.values()):
            log.info("jobs: %s", res)
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("ошибка выполнения периодических задач")
    finally:
        db.close()


def main():
    setup_logging()
    if not get_settings().worker_enabled:
        log.info("worker отключён (WORKER_ENABLED=false)")
        while True:
            beat()
            time.sleep(30)
    wait_for_db()
    conn = engine().connect()
    while True:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_ID}).scalar()
        conn.commit()
        if got:
            break
        beat()
        time.sleep(10)
    log.info("worker запущен")
    n = 0
    while True:
        beat()
        tick(include_cleanup=(n % 60 == 0))
        n += 1
        for _ in range(6):
            beat()
            time.sleep(10)


if __name__ == "__main__":
    main()
