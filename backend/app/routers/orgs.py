from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DbSession

from .. import clock
from ..db import get_db
from ..errors import conflict, field_error, not_found
from ..models import Equipment, Organization, Site, Ticket
from ..schemas import OrgIn, OrgPatch, SiteIn, SitePatch, VersionIn
from ..security import Ctx, audit, get_ctx, require
from ..serializers import page_of
from ..sla import ACTIVE
from ..visibility import org_conditions, site_conditions
from .common import Page, apply_sort, paginate, strict_params, version_check

router = APIRouter(tags=["organizations"])


def _o(o: Organization) -> dict:
    return {"id": o.id, "kind": o.kind, "name": o.name, "short_name": o.short_name, "bin_iin": o.bin_iin,
            "contact_email": o.contact_email, "contact_phone": o.contact_phone, "address": o.address,
            "archived_at": o.archived_at, "version": o.version, "created_at": o.created_at}


def _s(s: Site) -> dict:
    return {"id": s.id, "organization_id": s.organization_id, "name": s.name, "address": s.address,
            "timezone": s.timezone, "contact_person": s.contact_person, "contact_phone": s.contact_phone,
            "latitude": float(s.latitude) if s.latitude is not None else None,
            "longitude": float(s.longitude) if s.longitude is not None else None,
            "archived_at": s.archived_at, "version": s.version}


def _uuid(x):
    import uuid
    try:
        return uuid.UUID(str(x))
    except ValueError:
        raise not_found()


