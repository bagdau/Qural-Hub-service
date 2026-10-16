from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .security import PHONE_RE

Priority = Literal["low", "normal", "high", "critical"]
Role = Literal["admin", "dispatcher", "engineer", "manager", "client"]
EqType = Literal["transformer", "substation", "switchgear"]
Unit = Literal["pcs", "l", "kg", "m", "set"]


class In(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


def _phone(v):
    if v in (None, ""):
        return None
    if not PHONE_RE.match(v):
        raise ValueError("Некорректный номер телефона.")
    return v


class LoginIn(In):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(In):
    current_password: str
    new_password: str


class UserCreate(In):
    email: str = Field(min_length=3, max_length=254)
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = None
    role: Role
    organization_id: UUID
    capacity: int | None = Field(default=None, ge=1, le=20)
    @field_validator("phone")
    @classmethod
    def _chk_phone(cls, v):
        return _phone(v)


class UserPatch(In):
    version: int
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = None
    role: Role | None = None
    organization_id: UUID | None = None
    capacity: int | None = Field(default=None, ge=1, le=20)
    @field_validator("phone")
    @classmethod
    def _chk_phone(cls, v):
        return _phone(v)


class VersionIn(In):
    version: int


class OrgIn(In):
    name: str = Field(min_length=2, max_length=200)
    short_name: str | None = Field(default=None, max_length=60)
    bin_iin: str | None = Field(default=None, pattern=r"^[0-9]{12}$")
    contact_email: str | None = Field(default=None, max_length=254)
    contact_phone: str | None = None
    address: str | None = Field(default=None, max_length=300)
    @field_validator("contact_phone")
    @classmethod
    def _chk_phone(cls, v):
        return _phone(v)


class OrgPatch(OrgIn):
    version: int
    name: str | None = Field(default=None, min_length=2, max_length=200)


class SiteIn(In):
    organization_id: UUID
    name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=5, max_length=300)
    timezone: str = "Asia/Almaty"
    contact_person: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _geo_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Укажите и широту, и долготу.")
        return self

    @field_validator("contact_phone")
    @classmethod
    def _chk_phone(cls, v):
        return _phone(v)


class SitePatch(In):
    version: int
    name: str | None = Field(default=None, min_length=2, max_length=120)
    address: str | None = Field(default=None, min_length=5, max_length=300)
    timezone: str | None = None
    contact_person: str | None = None
    contact_phone: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _geo_pair(self):
        sent = self.model_fields_set
        if ("latitude" in sent) != ("longitude" in sent) or ((self.latitude is None) != (self.longitude is None)):
            raise ValueError("Укажите и широту, и долготу (или очистите обе).")
        return self


class EquipmentIn(In):
    organization_id: UUID
    site_id: UUID
    type: EqType
    inventory_number: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=2, max_length=150)
    manufacturer: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    serial_number: str | None = Field(default=None, max_length=100)
    manufacture_year: int | None = Field(default=None, ge=1950, le=2100)
    commissioned_on: date | None = None
    voltage_class_kv: float | None = Field(default=None, gt=0, le=1150)
    rated_power_kva: float | None = Field(default=None, gt=0)
    technical_state: Literal["operational", "degraded", "out_of_service"] = "operational"
    location_description: str | None = Field(default=None, max_length=300)
    passport_data: dict = Field(default_factory=dict)
    notes: str | None = Field(default=None, max_length=2000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _geo_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Укажите и широту, и долготу (или очистите обе).")
        return self


class EquipmentPatch(In):
    version: int
    site_id: UUID | None = None
    inventory_number: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=2, max_length=150)
    manufacturer: str | None = None
    model: str | None = None
    serial_number: str | None = None
    manufacture_year: int | None = Field(default=None, ge=1950, le=2100)
    commissioned_on: date | None = None
    voltage_class_kv: float | None = Field(default=None, gt=0, le=1150)
    rated_power_kva: float | None = Field(default=None, gt=0)
    technical_state: Literal["operational", "degraded", "out_of_service"] | None = None
    location_description: str | None = None
    passport_data: dict | None = None
    notes: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _geo_pair(self):
        sent = self.model_fields_set
        if ("latitude" in sent) != ("longitude" in sent) or ((self.latitude is None) != (self.longitude is None)):
            raise ValueError("Укажите и широту, и долготу (или очистите обе).")
        return self


class PlanIn(In):
    equipment_id: UUID
    title: str = Field(min_length=3, max_length=150)
    description: str | None = Field(default=None, max_length=1000)
    interval_days: int = Field(ge=1, le=1825)
    lead_days: int = Field(default=7, ge=0, le=60)
    priority: Priority = "low"
    next_due_date: date


