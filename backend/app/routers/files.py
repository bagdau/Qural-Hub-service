import io
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .. import clock, idempotency, storage
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError, conflict, field_error, not_found
from ..models import Attachment, Ticket, WorkReport
from ..security import Ctx, audit, audit_isolated, get_ctx, require
from ..sla import TERMINAL
from ..visibility import get_equipment, get_ticket
from ..workflow import add_event
from ..execution import draft_report

router = APIRouter(tags=["files"])
Image.MAX_IMAGE_PIXELS = 40_000_000
PHOTO_FORMATS = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"), "WEBP": ("image/webp", "webp")}


def _uuid(x):
    try:
        return uuid.UUID(str(x))
    except ValueError:
        raise not_found()


def clean_filename(name: str) -> str:
    name = (name or "file").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f]", "", name).strip()
    return name[:200] or "file"


def att_out(a: Attachment) -> dict:
    return {"id": a.id, "kind": a.kind, "stage": a.stage, "visibility": a.visibility,
            "original_filename": a.original_filename, "content_type": a.content_type, "size_bytes": a.size_bytes,
            "width": a.width, "height": a.height, "uploaded_by": a.uploaded_by, "uploaded_at": a.uploaded_at,
            "urls": {"download": f"/api/v1/attachments/{a.id}/download",
                     "thumbnail": f"/api/v1/attachments/{a.id}/thumbnail" if a.thumb_storage_key else None}}


def process_upload(data: bytes, kind: str, mb_photo: int, mb_doc: int) -> dict:
    """Проверка по содержимому. Возвращает данные для записи и сохранения."""
    if kind == "photo":
        if len(data) > mb_photo * 1024 * 1024:
            raise ApiError(413, "FILE_TOO_LARGE", f"Фото не должно превышать {mb_photo} МБ.")
        try:
            im = Image.open(io.BytesIO(data))
            fmt = im.format
            if fmt not in PHOTO_FORMATS:
                raise ApiError(415, "UNSUPPORTED_FILE_TYPE", "Допустимы фото JPEG, PNG и WebP (HEIC не поддерживается).")
            im.load()
        except ApiError:
            raise
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
            if data[:4] in (b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"\x89PNG") or data[:2] == b"\xff\xd8":
                raise ApiError(422, "FILE_CORRUPTED", "Файл повреждён и не может быть обработан.")
            raise ApiError(415, "UNSUPPORTED_FILE_TYPE", "Допустимы фото JPEG, PNG и WebP (определяется по содержимому файла).")
        im = ImageOps.exif_transpose(im)
        ctype, ext = PHOTO_FORMATS[fmt]
        out = io.BytesIO()
        clean = im.convert("RGB") if fmt == "JPEG" else im
        clean.save(out, format=fmt, quality=88) if fmt != "PNG" else clean.save(out, format="PNG")  # без EXIF
        thumb = im.copy()
        thumb.thumbnail((480, 480))
        tb = io.BytesIO()
        thumb.convert("RGB").save(tb, format="JPEG", quality=80)
        return {"bytes": out.getvalue(), "ctype": ctype, "ext": ext, "w": im.width, "h": im.height, "thumb": tb.getvalue()}
    if len(data) > mb_doc * 1024 * 1024:
        raise ApiError(413, "FILE_TOO_LARGE", f"Документ не должен превышать {mb_doc} МБ.")
    if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
        raise ApiError(415, "UNSUPPORTED_FILE_TYPE", "Допустим только корректный PDF-документ.")
    return {"bytes": data, "ctype": "application/pdf", "ext": "pdf", "w": None, "h": None, "thumb": None}


