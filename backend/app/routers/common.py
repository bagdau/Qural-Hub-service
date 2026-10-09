from fastapi import Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..errors import ApiError, invalid


class Page:
    def __init__(self, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
        self.page, self.page_size = page, page_size

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def strict_params(request: Request, allowed: set[str]) -> None:
    extra = set(request.query_params.keys()) - allowed - {"page", "page_size", "sort"}
    if extra:
        raise invalid("Неизвестные параметры запроса.", [{"field": k, "code": "unknown_param", "message": "Неизвестный параметр."} for k in sorted(extra)])


def apply_sort(q, sort: str | None, allowed: dict, default):
    cols = []
    if sort:
        for part in sort.split(","):
            part = part.strip()
            if not part:
                continue
            desc = part.startswith("-")
            name = part.lstrip("-")
            if name not in allowed:
                raise invalid("Недопустимое поле сортировки.", [{"field": "sort", "code": "bad_sort", "message": f"Нельзя сортировать по «{name}»."}])
            c = allowed[name]
            cols.append(c.desc() if desc else c.asc())
    return q.order_by(*(cols or default))


def paginate(db: DbSession, q, pg: Page) -> tuple[list, int]:
    total = db.scalar(select(func.count()).select_from(q.order_by(None).subquery()))
    rows = db.scalars(q.offset(pg.offset).limit(pg.page_size)).all()
    return rows, total


def version_check(obj, sent: int, what: str = "Запись") -> None:
    if obj.version != sent:
        raise ApiError(409, "VERSION_CONFLICT", f"{what} была изменена другим пользователем. Обновите данные и повторите действие.",
                       {"current_version": obj.version, "sent_version": sent})
