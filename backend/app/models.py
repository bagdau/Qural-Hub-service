import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint,
    Identity, Index, Integer, LargeBinary, Numeric, SmallInteger, String, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

TS = DateTime(timezone=True)


def _id():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _in(col: str, values: list[str]) -> str:
    return f"{col} IN (" + ",".join(f"'{v}'" for v in values) + ")"


ROLES = ["admin", "dispatcher", "engineer", "manager", "client"]
STATUSES = ["new", "accepted", "assigned", "in_progress", "paused", "awaiting_confirmation",
            "closed", "rejected", "cancelled"]
PRIORITIES = ["low", "normal", "high", "critical"]


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = _id()
    kind: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(Text)
    short_name: Mapped[str | None] = mapped_column(Text)
    bin_iin: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(Text)
    contact_phone: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        CheckConstraint(_in("kind", ["service", "client"]), name="ck_org_kind"),
        Index("uq_org_name", text("lower(name)"), unique=True),
        Index("uq_org_single_service", "kind", unique=True, postgresql_where=text("kind='service'")),
        Index("uq_org_bin", "bin_iin", unique=True, postgresql_where=text("bin_iin IS NOT NULL")),
    )


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[uuid.UUID] = _id()
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(Text)
    address: Mapped[str] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text, default="Asia/Almaty", server_default="Asia/Almaty")
    contact_person: Mapped[str | None] = mapped_column(Text)
    contact_phone: Mapped[str | None] = mapped_column(Text)
    latitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[float | None] = mapped_column(Numeric(9, 6))
    archived_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        UniqueConstraint("id", "organization_id", name="uq_site_id_org"),
        Index("uq_site_name", "organization_id", text("lower(name)"), unique=True),
    )


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _id()
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(Text)
    full_name: Mapped[str] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(12))
    password_hash: Mapped[str] = mapped_column(Text)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    temp_password_expires_at: Mapped[datetime | None] = mapped_column(TS)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(TS)
    last_login_at: Mapped[datetime | None] = mapped_column(TS)
    capacity: Mapped[int] = mapped_column(SmallInteger, default=4, server_default="4")
    deactivated_at: Mapped[datetime | None] = mapped_column(TS)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="ck_user_role"),
        Index("uq_user_email", text("lower(email)"), unique=True),
        Index("ix_user_org_role", "organization_id", "role"),
    )


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_at: Mapped[datetime] = mapped_column(TS)
    last_seen_at: Mapped[datetime] = mapped_column(TS)
    idle_expires_at: Mapped[datetime] = mapped_column(TS)
    expires_at: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)
    revoke_reason: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_session_user_active", "user_id", postgresql_where=text("revoked_at IS NULL")),)


class Equipment(Base):
    __tablename__ = "equipment"
    id: Mapped[uuid.UUID] = _id()
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    site_id: Mapped[uuid.UUID] = mapped_column()
    type: Mapped[str] = mapped_column(String(20))
    inventory_number: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    manufacturer: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    serial_number: Mapped[str | None] = mapped_column(Text)
    manufacture_year: Mapped[int | None] = mapped_column(SmallInteger)
    commissioned_on: Mapped[date | None] = mapped_column(Date)
    voltage_class_kv: Mapped[float | None] = mapped_column(Numeric(7, 2))
    rated_power_kva: Mapped[float | None] = mapped_column(Numeric(10, 2))
    technical_state: Mapped[str] = mapped_column(String(20), default="operational", server_default="operational")
    location_description: Mapped[str | None] = mapped_column(Text)
    passport_data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    qr_code: Mapped[str] = mapped_column(String(12), unique=True)
    qr_rotated_at: Mapped[datetime | None] = mapped_column(TS)
    notes: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        ForeignKeyConstraint(["site_id", "organization_id"], ["sites.id", "sites.organization_id"],
                             name="fk_equipment_site_org"),
        UniqueConstraint("id", "organization_id", name="uq_equipment_id_org"),
        UniqueConstraint("organization_id", "inventory_number", name="uq_equipment_inv"),
        CheckConstraint(_in("type", ["transformer", "substation", "switchgear"]), name="ck_eq_type"),
        CheckConstraint(_in("technical_state", ["operational", "degraded", "out_of_service"]), name="ck_eq_state"),
    )


