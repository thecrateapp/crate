"""Pure, bounded settings and runtime policy reads."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.runtime_policy_contract import (
    ADOPTION_COMPONENTS,
    default_runtime_policy,
    policy_hash,
    validate_runtime_policy,
)

_DOWNLOAD_KEYS = (
    "download_window_enabled",
    "download_window_start",
    "download_window_end",
    "download_window_timezone",
    "download_max_active_users",
    "download_max_active_streams",
)


def decode_schedules(raw: str | None) -> dict[str, int]:
    from crate.scheduler import DEFAULT_SCHEDULES

    result = dict(DEFAULT_SCHEDULES)
    try:
        configured = json.loads(raw) if raw else {}
        if not isinstance(configured, dict):
            return result
        if "library_sync" in configured and "library_pipeline" not in configured:
            configured["library_pipeline"] = configured["library_sync"]
        result.update(
            {
                key: value
                for key, value in configured.items()
                if key in result and type(value) is int and value >= 0
            }
        )
    except (ValueError, TypeError):
        pass
    return result


def read_schedules_state(*, session=None) -> dict:
    def read(current):
        from crate.scheduler import DEFAULT_SCHEDULES

        rows = current.execute(
            text("SELECT key,value FROM settings WHERE key=ANY(:keys)"),
            {
                "keys": [
                    "schedules",
                    *(f"schedule:last_run:{name}" for name in DEFAULT_SCHEDULES),
                ]
            },
        ).mappings()
        settings = {row["key"]: row["value"] for row in rows}
        raw = settings.get("schedules")
        schedules = decode_schedules(raw)
        completed = current.execute(
            text("""SELECT DISTINCT ON (schedule_name) schedule_name,updated_at
            FROM tasks WHERE schedule_name=ANY(:types) AND status='completed'
            ORDER BY schedule_name,updated_at DESC"""),
            {
                "types": list(schedules),
            },
        ).mappings()
        return {
            "revision": policy_hash({"raw": raw}),
            "schedules": schedules,
            "last_enqueued_at": {
                name: settings.get(f"schedule:last_run:{name}") for name in schedules
            },
            "last_succeeded_at": {
                row["schedule_name"]: row["updated_at"] for row in completed
            },
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def read_runtime_policy_state(*, session=None, include_adoptions: bool = True) -> dict:
    def read(current):
        stored = (
            current.execute(
                text(
                    "SELECT revision,policy,updated_at FROM agent_runtime_policy WHERE singleton"
                )
            )
            .mappings()
            .first()
        )
        settings = {}
        if not stored or not stored["policy"]:
            settings = {
                row["key"]: row["value"]
                for row in current.execute(
                    text("SELECT key,value FROM settings WHERE key=ANY(:keys)"),
                    {"keys": list(_DOWNLOAD_KEYS)},
                ).mappings()
            }
        policy = (
            validate_runtime_policy(stored["policy"])
            if stored and stored["policy"]
            else default_runtime_policy(settings)
        )
        revision = int(stored["revision"]) if stored else 0
        fingerprint = policy_hash(policy)
        if not include_adoptions:
            return {
                "configured_revision": revision,
                "policy_hash": fingerprint,
                "policy": policy,
            }
        rows = list(
            current.execute(
                text("""SELECT consumer_id,component,revision,policy_hash,observed_at
            FROM agent_runtime_adoptions WHERE observed_at>NOW()-INTERVAL '90 seconds'
            ORDER BY observed_at DESC LIMIT 256""")
            ).mappings()
        )
        components = list(
            current.execute(
                text("""SELECT component,
            BOOL_AND(revision=:revision AND policy_hash=:hash) AS current,
            COUNT(*) AS consumers,MAX(observed_at) AS observed_at
            FROM agent_runtime_adoptions WHERE observed_at>NOW()-INTERVAL '90 seconds'
            GROUP BY component"""),
                {"revision": revision, "hash": fingerprint},
            ).mappings()
        )
        matching = {row["component"] for row in components if row["current"]}
        pending = sorted(set(ADOPTION_COMPONENTS) - matching)
        return {
            "configured_revision": revision,
            "policy_hash": fingerprint,
            "policy": policy,
            "effective_revision": revision if not pending else None,
            "adoption_status": "effective" if not pending else "pending_adoption",
            "pending_components": pending,
            "adoptions": [dict(row) for row in rows],
            "component_adoptions": [dict(row) for row in components],
            "updated_at": stored["updated_at"] if stored else None,
            "read_at": datetime.now(timezone.utc).isoformat(),
            "slot_semantics": "admission_limits; running tasks are not interrupted; OS processes are not resized",
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


__all__ = ["decode_schedules", "read_schedules_state", "read_runtime_policy_state"]
