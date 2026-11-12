"""Writes of backup destinations (admin backups, BK2).

Only references to secrets reach this table; ``crate.backups.destinations`` stores
the secrets themselves through ``crate.credentials`` and revokes the old ones.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.backup_destinations import DESTINATION_COLUMNS, valid_uuid
from crate.db.tx import optional_scope

MAX_ERROR_LENGTH = 2000
CHECK_STATUSES = frozenset({"untested", "ok", "failing", "unavailable"})
_UNSET: Any = object()


def insert_backup_destination(
    *,
    kind: str,
    name: str,
    config: dict[str, Any],
    secret_ref: str | None,
    repo_password_ref: str,
    enabled: bool = True,
    session: Session | None = None,
) -> dict[str, Any]:
    def _impl(current: Session) -> dict[str, Any]:
        row = (
            current.execute(
                text(
                    f"""
                    INSERT INTO backup_destinations
                        (kind, name, config_json, secret_ref, repo_password_ref, enabled)
                    VALUES (:kind, :name, CAST(:config AS jsonb), :secret_ref,
                            :repo_password_ref, :enabled)
                    RETURNING {DESTINATION_COLUMNS}
                    """
                ),
                {
                    "kind": kind,
                    "name": name,
                    "config": json.dumps(config),
                    "secret_ref": secret_ref,
                    "repo_password_ref": repo_password_ref,
                    "enabled": enabled,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)

    with optional_scope(session) as current:
        return _impl(current)


def update_backup_destination(
    destination_id: str,
    *,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    secret_ref: str | None = _UNSET,
    enabled: bool | None = None,
    session: Session | None = None,
) -> dict[str, Any] | None:
    """Change a destination. A new configuration or secret resets its status."""
    valid = valid_uuid(destination_id)
    if valid is None:
        return None
    reset = config is not None or secret_ref is not _UNSET

    def _impl(current: Session) -> dict[str, Any] | None:
        row = (
            current.execute(
                text(
                    f"""
                    UPDATE backup_destinations SET
                        name = COALESCE(:name, name),
                        config_json = COALESCE(CAST(:config AS jsonb), config_json),
                        secret_ref = CASE WHEN :set_secret THEN :secret_ref
                                          ELSE secret_ref END,
                        enabled = COALESCE(:enabled, enabled),
                        status = CASE WHEN :reset THEN 'untested' ELSE status END,
                        last_error = CASE WHEN :reset THEN NULL ELSE last_error END,
                        updated_at = now()
                    WHERE id = CAST(:id AS uuid)
                    RETURNING {DESTINATION_COLUMNS}
                    """
                ),
                {
                    "id": valid,
                    "name": name,
                    "config": None if config is None else json.dumps(config),
                    "set_secret": secret_ref is not _UNSET,
                    "secret_ref": None if secret_ref is _UNSET else secret_ref,
                    "enabled": enabled,
                    "reset": reset,
                },
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    with optional_scope(session) as current:
        return _impl(current)


def delete_backup_destination(
    destination_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    """Delete a destination and return it, so its secrets can be revoked."""
    valid = valid_uuid(destination_id)
    if valid is None:
        return None

    def _impl(current: Session) -> dict[str, Any] | None:
        row = (
            current.execute(
                text(
                    f"DELETE FROM backup_destinations WHERE id = CAST(:id AS uuid) "
                    f"RETURNING {DESTINATION_COLUMNS}"
                ),
                {"id": valid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    with optional_scope(session) as current:
        return _impl(current)


def record_destination_check(
    destination_id: str,
    *,
    status: str,
    error: str | None = None,
    snapshot_count: int | None = None,
    repository_bytes: int | None = None,
    initialized: bool = False,
    config_updates: dict[str, Any] | None = None,
    session: Session | None = None,
) -> bool:
    """Store what a connection test or a copy learnt about a destination.

    ``config_updates`` merges facts the engine discovered into the configuration
    (the SFTP host key seen on first contact) without resetting the status.
    """
    if status not in CHECK_STATUSES:
        raise ValueError(f"Unknown destination status: {status!r}")
    valid = valid_uuid(destination_id)
    if valid is None:
        return False

    def _impl(current: Session) -> bool:
        result = current.execute(
            text(
                """
                UPDATE backup_destinations SET
                    status = :status,
                    last_error = :error,
                    last_checked_at = now(),
                    snapshot_count = COALESCE(:snapshot_count, snapshot_count),
                    repository_bytes = COALESCE(:repository_bytes, repository_bytes),
                    repository_initialized_at = CASE
                        WHEN :initialized
                        THEN COALESCE(repository_initialized_at, now())
                        ELSE repository_initialized_at END,
                    config_json = config_json || CAST(:config_updates AS jsonb)
                WHERE id = CAST(:id AS uuid)
                RETURNING id
                """
            ),
            {
                "id": valid,
                "status": status,
                "error": None if error is None else error[:MAX_ERROR_LENGTH],
                "snapshot_count": snapshot_count,
                "repository_bytes": repository_bytes,
                "initialized": initialized,
                "config_updates": json.dumps(config_updates or {}),
            },
        )
        return result.first() is not None

    with optional_scope(session) as current:
        return _impl(current)


def mark_recovery_kit_downloaded(
    destination_ids: Iterable[str], *, session: Session | None = None
) -> int:
    """A kit holding these destinations' passwords was downloaded: confirm it again."""
    ids = [valid for value in destination_ids if (valid := valid_uuid(value))]
    if not ids:
        return 0

    def _impl(current: Session) -> int:
        result = current.execute(
            text(
                """
                UPDATE backup_destinations
                SET recovery_kit_downloaded_at = now(), recovery_kit_confirmed_at = NULL
                WHERE id = ANY(CAST(:ids AS uuid[]))
                RETURNING id
                """
            ),
            {"ids": ids},
        )
        return len(result.all())

    with optional_scope(session) as current:
        return _impl(current)


def confirm_recovery_kit(*, session: Session | None = None) -> int:
    """The operator stored the last kit off the server."""

    def _impl(current: Session) -> int:
        result = current.execute(
            text(
                """
                UPDATE backup_destinations SET recovery_kit_confirmed_at = now()
                WHERE recovery_kit_downloaded_at IS NOT NULL
                  AND recovery_kit_confirmed_at IS NULL
                RETURNING id
                """
            )
        )
        return len(result.all())

    with optional_scope(session) as current:
        return _impl(current)


__all__ = [
    "CHECK_STATUSES",
    "confirm_recovery_kit",
    "delete_backup_destination",
    "insert_backup_destination",
    "mark_recovery_kit_downloaded",
    "record_destination_check",
    "update_backup_destination",
]