class PlanPatch(In):
    version: int
    title: str | None = Field(default=None, min_length=3, max_length=150)
    description: str | None = None
    interval_days: int | None = Field(default=None, ge=1, le=1825)
    lead_days: int | None = Field(default=None, ge=0, le=60)
    priority: Priority | None = None
    next_due_date: date | None = None


class TicketCreate(In):
    equipment_id: UUID
    title: str = Field(min_length=5, max_length=120)
    description: str = Field(min_length=10, max_length=4000)
    urgency: Literal["planned", "urgent", "emergency"] = "planned"
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = None
    related_ticket_id: UUID | None = None
    @field_validator("contact_phone")
    @classmethod
    def _chk_phone(cls, v):
        return _phone(v)


class TicketPatch(In):
    version: int
    title: str | None = Field(default=None, min_length=5, max_length=120)
    description: str | None = Field(default=None, min_length=10, max_length=4000)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = None
    scheduled_at: datetime | None = None
    @field_validator("contact_phone")
    @classmethod
    def _chk_phone(cls, v):
        return _phone(v)


class AcceptIn(In):
    version: int
    priority: Priority


class RejectIn(In):
    version: int
    reason_code: Literal["duplicate", "not_in_scope", "insufficient_info", "other"]
    comment: str = Field(min_length=10, max_length=2000)
    duplicate_of_ticket_id: UUID | None = None


class AssignIn(In):
    version: int
    engineer_id: UUID
    priority: Priority | None = None
    scheduled_at: datetime | None = None
    comment: str | None = Field(default=None, max_length=500)


class ReassignIn(In):
    version: int
    engineer_id: UUID
    reason: str = Field(min_length=5, max_length=500)


class PauseIn(In):
    version: int
    reason_code: Literal["waiting_client", "waiting_access", "waiting_parts", "shutdown_window", "other"]
    comment: str = Field(min_length=10, max_length=1000)
    next_action: str = Field(min_length=10, max_length=1000)
    expected_resume_at: datetime


class ResumeIn(In):
    version: int
    comment: str | None = Field(default=None, max_length=1000)


class ConfirmIn(In):
    version: int
    act_id: UUID
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ReturnIn(In):
    version: int
    act_id: UUID
    comment: str = Field(min_length=10, max_length=2000)


class CancelIn(In):
    version: int
    reason: str = Field(min_length=5, max_length=1000)


class PriorityIn(In):
    version: int
    priority: Priority
    reason: str = Field(min_length=5, max_length=500)


class ReportPut(In):
    version: int
    diagnosis: str | None = Field(default=None, max_length=4000)
    work_performed: str | None = Field(default=None, max_length=4000)
    result_code: Literal["resolved", "resolved_with_remarks"] | None = None
    result_summary: str | None = Field(default=None, max_length=1000)
    recommendations: str | None = Field(default=None, max_length=2000)
    labor_minutes: int | None = Field(default=None, ge=0, le=10000)
    checklist_answers: dict | None = None
    parts_confirmed: bool | None = None


class PhotoExceptionIn(In):
    version: int
    reason: str = Field(min_length=20, max_length=1000)


class PhotoExceptionDecision(In):
    version: int
    decision: Literal["approved", "rejected"]
    comment: str | None = Field(default=None, max_length=1000)


class PartIn(In):
    spare_part_id: UUID
    quantity: float = Field(gt=0, le=100000)
    serial_or_batch: str | None = Field(default=None, max_length=80)
    comment: str | None = Field(default=None, max_length=300)


class PartPatch(In):
    quantity: float | None = Field(default=None, gt=0, le=100000)
    serial_or_batch: str | None = Field(default=None, max_length=80)
    comment: str | None = Field(default=None, max_length=300)


class SparePartIn(In):
    sku: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=150)
    unit: Unit
    category: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=500)


class SparePartPatch(In):
    version: int
    name: str | None = Field(default=None, min_length=2, max_length=150)
    unit: Unit | None = None
    category: str | None = None
    description: str | None = None
    is_active: bool | None = None


class CommentIn(In):
    body: str = Field(min_length=1, max_length=4000)
    visibility: Literal["public", "internal"] | None = None


class TemplateIn(In):
    code: str = Field(pattern=r"^[a-z0-9_]{3,40}$")
    equipment_type: EqType
    title: str = Field(min_length=3, max_length=150)
    schema_: dict = Field(alias="schema")


class TemplatePatch(In):
    title: str | None = Field(default=None, min_length=3, max_length=150)
    schema_: dict | None = Field(default=None, alias="schema")


class SlaItem(In):
    priority: Priority
    reaction_minutes: int = Field(ge=1, le=100000)
    resolution_minutes: int = Field(ge=1, le=1000000)


class SlaPut(In):
    items: list[SlaItem]
