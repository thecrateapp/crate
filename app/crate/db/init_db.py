"""Database initialization — schema migrations + seeds."""

from __future__ import annotations

import logging

from sqlalchemy import text

from crate.db.core_migrations import run_alembic_upgrade
from crate.db.core_provisioning import (
    ensure_database,
    ensure_optional_superuser_extension,
)
from crate.db.engine import get_engine

log = logging.getLogger(__name__)

_MIGRATION_LOCK_ID = 820149  # arbitrary unique advisory lock ID for init_db


def init_db():
    """Run Alembic migrations and seed defaults under an advisory lock.

    Acquires an advisory lock so only one process (API or worker) runs
    schema migrations at a time. The lock is automatically released when
    the connection is closed.
    """
    ensure_database()
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": _MIGRATION_LOCK_ID})
        conn.commit()
        try:
            _init_db_inner()
        finally:
            conn.execute(
                text("SELECT pg_advisory_unlock(:id)"), {"id": _MIGRATION_LOCK_ID}
            )
            conn.commit()


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
