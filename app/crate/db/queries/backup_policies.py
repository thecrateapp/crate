"""Reads of backup policies and the destinations they write to (admin backups, BK3)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.backup_destinations import valid_uuid
from crate.db.tx import read_scope

POLICY_COLUMNS = """
    p.id::text AS id, p.name, p.enabled, p.schedule_kind, p.daily_at,
    p.interval_hours, p.window_start, p.window_end, p.keep_daily, p.keep_weekly,
    p.keep_monthly, p.compression, p.verify_every_days, p.verify_read_percent,
    p.drill_every_days, p.drill_destination_id::text AS drill_destination_id,
    p.run_before_upgrade, p.last_scheduled_at, p.created_at, p.updated_at,
    COALESCE(
        (
            SELECT jsonb_object_agg(pd.destination_id::text, to_jsonb(pd.tiers))
            FROM backup_policy_destinations pd
            WHERE pd.policy_id = p.id
        ),
        '{}'::jsonb
    ) AS destinations
"""
TIER_ORDER = ("daily", "weekly", "monthly")


def _normalise(row: Any) -> dict[str, Any]:
    policy = dict(row)
    policy["destinations"] = {
        destination: sorted(tiers, key=TIER_ORDER.index)
        for destination, tiers in (policy.get("destinations") or {}).items()
    }
    return policy


def _select(where: str, params: dict[str, Any], session: Session | None):
    def _impl(current: Session) -> list[dict[str, Any]]:
        rows = current.execute(
            text(
                f"SELECT {POLICY_COLUMNS} FROM backup_policies p WHERE {where} "
                "ORDER BY lower(p.name), p.id"
            ),
            params,
        ).mappings()
        return [_normalise(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_backup_policy(
    policy_id: str, *, session: Session | None = None
) -> dict[str, Any] | None:
    valid = valid_uuid(policy_id)
    if valid is None:
        return None
    rows = _select("p.id = CAST(:id AS uuid)", {"id": valid}, session)
    return rows[0] if rows else None


def list_backup_policies(*, session: Session | None = None) -> list[dict[str, Any]]:
    """Every policy by name, with its destinations and their tiers."""
    return _select("TRUE", {}, session)


def list_enabled_scheduled_policies(
    *, session: Session | None = None
) -> list[dict[str, Any]]:
    """The policies the scheduler starts: enabled and not manual."""
    return _select("p.enabled AND p.schedule_kind <> 'manual'", {}, session)


def list_before_upgrade_policies(
    *, session: Session | None = None
) -> list[dict[str, Any]]:
    """Enabled policies the deploy triggers (``make backup-before-upgrade``)."""
    return _select("p.enabled AND p.run_before_upgrade", {}, session)


__all__ = [
    "POLICY_COLUMNS",
    "TIER_ORDER",
    "get_backup_policy",
    "list_backup_policies",
    "list_before_upgrade_policies",
    "list_enabled_scheduled_policies",
]