class MaintenancePlan(Base):
    __tablename__ = "maintenance_plans"
    id: Mapped[uuid.UUID] = _id()
    equipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment.id"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    interval_days: Mapped[int] = mapped_column(Integer)
    lead_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
    priority: Mapped[str] = mapped_column(String(10), default="low", server_default="low")
    checklist_code: Mapped[str | None] = mapped_column(Text)
    last_done_on: Mapped[date | None] = mapped_column(Date)
    next_due_date: Mapped[date] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (Index("ix_plan_due", "is_active", "next_due_date"),)


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[uuid.UUID] = _id()
    number: Mapped[str] = mapped_column(Text, unique=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    equipment_id: Mapped[uuid.UUID] = mapped_column()
    site_id: Mapped[uuid.UUID] = mapped_column()
    kind: Mapped[str] = mapped_column(String(12), default="corrective", server_default="corrective")
    source: Mapped[str] = mapped_column(String(12), default="web", server_default="web")
    plan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("maintenance_plans.id"))
    plan_due_date: Mapped[date | None] = mapped_column(Date)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    urgency: Mapped[str] = mapped_column(String(12), default="planned", server_default="planned")
    priority: Mapped[str] = mapped_column(String(10), default="normal", server_default="normal")
    status: Mapped[str] = mapped_column(String(24), default="new", server_default="new")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    contact_name: Mapped[str | None] = mapped_column(Text)
    contact_phone: Mapped[str | None] = mapped_column(Text)
    related_ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id"))
    assigned_engineer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    scheduled_at: Mapped[datetime | None] = mapped_column(TS)
    sla_reaction_limit_seconds: Mapped[int] = mapped_column(Integer)
    sla_resolution_limit_seconds: Mapped[int] = mapped_column(Integer)
    reaction_due_at: Mapped[datetime] = mapped_column(TS)
    first_reacted_at: Mapped[datetime | None] = mapped_column(TS)
    sla_consumed_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sla_clock_started_at: Mapped[datetime | None] = mapped_column(TS)
    sla_due_at: Mapped[datetime | None] = mapped_column(TS)
    completed_consumed_seconds: Mapped[int | None] = mapped_column(Integer)
    resolved_within_sla: Mapped[bool | None] = mapped_column(Boolean)
    pause_reason_code: Mapped[str | None] = mapped_column(Text)
    pause_comment: Mapped[str | None] = mapped_column(Text)
    pause_next_action: Mapped[str | None] = mapped_column(Text)
    pause_expected_resume_at: Mapped[datetime | None] = mapped_column(TS)
    accepted_at: Mapped[datetime | None] = mapped_column(TS)
    started_at: Mapped[datetime | None] = mapped_column(TS)
    completed_at: Mapped[datetime | None] = mapped_column(TS)
    closed_at: Mapped[datetime | None] = mapped_column(TS)
    rejected_at: Mapped[datetime | None] = mapped_column(TS)
    cancelled_at: Mapped[datetime | None] = mapped_column(TS)
    return_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    archived_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        ForeignKeyConstraint(["equipment_id", "organization_id"], ["equipment.id", "equipment.organization_id"],
                             name="fk_ticket_equipment_org"),
        ForeignKeyConstraint(["site_id", "organization_id"], ["sites.id", "sites.organization_id"],
                             name="fk_ticket_site_org"),
        CheckConstraint(_in("status", STATUSES), name="ck_ticket_status"),
        CheckConstraint(_in("priority", PRIORITIES), name="ck_ticket_priority"),
        CheckConstraint(_in("kind", ["corrective", "planned"]), name="ck_ticket_kind"),
        CheckConstraint("(status = 'paused') = (pause_reason_code IS NOT NULL AND pause_comment IS NOT NULL "
                        "AND pause_next_action IS NOT NULL AND pause_expected_resume_at IS NOT NULL)",
                        name="ck_ticket_pause_fields"),
        CheckConstraint("(sla_clock_started_at IS NOT NULL) = (status IN ('new','accepted','assigned','in_progress'))",
                        name="ck_ticket_clock"),
        CheckConstraint("archived_at IS NULL OR status IN ('closed','rejected','cancelled')", name="ck_ticket_archive"),
        CheckConstraint("status NOT IN ('assigned','in_progress','paused','awaiting_confirmation') "
                        "OR assigned_engineer_id IS NOT NULL", name="ck_ticket_engineer"),
        Index("uq_ticket_plan", "plan_id", "plan_due_date", unique=True, postgresql_where=text("plan_id IS NOT NULL")),
        Index("ix_ticket_status", "status"),
        Index("ix_ticket_org_status", "organization_id", "status", text("created_at DESC")),
        Index("ix_ticket_engineer", "assigned_engineer_id", "status"),
        Index("ix_ticket_equipment", "equipment_id", text("created_at DESC")),
        Index("ix_ticket_created", text("created_at DESC")),
    )


