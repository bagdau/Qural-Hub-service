import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


def not_found(msg="Объект не найден или недоступен."):
    return ApiError(404, "NOT_FOUND", msg)


def forbidden(msg="Недостаточно прав для этого действия."):
    return ApiError(403, "FORBIDDEN", msg)


def conflict(code, msg, details=None):
    return ApiError(409, code, msg, details)


def invalid(msg, fields=None):
    return ApiError(422, "VALIDATION_ERROR", msg, {"fields": fields or []})


def field_error(field, code, message):
    return invalid("Проверьте заполнение полей.", [{"field": field, "code": code, "message": message}])


def _body(code, message, details, request: Request):
    rid = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    return jsonable_encoder({"error": {"code": code, "message": message, "details": details or {}, "request_id": rid}})


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(request: Request, exc: ApiError):
        return JSONResponse(_body(exc.code, exc.message, exc.details, request), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _val(request: Request, exc: RequestValidationError):
        fields = []
        for e in exc.errors():
            loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path")]
            fields.append({"field": ".".join(loc), "code": e.get("type", "invalid"),
                           "message": _ru(e)})
        return JSONResponse(_body("VALIDATION_ERROR", "Проверьте заполнение полей.", {"fields": fields}, request),
                            status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        code = {401: "UNAUTHENTICATED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        msg = "Объект не найден." if exc.status_code == 404 else str(exc.detail)
        return JSONResponse(_body(code, msg, {}, request), status_code=exc.status_code)

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError):
        log.warning("integrity error: %s", exc.orig)
        return JSONResponse(_body("DUPLICATE", "Запись нарушает ограничение уникальности или целостности.", {}, request),
                            status_code=409)

    @app.exception_handler(Exception)
    async def _any(request: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse(_body("INTERNAL_ERROR", "Внутренняя ошибка сервера.", {}, request), status_code=500)


def _ru(e: dict) -> str:
    t = e.get("type", "")
    ctx = e.get("ctx", {})
    if t == "missing":
        return "Поле обязательно."
    if t == "string_too_short":
        return f"Минимальная длина — {ctx.get('min_length')} символов."
    if t == "string_too_long":
        return f"Максимальная длина — {ctx.get('max_length')} символов."
    if t.startswith("uuid"):
        return "Некорректный идентификатор."
    if t in ("literal_error", "enum"):
        return "Недопустимое значение."
    return e.get("msg", "Некорректное значение.")
