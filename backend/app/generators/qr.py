"""Генератор QR-кодов (отдельный модуль).

Параметры подобраны для надёжного считывания в плохих условиях (дождь, пыль, блики, слабый свет):
высокий уровень коррекции ошибок (Q по умолчанию, H — для уличных наклеек), «тихая зона» не меньше 4 модулей,
максимальный контраст (чёрный на белом), крупные модули.
"""
import io

import segno

from ..errors import field_error

LEVELS = {"l", "m", "q", "h"}
DEFAULT_EC = "q"


def _check(ec: str, scale: int, border: int) -> None:
    if ec.lower() not in LEVELS:
        raise field_error("ec", "invalid", "Уровень коррекции: l, m, q или h.")
    if not 2 <= scale <= 40:
        raise field_error("size", "invalid", "Размер модуля 2–40 пикселей.")
    if not 4 <= border <= 10:
        raise field_error("border", "invalid", "Тихая зона не менее 4 модулей (до 10).")


def make(url: str, ec: str = DEFAULT_EC):
    return segno.make(url, error=ec.lower(), micro=False, boost_error=False)


def png(url: str, scale: int = 10, border: int = 4, ec: str = DEFAULT_EC) -> bytes:
    _check(ec, scale, border)
    buf = io.BytesIO()
    make(url, ec).save(buf, kind="png", scale=scale, border=border, dark="#000000", light="#ffffff")
    return buf.getvalue()


def svg(url: str, scale: int = 10, border: int = 4, ec: str = DEFAULT_EC) -> bytes:
    _check(ec, scale, border)
    buf = io.BytesIO()
    make(url, ec).save(buf, kind="svg", scale=scale, border=border, xmldecl=False, dark="#000000", light="#ffffff",
                       svgns=True, title="QR-код оборудования")
    return buf.getvalue()