class TicketEvent(Base):
    __tablename__ = "ticket_events"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"))
    event_type: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(10), default="public", server_default="public")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_role: Mapped[str | None] = mapped_column(Text)
    from_status: Mapped[str | None] = mapped_column(Text)
    to_status: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(TS)
    __table_args__ = (Index("ix_event_ticket", "ticket_id", "id"),)


class Assignment(Base):
    __tablename__ = "assignments"
    id: Mapped[uuid.UUID] = _id()
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"))
    engineer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    assigned_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(TS)
    scheduled_at: Mapped[datetime | None] = mapped_column(TS)
    comment: Mapped[str | None] = mapped_column(Text)
    ended_at: Mapped[datetime | None] = mapped_column(TS)
    end_reason: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("(ended_at IS NULL) = (end_reason IS NULL)", name="ck_assign_end"),
        Index("uq_assign_active", "ticket_id", unique=True, postgresql_where=text("ended_at IS NULL")),
        Index("ix_assign_engineer", "engineer_id", postgresql_where=text("ended_at IS NULL")),
    )


class ChecklistTemplate(Base):
    __tablename__ = "checklist_templates"
    id: Mapped[uuid.UUID] = _id()
    code: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    equipment_type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(Text)
    schema: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(10), default="draft")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS)
    published_at: Mapped[datetime | None] = mapped_column(TS)
    retired_at: Mapped[datetime | None] = mapped_column(TS)
    __table_args__ = (
        UniqueConstraint("code", "version", name="uq_template_code_ver"),
        CheckConstraint(_in("status", ["draft", "active", "retired"]), name="ck_tpl_status"),
        Index("uq_template_active_type", "equipment_type", unique=True, postgresql_where=text("status='active'")),
    )


class WorkReport(Base):
    __tablename__ = "work_reports"
    id: Mapped[uuid.UUID] = _id()
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    checklist_template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("checklist_templates.id"))
    checklist_answers: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    diagnosis: Mapped[str | None] = mapped_column(Text)
    work_performed: Mapped[str | None] = mapped_column(Text)
    result_code: Mapped[str | None] = mapped_column(Text)
    result_summary: Mapped[str | None] = mapped_column(Text)
    recommendations: Mapped[str | None] = mapped_column(Text)
    labor_minutes: Mapped[int | None] = mapped_column(Integer)
    parts_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    photo_exception_status: Mapped[str] = mapped_column(String(10), default="none", server_default="none")
    photo_exception_reason: Mapped[str | None] = mapped_column(Text)
    photo_exception_decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    photo_exception_decided_at: Mapped[datetime | None] = mapped_column(TS)
    photo_exception_comment: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        UniqueConstraint("ticket_id", "revision", name="uq_report_rev"),
        CheckConstraint(_in("status", ["draft", "submitted", "superseded"]), name="ck_report_status"),
        Index("uq_report_draft", "ticket_id", unique=True, postgresql_where=text("status='draft'")),
    )


class SparePart(Base):
    __tablename__ = "spare_parts"
    id: Mapped[uuid.UUID] = _id()
    sku: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(5))
    category: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=text("now()"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        CheckConstraint(_in("unit", ["pcs", "l", "kg", "m", "set"]), name="ck_part_unit"),
        Index("uq_part_sku", text("lower(sku)"), unique=True),
    )


