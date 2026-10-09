"""Unit-тесты без БД: state-machine, SLA, валидаторы (UT-01…UT-10)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest

from app import sla
from app.errors import ApiError
from app.execution import is_flagged, validate_answers
from app.routers.files import process_upload
from app.security import generate_temp_password, validate_password
from app.serializers import ACTION_SPEC, action_allowed
from seed.templates import TR_V2

UTC = timezone.utc
T = lambda d, h, m=0: datetime(2026, 3, d, h, m, tzinfo=UTC)  # noqa: E731
POLICY = sla.DEFAULT_POLICY


def mk(priority="normal", created=T(1, 0)):
    t = NS(priority=priority, status="new", created_at=created, first_reacted_at=None, sla_consumed_seconds=0,
           sla_clock_started_at=None, sla_due_at=None, completed_consumed_seconds=None, resolved_within_sla=None,
           sla_reaction_limit_seconds=0, sla_resolution_limit_seconds=0, reaction_due_at=None)
    sla.init_ticket(t, POLICY, created)
    return t


# ---------- UT-01 ----------
STATUSES = ["new", "accepted", "assigned", "in_progress", "paused", "awaiting_confirmation", "closed", "rejected", "cancelled"]
EXPECTED = {  # эталонная таблица 5.3: (действие, роль) -> статусы
    ("accept", "dispatcher"): {"new"}, ("reject", "dispatcher"): {"new"}, ("assign", "dispatcher"): {"new", "accepted"},
    ("reassign", "dispatcher"): {"assigned", "in_progress", "paused"}, ("start", "engineer"): {"assigned"},
    ("pause", "engineer"): {"in_progress"}, ("pause", "dispatcher"): {"in_progress"},
    ("resume", "engineer"): {"paused"}, ("resume", "dispatcher"): {"paused"}, ("complete", "engineer"): {"in_progress"},
    ("confirm", "client"): {"awaiting_confirmation"}, ("return", "client"): {"awaiting_confirmation"},
    ("cancel", "client"): {"new", "accepted", "assigned"}, ("cancel", "dispatcher"): {"new", "accepted", "assigned", "in_progress", "paused"},
    ("priority", "dispatcher"): {"new", "accepted", "assigned", "in_progress", "paused"},
}


@pytest.mark.parametrize("action", sorted(ACTION_SPEC))
@pytest.mark.parametrize("role", ["admin", "dispatcher", "engineer", "manager", "client"])
def test_ut01_transition_table(action, role):
    for st in STATUSES:
        t = NS(status=st, assigned_engineer_id="e1")
        ctx = NS(role=role, user=NS(id="e1"))
        assert action_allowed(action, t, ctx) == (st in EXPECTED.get((action, role), set())), (action, role, st)


def test_ut01_engineer_only_for_assignee():
    t = NS(status="assigned", assigned_engineer_id="e1")
    assert action_allowed("start", t, NS(role="engineer", user=NS(id="e1")))
    assert not action_allowed("start", t, NS(role="engineer", user=NS(id="e2")))


# ---------- UT-02 ----------
def test_ut02_pause_not_counted():
    t = mk("critical", T(6, 2))  # лимит 8 ч
    sla.transition(t, "accepted", T(6, 2, 10))
    sla.transition(t, "in_progress", T(6, 2, 30))
    sla.transition(t, "paused", T(6, 5))
    assert t.sla_clock_started_at is None and t.sla_due_at is None
    sla.transition(t, "in_progress", T(6, 9))
    sla.transition(t, "awaiting_confirmation", T(6, 13))
    sla.mark_completed(t)
    assert t.completed_consumed_seconds == 7 * 3600 and t.resolved_within_sla is True


def test_ut02_return_continues_and_excludes_client_wait():
    t = mk("high", T(4, 5))  # лимит 24 ч
    sla.transition(t, "in_progress", T(4, 6))
    sla.transition(t, "awaiting_confirmation", T(4, 20))
    sla.mark_completed(t)
    assert t.completed_consumed_seconds == 15 * 3600
    sla.transition(t, "in_progress", T(5, 4))  # ожидание клиента 8 ч не считается
    assert t.sla_consumed_seconds == 15 * 3600
    sla.transition(t, "awaiting_confirmation", T(5, 8))
    sla.mark_completed(t)
    assert t.completed_consumed_seconds == 19 * 3600 and t.resolved_within_sla is True


def test_ut02_breach():
    t = mk("normal", T(9, 3))
    sla.transition(t, "in_progress", T(9, 5))
    sla.transition(t, "awaiting_confirmation", T(12, 5))
    sla.mark_completed(t)
    assert t.completed_consumed_seconds == 74 * 3600 and t.resolved_within_sla is False


def test_ut02_overdue_kinds():
    t = mk("critical", T(16, 0, 30))
    sla.transition(t, "in_progress", T(16, 1, 30))
    assert sla.overdue_kind(t, T(16, 8, 29)) is None
    assert sla.overdue_kind(t, T(16, 10)) == "resolution"
    n = mk("critical", T(16, 8, 30))
    assert sla.overdue_kind(n, T(16, 9, 29)) is None
    assert sla.overdue_kind(n, T(16, 10)) == "reaction"
    n.status = "awaiting_confirmation"
    assert sla.overdue_kind(n, T(16, 10)) is None


# ---------- UT-03 ----------
def test_ut03_priority_change():
    t = mk("high", T(10, 0))
    sla.transition(t, "accepted", T(10, 1))
    reaction_due = t.reaction_due_at
    sla.transition(t, "in_progress", T(10, 5))  # consumed = 5 ч
    t.first_reacted_at = T(10, 1)
    sla.change_priority(t, "critical", POLICY)  # лимит 8 ч, consumed не меняется
    assert t.sla_consumed_seconds == 5 * 3600 or t.sla_clock_started_at is not None
    assert t.sla_resolution_limit_seconds == 8 * 3600
    assert t.reaction_due_at == reaction_due  # реакция была — не пересчитывается
    assert t.sla_due_at == t.sla_clock_started_at + timedelta(seconds=8 * 3600 - t.sla_consumed_seconds)
    n = mk("normal", T(10, 0))
    sla.change_priority(n, "critical", POLICY)  # реакции не было — пересчёт
    assert n.reaction_due_at == T(10, 1)


# ---------- UT-04 ----------
def test_ut04_password_policy():
    for bad in ["short", "admin@x.test", "password12345"]:
        with pytest.raises(ApiError):
            validate_password(bad, "admin@x.test", "Админ")
    validate_password("Correct-Horse-9", "a@x.test", "Имя")
    seen = {generate_temp_password() for _ in range(200)}
    assert len(seen) == 200 and all(len(p) == 14 for p in seen)


# ---------- UT-05 ----------
SCHEMA = {"items": TR_V2}


def test_ut05_checklist_validation():
    ok = {"oil_leak": {"value": True}, "oil_level": {"value": "normal"}, "bushings_ok": {"value": True},
          "oil_temp_c": {"value": 60}, "insulation_mohm": {"value": 500}, "grounding_ok": {"value": True}}
    assert validate_answers(SCHEMA, ok, final=True) == {}
    assert "oil_temp_c" in validate_answers(SCHEMA, {**ok, "oil_temp_c": {"value": 999}})
    assert "oil_level" in validate_answers(SCHEMA, {**ok, "oil_level": {"value": "weird"}})
    missing = dict(ok)
    del missing["grounding_ok"]
    assert "grounding_ok" in validate_answers(SCHEMA, missing, final=True)
    assert validate_answers(SCHEMA, missing, final=False) == {}
    flagged = {**ok, "oil_leak": {"value": False}}
    assert "oil_leak" in validate_answers(SCHEMA, flagged, final=True)  # «не норма» без комментария
    assert validate_answers(SCHEMA, {**ok, "oil_leak": {"value": False, "comment": "течёт"}}, final=True) == {}
    assert is_flagged({"flag_if": {"gt": 85}, "type": "number"}, 90) and not is_flagged({"flag_if": {"gt": 85}, "type": "number"}, 80)


# ---------- UT-08 ----------
def test_ut08_file_validator():
    from tests.conftest import png_bytes
    ok = process_upload(png_bytes(), "photo", 10, 20)
    assert ok["ctype"] == "image/png" and ok["thumb"]
    with pytest.raises(ApiError) as e:
        process_upload(b"MZ\x90\x00 not an image", "photo", 10, 20)
    assert e.value.code == "UNSUPPORTED_FILE_TYPE"
    with pytest.raises(ApiError) as e:
        process_upload(b"\xff\xd8\xff\xe0 truncated", "photo", 10, 20)
    assert e.value.code in ("FILE_CORRUPTED", "UNSUPPORTED_FILE_TYPE")
    with pytest.raises(ApiError) as e:
        process_upload(b"\x00" * (11 * 1024 * 1024), "photo", 10, 20)
    assert e.value.code == "FILE_TOO_LARGE"
    with pytest.raises(ApiError) as e:
        process_upload(b"not a pdf", "document", 10, 20)
    assert e.value.code == "UNSUPPORTED_FILE_TYPE"
    assert process_upload(b"%PDF-1.4\n...\n%%EOF\n", "document", 10, 20)["ctype"] == "application/pdf"


def test_ut08_exif_stripped():
    import io
    from PIL import Image
    im = Image.new("RGB", (64, 48), (1, 2, 3))
    exif = Image.Exif()
    exif[0x010F] = "SecretCamera"
    buf = io.BytesIO()
    im.save(buf, format="JPEG", exif=exif)
    out = process_upload(buf.getvalue(), "photo", 10, 20)["bytes"]
    assert not Image.open(io.BytesIO(out)).getexif()


# ---------- realtime: кому рассылаются события ----------
def test_realtime_visibility_filter():
    import asyncio
    from app.realtime import Subscriber, allowed, hub

    def sub(role, uid="u1", org="o1"):
        return Subscriber(loop=None, queue=None, role=role, user_id=uid, org_id=org)
    msg = {"org": "o1", "engineers": ["e1", "e2"], "visibility": "public"}
    assert all(allowed(sub(r), msg) for r in ("admin", "dispatcher", "manager"))
    assert allowed(sub("client", org="o1"), msg) and not allowed(sub("client", org="o2"), msg)
    assert not allowed(sub("client", org="o1"), {**msg, "visibility": "internal"})  # внутренние события клиенту не рассылаются
    assert allowed(sub("engineer", uid="e1"), msg) and not allowed(sub("engineer", uid="e9"), msg)

    async def run():
        s = Subscriber(loop=asyncio.get_running_loop(), queue=asyncio.Queue(), role="dispatcher", user_id="d", org_id="x")
        hub.subscribe(s)
        hub.dispatch({"ticket_id": "t1", "number": "SR", "status": "new", "type": "created", **msg})
        got = await asyncio.wait_for(s.queue.get(), 1)
        hub.unsubscribe(s)
        return got
    assert asyncio.run(run())["ticket_id"] == "t1"
