from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings

_engine = None
_Session = None


class Base(DeclarativeBase):
    pass


def engine():
    global _engine, _Session
    if _engine is None:
        _engine = create_engine(
            get_settings().db_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=10,
            connect_args={"options": "-c timezone=UTC"},
        )
        _Session = sessionmaker(bind=_engine, expire_on_commit=False, autoflush=True)
    return _engine


def SessionLocal():
    engine()
    return _Session()


def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