class PartUsage(Base):
    __tablename__ = "part_usages"
    id: Mapped[uuid.UUID] = _id()
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"))
    work_report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("work_reports.id"))
    spare_part_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spare_parts.id"))
    quantity: Mapped[float] = mapped_column(Numeric(12, 3))
    unit_snapshot: Mapped[str] = mapped_column(String(5))
    serial_or_batch: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    added_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS)
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_usage_qty"),
        UniqueConstraint("work_report_id", "spare_part_id", name="uq_usage_report_part"),
        Index("ix_usage_ticket", "ticket_id"),
    )


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[uuid.UUID] = _id()
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id"))
    equipment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("equipment.id"))
    work_report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("work_reports.id"))
    kind: Mapped[str] = mapped_column(String(10))
    stage: Mapped[str | None] = mapped_column(String(10))
    visibility: Mapped[str] = mapped_column(String(10), default="public", server_default="public")
    original_filename: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    thumb_storage_key: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(TS)
    deleted_at: Mapped[datetime | None] = mapped_column(TS)
    __table_args__ = (
        CheckConstraint("num_nonnulls(ticket_id, equipment_id) = 1", name="ck_att_owner"),
        CheckConstraint(_in("kind", ["photo", "document"]), name="ck_att_kind"),
        Index("ix_att_ticket", "ticket_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_att_equipment", "equipment_id", postgresql_where=text("deleted_at IS NULL")),
    )


class Act(Base):
    __tablename__ = "acts"
    id: Mapped[uuid.UUID] = _id()
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"))
    work_report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("work_reports.id"), unique=True)
    version: Mapped[int] = mapped_column(Integer)
    number: Mapped[str] = mapped_column(Text, unique=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    superseded_at: Mapped[datetime | None] = mapped_column(TS)
    layout_version: Mapped[str] = mapped_column(Text, default="act_v1")
    data_snapshot: Mapped[dict] = mapped_column(JSONB)
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    generated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    generated_at: Mapped[datetime] = mapped_column(TS)
    decision: Mapped[str | None] = mapped_column(String(10))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(TS)
    decision_comment: Mapped[str | None] = mapped_column(Text)
    rating: Mapped[int | None] = mapped_column(SmallInteger)
    __table_args__ = (
        UniqueConstraint("ticket_id", "version", name="uq_act_ticket_ver"),
        Index("uq_act_current", "ticket_id", unique=True, postgresql_where=text("is_current")),
    )


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[uuid.UUID] = _id()
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(10), default="public", server_default="public")
    created_at: Mapped[datetime] = mapped_column(TS)
    __table_args__ = (Index("ix_comment_ticket", "ticket_id", "created_at"),)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = _id()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id"))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    dedupe_key: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS)
    read_at: Mapped[datetime | None] = mapped_column(TS)
    __table_args__ = (
        Index("uq_notif_dedupe", "user_id", "dedupe_key", unique=True, postgresql_where=text("dedupe_key IS NOT NULL")),
        Index("ix_notif_user", "user_id", text("created_at DESC")),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(TS)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_role: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    object_type: Mapped[str | None] = mapped_column(Text)
    object_id: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    __table_args__ = (Index("ix_audit_time", text("occurred_at DESC")),)


class SlaPolicy(Base):
    __tablename__ = "sla_policies"
    priority: Mapped[str] = mapped_column(String(10), primary_key=True)
    reaction_minutes: Mapped[int] = mapped_column(Integer)
    resolution_minutes: Mapped[int] = mapped_column(Integer)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime | None] = mapped_column(TS)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class NumberCounter(Base):
    __tablename__ = "number_counters"
    year: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, default=0)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    response_status: Mapped[int] = mapped_column(Integer)
    response_body: Mapped[dict | list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TS)
    expires_at: Mapped[datetime] = mapped_column(TS)
    __table_args__ = (Index("ix_idem_exp", "expires_at"),)


class JobRun(Base):
    __tablename__ = "job_runs"
    id: Mapped[uuid.UUID] = _id()
    job_name: Mapped[str] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(10), default="running")
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")


class AppMeta(Base):
    __tablename__ = "app_meta"
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime | None] = mapped_column(TS)
