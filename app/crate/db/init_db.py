"""Database initialization — schema migrations + seeds."""

from __future__ import annotations

import logging
import os
import time

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from crate.db.core_migrations import run_alembic_upgrade
from crate.db.core_provisioning import (
    ensure_database,
    ensure_optional_superuser_extension,
)
from crate.db.engine import get_engine

log = logging.getLogger(__name__)

_MIGRATION_LOCK_ID = 820149  # arbitrary unique advisory lock ID for init_db


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def init_db():
    """Run Alembic migrations and seed defaults under an advisory lock.

    Acquires an advisory lock so only one process (API or worker) runs
    schema migrations at a time. The lock is automatically released when
    the connection is closed.
    """
    timeout_seconds = float(os.environ.get("CRATE_DB_INIT_RETRY_TIMEOUT_SECONDS", "60"))
    interval_seconds = float(
        os.environ.get("CRATE_DB_INIT_RETRY_INTERVAL_SECONDS", "1")
    )
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    attempt = 0

    while True:
        attempt += 1
        try:
            _init_db_once()
            return
        except OperationalError:
            now = time.monotonic()
            if now >= deadline:
                log.exception(
                    "Database initialization failed after %s attempt(s)", attempt
                )
                raise

            sleep_seconds = min(max(0.1, interval_seconds), max(0.0, deadline - now))
            log.warning(
                "Database is not ready for initialization; retrying in %.1fs "
                "(attempt %s)",
                sleep_seconds,
                attempt,
            )
            time.sleep(sleep_seconds)


def _init_db_once():
    """Run one database initialization attempt."""
    ensure_database()
    engine = get_engine()
    with engine.connect() as conn:
        _acquire_migration_lock(conn)
        try:
            _init_db_inner()
        finally:
            conn.execute(
                text("SELECT pg_advisory_unlock(:id)"), {"id": _MIGRATION_LOCK_ID}
            )
            conn.commit()


def _acquire_migration_lock(conn) -> None:
    """Acquire the migration lock without holding a blocking DB transaction.

    Blocking ``pg_advisory_lock`` waiters keep active transactions open. That
    can wedge ``CREATE INDEX CONCURRENTLY`` migrations because the index build
    waits for those virtual transactions while the migration owner waits for
    the index. Polling with ``pg_try_advisory_lock`` keeps waiters out of
    PostgreSQL locks and lets the migrator finish cleanly.
    """
    timeout_seconds = max(0.0, _env_float("CRATE_DB_INIT_LOCK_TIMEOUT_SECONDS", 1800))
    interval_seconds = max(0.1, _env_float("CRATE_DB_INIT_LOCK_INTERVAL_SECONDS", 0.5))
    deadline = time.monotonic() + timeout_seconds
    attempts = 0

    while True:
        attempts += 1
        acquired = bool(
            conn.execute(
                text("SELECT pg_try_advisory_lock(:id)"),
                {"id": _MIGRATION_LOCK_ID},
            ).scalar()
        )
        conn.commit()
        if acquired:
            if attempts > 1:
                log.info(
                    "Database migration lock acquired after %d attempt(s)", attempts
                )
            return

        now = time.monotonic()
        if timeout_seconds > 0 and now >= deadline:
            raise TimeoutError(
                f"Timed out waiting for database migration lock {_MIGRATION_LOCK_ID}"
            )

        if attempts == 1 or attempts % 30 == 0:
            log.info("Waiting for database migration lock...")

        sleep_seconds = interval_seconds
        if timeout_seconds > 0:
            sleep_seconds = min(sleep_seconds, max(0.0, deadline - now))
        time.sleep(sleep_seconds)


def _init_db_inner():
    # Alembic is the authoritative bootstrap and upgrade path.
    # The pre-Alembic bridge has been removed from runtime.
    run_alembic_upgrade()

    # Observability extensions are optional and may require a server restart
    # with shared_preload_libraries before they can be created successfully.
    ensure_optional_superuser_extension("pg_stat_statements")

    # Seeds run last — they depend on the schema being fully up to date.
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        from crate.genre_taxonomy import seed_genre_taxonomy
        from crate.db.repositories.auth import _seed_admin

        seed_genre_taxonomy(session)
        _seed_admin(session)
