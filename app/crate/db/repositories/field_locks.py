"""Manual field locks for library entities."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope


def lock_fields(
    *,
    entity_type: str,
    entity_id: int,
    field_names: Iterable[str],
    locked_by_user_id: int | None = None,
    reason: str | None = None,
    source: str = "manual_edit",
    session: Session | None = None,
) -> set[str]:
    fields = sorted({field.strip() for field in field_names if field.strip()})
    if not fields:
        return set()

    now = datetime.now(timezone.utc)

    def _impl(s: Session) -> set[str]:
        s.execute(
            text("""
                INSERT INTO library_field_locks (
                    entity_type,
                    entity_id,
                    field_name,
                    locked_by_user_id,
                    locked_at,
                    reason,
                    source
                )
                SELECT
                    :entity_type,
                    :entity_id,
                    field_name,
                    :locked_by_user_id,
                    :locked_at,
                    :reason,
                    :source
                FROM unnest(:field_names) AS field_name
                ON CONFLICT (entity_type, entity_id, field_name)
                DO UPDATE SET
                    locked_by_user_id = EXCLUDED.locked_by_user_id,
                    locked_at = EXCLUDED.locked_at,
                    reason = EXCLUDED.reason,
                    source = EXCLUDED.source
            """),
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "field_names": fields,
                "locked_by_user_id": locked_by_user_id,
                "locked_at": now,
                "reason": reason,
                "source": source,
            },
        )
        return set(fields)

    with optional_scope(session) as s:
        return _impl(s)


def list_locked_fields(
    *,
    entity_type: str,
    entity_id: int,
    session: Session | None = None,
) -> set[str]:
    def _impl(s: Session) -> set[str]:
        rows = s.execute(
            text("""
                SELECT field_name
                FROM library_field_locks
                WHERE entity_type = :entity_type
                  AND entity_id = :entity_id
            """),
            {"entity_type": entity_type, "entity_id": entity_id},
        ).scalars()
        return {str(field) for field in rows if field}

    with optional_scope(session) as s:
        return _impl(s)


__all__ = ["list_locked_fields", "lock_fields"]