def store(db: DbSession, ctx: Ctx, data: bytes, filename: str, kind: str, stage, visibility, *, ticket_id=None,
          equipment_id=None, report_id=None) -> tuple[Attachment, list[str]]:
    s = get_settings()
    info = process_upload(data, kind, s.max_photo_mb, s.max_doc_mb)
    key = storage.new_key("attachments", info["ext"])
    keys = [key]
    storage.put(key, info["bytes"])
    tkey = None
    if info["thumb"]:
        tkey = storage.new_key("thumbs", "jpg")
        storage.put(tkey, info["thumb"])
        keys.append(tkey)
    a = Attachment(ticket_id=ticket_id, equipment_id=equipment_id, work_report_id=report_id, kind=kind, stage=stage,
                   visibility=visibility, original_filename=clean_filename(filename), content_type=info["ctype"],
                   size_bytes=len(info["bytes"]), sha256=storage.sha256(info["bytes"]), width=info["w"], height=info["h"],
                   storage_key=key, thumb_storage_key=tkey, uploaded_by=ctx.user.id, uploaded_at=clock.now())
    db.add(a)
    db.flush()
    return a, keys


@router.post("/tickets/{ticket_id}/attachments", status_code=201)
async def upload(ticket_id: str, request: Request, file: UploadFile = File(...), kind: str = Form("photo"),
                 stage: str | None = Form(None), visibility: str = Form("public"),
                 ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    s = get_settings()
    data = await file.read(max(s.max_photo_mb, s.max_doc_mb) * 1024 * 1024 + 1)
    tid = _uuid(ticket_id)
    if kind not in ("photo", "document"):
        raise field_error("kind", "invalid", "kind: photo или document.")
    if kind == "photo" and stage not in ("before", "during", "after", "other"):
        raise field_error("stage", "required", "Для фото укажите стадию: before, during, after или other.")
    if visibility not in ("public", "internal") or (ctx.role == "client" and visibility == "internal"):
        raise field_error("visibility", "invalid", "Недопустимая видимость.")
    created_keys: list[str] = []

    def go():
        t = get_ticket(db, ctx, tid, for_update=True)
        if ctx.role == "admin" or ctx.role == "manager":
            raise ApiError(403, "FORBIDDEN", "Недостаточно прав для загрузки файлов.")
        if ctx.role == "engineer" and t.assigned_engineer_id != ctx.user.id:
            raise ApiError(403, "FORBIDDEN", "Загружать файлы может только назначенный инженер.")
        if t.status in TERMINAL:
            raise conflict("TICKET_LOCKED", "Заявка завершена — загрузка файлов недоступна.")
        if ctx.role == "client" and t.status in ("awaiting_confirmation",):
            raise conflict("TICKET_LOCKED", "Загрузка недоступна в этом статусе.")
        n = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.ticket_id == t.id, Attachment.deleted_at.is_(None)))
        if n >= s.max_attachments_per_ticket:
            raise conflict("ATTACHMENT_LIMIT_EXCEEDED", f"Достигнут лимит вложений ({s.max_attachments_per_ticket}).")
        rep = draft_report(db, t.id)
        try:
            a, keys = store(db, ctx, data, file.filename, kind, stage if kind == "photo" else None, visibility,
                            ticket_id=t.id, report_id=rep.id if rep and ctx.is_service else None)
        except ApiError:
            raise
        created_keys.extend(keys)
        now = clock.now()
        add_event(db, t, "attachment_added", now, actor=ctx.user, request_id=ctx.request_id, visibility=visibility,
                  payload={"attachment_id": str(a.id), "kind": kind, "stage": a.stage})
        return 201, att_out(a)
    try:
        import hashlib
        return idempotency.run(db, ctx, request, {"id": str(tid), "sha": hashlib.sha256(data).hexdigest(), "kind": kind,
                                                  "stage": stage, "visibility": visibility}, go)
    except Exception:
        for k in created_keys:
            storage.delete(k)
        raise


@router.get("/tickets/{ticket_id}/attachments")
def list_attachments(ticket_id: str, kind: str | None = None, stage: str | None = None, ctx: Ctx = Depends(get_ctx),
                     db: DbSession = Depends(get_db, scope="function")):
    t = get_ticket(db, ctx, _uuid(ticket_id))
    q = select(Attachment).where(Attachment.ticket_id == t.id, Attachment.deleted_at.is_(None))
    if ctx.role == "client":
        q = q.where(Attachment.visibility == "public")
    if kind:
        q = q.where(Attachment.kind == kind)
    if stage:
        q = q.where(Attachment.stage == stage)
    return [att_out(a) for a in db.scalars(q.order_by(Attachment.uploaded_at, Attachment.id))]


