"""Durable readiness state for the canonical catalog."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import text

from crate.db.tx import optional_scope


CatalogStatus = Literal["cold", "backfilling", "ready", "failed"]

_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "cold": {"backfilling"},
    "backfilling": {"ready", "failed"},
    "ready": {"backfilling"},
    "failed": {"backfilling"},
}
_MUTABLE_FIELDS = {
    "bootstrap_cursor_json",
    "user_refs_backfilled_at",
    "user_refs_backfill_version",
    "user_refs_backfill_report_json",
    "last_full_reconcile_at",
    "last_error",
}


def get_catalog_state(*, session=None) -> dict[str, Any]:
    """Return the singleton state, repairing a missing bootstrap row safely."""
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                INSERT INTO global_catalog_state (singleton, status, generation)
                VALUES (TRUE, 'cold', gen_random_uuid())
                ON CONFLICT (singleton) DO NOTHING
                """
            )
        )
        row = (
            current.execute(
                text(
                    """
                    SELECT
                        singleton,
                        status,
                        generation::text AS generation,
                        bootstrap_cursor_json,
                        user_refs_backfilled_at,
                        user_refs_backfill_version,
                        user_refs_backfill_report_json,
                        last_full_reconcile_at,
                        last_error,
                        created_at,
                        updated_at
                    FROM global_catalog_state
                    WHERE singleton = TRUE
                    """
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


def transition_catalog_state(
    status: CatalogStatus,
    *,
    session=None,
    **fields: object,
) -> dict[str, Any]:
    """Move the singleton through its explicit bootstrap state machine."""
    if status not in _ALLOWED_TRANSITIONS:
        raise ValueError(f"Unknown catalog status: {status}")

    unexpected = set(fields) - _MUTABLE_FIELDS
    if unexpected:
        names = ", ".join(sorted(unexpected))
        raise ValueError(f"Unsupported catalog state fields: {names}")

    with optional_scope(session) as current:
        state = get_catalog_state(session=current)
        previous = str(state["status"])
        if status not in _ALLOWED_TRANSITIONS[previous]:
            raise ValueError(
                f"Invalid catalog state transition: {previous} -> {status}"
            )

        assignments = ["status = :status", "updated_at = NOW()"]
        params: dict[str, object] = {"status": status}
        for name in sorted(fields):
            assignments.append(f"{name} = :{name}")
            params[name] = fields[name]
        if status == "backfilling" and "last_error" not in fields:
            assignments.append("last_error = NULL")

        row = (
            current.execute(
                text(
                    f"""
                    UPDATE global_catalog_state
                    SET {", ".join(assignments)}
                    WHERE singleton = TRUE
                    RETURNING
                        singleton,
                        status,
                        generation::text AS generation,
                        bootstrap_cursor_json,
                        user_refs_backfilled_at,
                        user_refs_backfill_version,
                        user_refs_backfill_report_json,
                        last_full_reconcile_at,
                        last_error,
                        created_at,
                        updated_at
                    """
                ),
                params,
            )
            .mappings()
            .one()
        )
    return dict(row)


__all__ = ["CatalogStatus", "get_catalog_state", "transition_catalog_state"]
