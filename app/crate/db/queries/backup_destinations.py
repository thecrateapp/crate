"""Reads of backup destinations (admin backups, BK2).

Rows carry the references to their secrets for the engine. Never return them to a
client as they are: ``crate.backups.destinations.public_destination`` is the view
the API serves.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

DESTINATION_COLUMNS = """
    id::text AS id, kind, name, config_json AS config, secret_ref,
    repo_password_ref, enabled, status, last_checked_at, last_error,
    repository_initialized_at, snapshot_count, repository_bytes,
    recovery_kit_downloaded_at, recovery_kit_confirmed_at, created_at, updated_at,
    snapshots_json AS snapshots, snapshots_listed_at
"""


def valid_uuid(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError):
        return None


def get_backup_destination(
    destination_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    valid = valid_uuid(destination_id)
    if valid is None:
        return None

    def _impl(current: Session) -> dict[str, Any] | None:
        row = (
            current.execute(
                text(
                    f"SELECT {DESTINATION_COLUMNS} FROM backup_destinations "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {"id": valid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def list_backup_destinations(
    *, enabled_only: bool = False, session: Session | None = None
) -> list[dict[str, Any]]:
    """Every destination by name."""

    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(
            text(
                f"""
                SELECT {DESTINATION_COLUMNS} FROM backup_destinations
                WHERE (NOT :enabled_only OR enabled)
                ORDER BY lower(name), id
                """
            ),
            {"enabled_only": enabled_only},
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "DESTINATION_COLUMNS",
    "get_backup_destination",
    "list_backup_destinations",
    "valid_uuid",
]
