"""SQLAlchemy 2.x engine and session factory for Crate.

This module is the entry point for all new code that wants to talk to
PostgreSQL through SQLAlchemy rather than the legacy psycopg2 pool in
``core.py``. Both coexist: the legacy pool handles existing code that
uses ``get_db_ctx()``, while this engine handles code that uses
``Session`` (repositories, new queries, ORM models when they arrive).

The two pools are independent — same database, separate connection
lifecycles. This is safe because PostgreSQL handles concurrent
connections from different pools without issue. Over time, as code
migrates from ``get_db_ctx()`` to ``Session``, the legacy pool will
see fewer connections and can eventually be removed.

Configuration reads the same ``CRATE_POSTGRES_*`` env vars as
``core.py``, so there is zero additional setup for operators.
"""

import os
import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

log = logging.getLogger(__name__)


def _build_dsn() -> str:
    user = os.environ.get("CRATE_POSTGRES_USER", "crate")
    password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    db = os.environ.get("CRATE_POSTGRES_DB", "crate")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"


# Lazy singleton — created on first access so import-time doesn't
# require a live database (tests, CLI tools, etc.).
_engine = None
_session_factory = None


def _default_pool_settings() -> tuple[int, int]:
    """Return (pool_size, max_overflow) based on runtime context."""
    runtime = os.environ.get("CRATE_RUNTIME", "").lower()
    if runtime == "api":
        return 8, 4  # API: enough headroom for radio start/next under concurrency
    elif runtime == "worker":
        return 2, 1  # Worker: background tasks should be conservative
    return 4, 2  # Fallback (dev, tests)


def get_engine():
    """Return the shared SQLAlchemy engine (created on first call)."""
    global _engine
    if _engine is None:
        default_size, default_overflow = _default_pool_settings()
        pool_size = _get_pool_setting("CRATE_SQLALCHEMY_POOL_SIZE", default_size)
        max_overflow = _get_pool_setting(
            "CRATE_SQLALCHEMY_MAX_OVERFLOW", default_overflow
        )
        pool_timeout = _get_positive_setting("CRATE_SQLALCHEMY_POOL_TIMEOUT_SECONDS", 5)
        connect_timeout = _get_positive_setting(
            "CRATE_POSTGRES_CONNECT_TIMEOUT_SECONDS", 3
        )
        statement_timeout = _get_positive_setting(
            "CRATE_POSTGRES_STATEMENT_TIMEOUT_MS", _default_statement_timeout_ms()
        )
        lock_timeout = _get_positive_setting("CRATE_POSTGRES_LOCK_TIMEOUT_MS", 3_000)
        _engine = create_engine(
            _build_dsn(),
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_timeout=pool_timeout,
            pool_pre_ping=True,
            pool_recycle=3600,
            connect_args={
                "connect_timeout": connect_timeout,
                "options": (
                    f"-c statement_timeout={statement_timeout} "
                    f"-c lock_timeout={lock_timeout}"
                ),
            },
            echo=False,
        )
        log.info(
            "SQLAlchemy engine created: %s "
            "(pool_size=%s, max_overflow=%s, pool_timeout=%ss, "
            "connect_timeout=%ss, statement_timeout=%sms, lock_timeout=%sms)",
            _engine.url.render_as_string(hide_password=True),
            pool_size,
            max_overflow,
            pool_timeout,
            connect_timeout,
            statement_timeout,
            lock_timeout,
        )
    return _engine


def get_session_factory():
    """Return the shared session factory (created on first call)."""
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
        )
    return _session_factory


def get_pool_runtime() -> dict[str, int | float | bool]:
    """Return queue-pool saturation without creating an engine as a side effect."""
    pool = getattr(_engine, "pool", None)
    if pool is None:
        return _empty_pool_runtime()
    size = int(pool.size())
    checked_in = int(pool.checkedin())
    checked_out = int(pool.checkedout())
    overflow = int(pool.overflow())
    capacity = max(1, size)
    return {
        "configured": True,
        "size": size,
        "checked_in": checked_in,
        "checked_out": checked_out,
        "overflow": overflow,
        "saturation_ratio": round(checked_out / capacity, 3),
    }


def _empty_pool_runtime() -> dict[str, int | float | bool]:
    return {
        "configured": False,
        "size": 0,
        "checked_in": 0,
        "checked_out": 0,
        "overflow": 0,
        "saturation_ratio": 0.0,
    }


class Base(DeclarativeBase):
    """Declarative base for future ORM-mapped models.

    Not used yet (Phase 5) but defined here so it's importable as soon
    as anyone wants to create a mapped class. Keeping it next to the
    engine avoids circular imports.
    """

    pass


def _get_pool_setting(env_var: str, default: int) -> int:
    raw = os.environ.get(env_var)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; falling back to %d", env_var, raw, default)
        return default
    return max(0, value)


def _default_statement_timeout_ms() -> int:
    runtime = os.environ.get("CRATE_RUNTIME", "").lower()
    if runtime == "worker":
        return 900_000
    if runtime == "projector":
        return 30_000
    return 15_000


def _get_positive_setting(env_var: str, default: int) -> int:
    raw = os.environ.get(env_var)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        log.warning("Invalid %s=%r; falling back to %d", env_var, raw, default)
        return default
    if value <= 0:
        log.warning("Non-positive %s=%r; falling back to %d", env_var, raw, default)
        return default
    return value


def reset_engine():
    """Dispose the engine and clear the singleton.

    Used in tests to point at a different database (crate_test) or
    after a fork in worker child processes.
    """
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
        _engine = None
    _session_factory = None