def _visible_attachment(db: DbSession, ctx: Ctx, att_id) -> Attachment:
    a = db.get(Attachment, _uuid(att_id))
    if not a or a.deleted_at:
        raise not_found()
    try:
        if a.ticket_id:
            get_ticket(db, ctx, a.ticket_id)
            if ctx.role == "client" and a.visibility != "public":
                raise not_found()
        else:
            get_equipment(db, ctx, a.equipment_id)
    except ApiError:
        audit_isolated("access_denied", user=ctx.user, object_type="attachment", object_id=a.id)
        raise
    return a


@router.get("/attachments/{att_id}/download")
def download(att_id: str, inline: int = 0, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    a = _visible_attachment(db, ctx, att_id)
    if not storage.exists(a.storage_key):
        raise ApiError(500, "FILE_MISSING", "Файл не найден в хранилище.")
    disp = "inline" if inline else "attachment"
    fname = a.original_filename.encode("utf-8").decode("latin-1", "ignore") if False else None
    from urllib.parse import quote
    return Response(storage.read(a.storage_key), media_type=a.content_type, headers={
        "Content-Disposition": f"{disp}; filename*=UTF-8''{quote(a.original_filename)}",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.get("/attachments/{att_id}/thumbnail")
def thumbnail(att_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    a = _visible_attachment(db, ctx, att_id)
    if not a.thumb_storage_key or not storage.exists(a.thumb_storage_key):
        raise not_found()
    return Response(storage.read(a.thumb_storage_key), media_type="image/jpeg",
                    headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.delete("/attachments/{att_id}", status_code=204)
def delete(att_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    a = _visible_attachment(db, ctx, att_id)
    if a.ticket_id:
        t = get_ticket(db, ctx, a.ticket_id, for_update=True)
        if t.status in TERMINAL:
            raise conflict("TICKET_LOCKED", "Заявка завершена — удаление недоступно.")
        if ctx.role != "dispatcher" and a.uploaded_by != ctx.user.id:
            raise ApiError(403, "FORBIDDEN", "Удалить может автор или диспетчер.")
        if a.work_report_id:
            rep = db.get(WorkReport, a.work_report_id)
            if rep and rep.status != "draft":
                raise conflict("REPORT_LOCKED", "Файл относится к отправленному отчёту.")
    elif ctx.role not in ("admin", "dispatcher"):
        raise ApiError(403, "FORBIDDEN", "Недостаточно прав.")
    a.deleted_at = clock.now()
    return Response(status_code=204)


# --- документы паспорта оборудования ---
@router.get("/equipment/{equipment_id}/documents")
def eq_docs(equipment_id: str, ctx: Ctx = Depends(get_ctx), db: DbSession = Depends(get_db, scope="function")):
    e = get_equipment(db, ctx, _uuid(equipment_id))
    return [att_out(a) for a in db.scalars(select(Attachment).where(
        Attachment.equipment_id == e.id, Attachment.deleted_at.is_(None)).order_by(Attachment.uploaded_at))]


@router.post("/equipment/{equipment_id}/documents", status_code=201)
async def upload_eq_doc(equipment_id: str, request: Request, file: UploadFile = File(...),
                        ctx: Ctx = Depends(require("admin", "dispatcher")), db: DbSession = Depends(get_db, scope="function")):
    s = get_settings()
    data = await file.read(s.max_doc_mb * 1024 * 1024 + 1)
    e = get_equipment(db, ctx, _uuid(equipment_id))
    n = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.equipment_id == e.id, Attachment.deleted_at.is_(None)))
    if n >= 100:
        raise conflict("ATTACHMENT_LIMIT_EXCEEDED", "Достигнут лимит документов оборудования.")
    try:
        a, keys = store(db, ctx, data, file.filename, "document", None, "public", equipment_id=e.id)
    except ApiError:
        raise
    return att_out(a)