@router.get("/organizations")
def list_orgs(request: Request, kind: str | None = None, q: str | None = None, archived: bool = False,
              sort: str | None = None, pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    strict_params(request, {"kind", "q", "archived"})
    qy = select(Organization).where(*org_conditions(ctx))
    if kind:
        qy = qy.where(Organization.kind == kind)
    if q:
        qy = qy.where(Organization.name.ilike(f"%{q}%"))
    qy = qy.where(Organization.archived_at.is_not(None) if archived else Organization.archived_at.is_(None))
    qy = apply_sort(qy, sort, {"name": Organization.name, "created_at": Organization.created_at}, [Organization.name, Organization.id])
    rows, total = paginate(db, qy, pg)
    return page_of([_o(o) for o in rows], total, pg.page, pg.page_size)


@router.post("/organizations", status_code=201)
def create_org(body: OrgIn, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    if db.scalar(select(Organization.id).where(func.lower(Organization.name) == body.name.lower())):
        raise conflict("DUPLICATE", "Организация с таким названием уже существует.")
    if body.bin_iin and db.scalar(select(Organization.id).where(Organization.bin_iin == body.bin_iin)):
        raise conflict("DUPLICATE", "Организация с таким БИН/ИИН уже существует.")
    now = clock.now()
    o = Organization(kind="client", created_at=now, updated_at=now, **body.model_dump())
    db.add(o)
    db.flush()
    audit(db, "organization_created", user=ctx.user, object_type="organization", object_id=o.id, request=request)
    return _o(o)


@router.get("/organizations/{org_id}")
def get_org(org_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    o = db.scalar(select(Organization).where(Organization.id == _uuid(org_id), *org_conditions(ctx)))
    if not o:
        raise not_found()
    return _o(o)


@router.patch("/organizations/{org_id}")
def patch_org(org_id: str, body: OrgPatch, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    o = db.scalar(select(Organization).where(Organization.id == _uuid(org_id)).with_for_update())
    if not o:
        raise not_found()
    version_check(o, body.version, "Организация")
    for k, v in body.model_dump(exclude_unset=True, exclude={"version"}).items():
        setattr(o, k, v)
    o.version += 1
    o.updated_at = clock.now()
    return _o(o)


@router.post("/organizations/{org_id}/archive")
def archive_org(org_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    o = db.scalar(select(Organization).where(Organization.id == _uuid(org_id)).with_for_update())
    if not o:
        raise not_found()
    version_check(o, body.version, "Организация")
    if o.kind == "service":
        raise conflict("INVALID_TRANSITION", "Сервисную организацию архивировать нельзя.")
    if db.scalar(select(func.count()).select_from(Ticket).where(Ticket.organization_id == o.id, Ticket.status.in_(list(ACTIVE)))):
        raise conflict("HAS_ACTIVE_TICKETS", "У организации есть активные заявки.")
    o.archived_at, o.version = clock.now(), o.version + 1
    audit(db, "entity_archived", user=ctx.user, object_type="organization", object_id=o.id, request=request)
    return _o(o)


@router.post("/organizations/{org_id}/unarchive")
def unarchive_org(org_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    o = db.scalar(select(Organization).where(Organization.id == _uuid(org_id)).with_for_update())
    if not o:
        raise not_found()
    version_check(o, body.version, "Организация")
    o.archived_at, o.version = None, o.version + 1
    audit(db, "entity_unarchived", user=ctx.user, object_type="organization", object_id=o.id, request=request)
    return _o(o)


@router.get("/sites")
def list_sites(request: Request, organization_id: str | None = None, q: str | None = None, archived: bool = False,
               sort: str | None = None, pg: Page = Depends(), ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    strict_params(request, {"organization_id", "q", "archived"})
    qy = select(Site).where(*site_conditions(ctx))
    if organization_id:
        qy = qy.where(Site.organization_id == _uuid(organization_id))
    if q:
        qy = qy.where(Site.name.ilike(f"%{q}%"))
    qy = qy.where(Site.archived_at.is_not(None) if archived else Site.archived_at.is_(None))
    qy = apply_sort(qy, sort, {"name": Site.name}, [Site.name, Site.id])
    rows, total = paginate(db, qy, pg)
    return page_of([_s(s) for s in rows], total, pg.page, pg.page_size)


@router.post("/sites", status_code=201)
def create_site(body: SiteIn, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    org = db.get(Organization, body.organization_id)
    if not org or org.kind != "client":
        raise field_error("organization_id", "invalid", "Выберите клиентскую организацию.")
    if db.scalar(select(Site.id).where(Site.organization_id == org.id, func.lower(Site.name) == body.name.lower())):
        raise conflict("DUPLICATE", "Площадка с таким названием уже есть у организации.")
    now = clock.now()
    s = Site(created_at=now, updated_at=now, **body.model_dump())
    db.add(s)
    db.flush()
    return _s(s)


@router.get("/sites/{site_id}")
def get_site(site_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    s = db.scalar(select(Site).where(Site.id == _uuid(site_id), *site_conditions(ctx)))
    if not s:
        raise not_found()
    return _s(s)


@router.patch("/sites/{site_id}")
def patch_site(site_id: str, body: SitePatch, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    s = db.scalar(select(Site).where(Site.id == _uuid(site_id)).with_for_update())
    if not s:
        raise not_found()
    version_check(s, body.version, "Площадка")
    for k, v in body.model_dump(exclude_unset=True, exclude={"version"}).items():
        setattr(s, k, v)
    s.version += 1
    s.updated_at = clock.now()
    return _s(s)


@router.post("/sites/{site_id}/archive")
def archive_site(site_id: str, body: VersionIn, request: Request, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    s = db.scalar(select(Site).where(Site.id == _uuid(site_id)).with_for_update())
    if not s:
        raise not_found()
    version_check(s, body.version, "Площадка")
    if db.scalar(select(func.count()).select_from(Equipment).where(Equipment.site_id == s.id, Equipment.archived_at.is_(None))):
        raise conflict("HAS_ACTIVE_EQUIPMENT", "На площадке есть неархивное оборудование.")
    s.archived_at, s.version = clock.now(), s.version + 1
    audit(db, "entity_archived", user=ctx.user, object_type="site", object_id=s.id, request=request)
    return _s(s)


@router.post("/sites/{site_id}/unarchive")
def unarchive_site(site_id: str, body: VersionIn, ctx: Ctx = Depends(require("admin")), db: DbSession = Depends(get_db, scope="function")):
    s = db.scalar(select(Site).where(Site.id == _uuid(site_id)).with_for_update())
    if not s:
        raise not_found()
    version_check(s, body.version, "Площадка")
    s.archived_at, s.version = None, s.version + 1
    return _s(s)
