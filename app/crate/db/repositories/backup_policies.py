"""Writes of backup policies and their destination tiers (admin backups, BK3)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.backup_destinations import valid_uuid
from crate.db.queries.backup_policies import get_backup_policy
from crate.db.tx import optional_scope

POLICY_FIELDS = (
    "name",
    "enabled",
    "schedule_kind",
    "daily_at",
    "interval_hours",
    "window_start",
    "window_end",
    "keep_daily",
    "keep_weekly",
    "keep_monthly",
    "compression",
    "verify_every_days",
    "verify_read_percent",
    "drill_every_days",
    "drill_destination_id",
    "run_before_upgrade",
)
_UUID_FIELDS = {"drill_destination_id"}


def _value_sql(field: str) -> str:
    return f"CAST(:{field} AS uuid)" if field in _UUID_FIELDS else f":{field}"


def insert_backup_policy(
    *, session: Session | None = None, **values: Any
) -> dict[str, Any]:
    unknown = set(values) - set(POLICY_FIELDS)
    if unknown:
        raise ValueError(f"Unknown policy fields: {sorted(unknown)}")
    fields = [f for f in POLICY_FIELDS if f in values]

    def _impl(current: Session) -> dict[str, Any]:
        policy_id = current.execute(
            text(
                f"INSERT INTO backup_policies ({', '.join(fields)}) "
                f"VALUES ({', '.join(_value_sql(f) for f in fields)}) "
                "RETURNING id::text"
            ),
            {f: values[f] for f in fields},
        ).scalar_one()
        policy = get_backup_policy(policy_id, session=current)
        assert policy is not None
        return policy

    with optional_scope(session) as current:
        return _impl(current)


def update_backup_policy(
    policy_id: str, *, session: Session | None = None, **values: Any
) -> dict[str, Any] | None:
    """Set the given fields (``None`` clears a nullable one)."""
    valid = valid_uuid(policy_id)
    if valid is None:
        return None
    unknown = set(values) - set(POLICY_FIELDS)
    if unknown:
        raise ValueError(f"Unknown policy fields: {sorted(unknown)}")

    def _impl(current: Session) -> dict[str, Any] | None:
        assignments = [f"{f} = {_value_sql(f)}" for f in POLICY_FIELDS if f in values]
        assignments.append("updated_at = now()")
        found = current.execute(
            text(
                f"UPDATE backup_policies SET {', '.join(assignments)} "
                "WHERE id = CAST(:id AS uuid) RETURNING id"
            ),
            {"id": valid, **values},
        ).first()
        return get_backup_policy(valid, session=current) if found else None

    with optional_scope(session) as current:
        return _impl(current)


def set_policy_destinations(
    policy_id: str,
    tiers: Mapping[str, Iterable[str]],
    *,
    session: Session | None = None,
) -> None:
    """Replace the destinations of a policy and the tiers each one receives."""
    valid = valid_uuid(policy_id)
    if valid is None:
        raise ValueError(f"Not a policy id: {policy_id!r}")

    def _impl(current: Session) -> None:
        current.execute(
            text(
                "DELETE FROM backup_policy_destinations "
                "WHERE policy_id = CAST(:id AS uuid)"
            ),
            {"id": valid},
        )
        for destination_id, destination_tiers in tiers.items():
            current.execute(
                text(
                    """
                    INSERT INTO backup_policy_destinations
                        (policy_id, destination_id, tiers)
                    VALUES (CAST(:policy AS uuid), CAST(:destination AS uuid), :tiers)
                    """
                ),
                {
                    "policy": valid,
                    "destination": destination_id,
                    "tiers": list(dict.fromkeys(destination_tiers)),
                },
            )
        current.execute(
            text(
                "UPDATE backup_policies SET updated_at = now() "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": valid},
        )

    with optional_scope(session) as current:
        _impl(current)


def mark_policy_scheduled(policy_id: str, *, session: Session | None = None) -> bool:
    """Record that the scheduler started the policy now."""
    valid = valid_uuid(policy_id)
    if valid is None:
        return False

    def _impl(current: Session) -> bool:
        return (
            current.execute(
                text(
                    "UPDATE backup_policies SET last_scheduled_at = now() "
                    "WHERE id = CAST(:id AS uuid) RETURNING id"
                ),
                {"id": valid},
            ).first()
            is not None
        )

    with optional_scope(session) as current:
        return _impl(current)


def delete_backup_policy(
    policy_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    valid = valid_uuid(policy_id)
    if valid is None:
        return None

    def _impl(current: Session) -> dict[str, Any] | None:
        policy = get_backup_policy(valid, session=current)
        if policy is None:
            return None
        current.execute(
            text("DELETE FROM backup_policies WHERE id = CAST(:id AS uuid)"),
            {"id": valid},
        )
        return policy

    with optional_scope(session) as current:
        return _impl(current)


__all__ = [
    "POLICY_FIELDS",
    "delete_backup_policy",
    "insert_backup_policy",
    "mark_policy_scheduled",
    "set_policy_destinations",
    "update_backup_policy",
]
