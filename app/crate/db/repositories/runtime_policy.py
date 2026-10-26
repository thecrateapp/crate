"""Transactional schedule configuration, runtime policy and worker adoption."""

from __future__ import annotations

import json
import os
import socket
from datetime import UTC, datetime

from sqlalchemy import text

from crate.db.queries.agent_runtime_policy import (
    read_runtime_policy_state,
    read_schedules_state,
)
from crate.db.tx import optional_scope
from crate.runtime_policy_contract import (
    ADOPTION_COMPONENTS,
    POOLS,
    SCHEDULE_MAX_INTERVAL,
    PolicyRevisionConflict,
    merge_runtime_policy,
)


def _setting(current, key, value):
    current.execute(
        text("""INSERT INTO settings(key,value) VALUES(:key,:value)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"""),
        {"key": key, "value": value},
    )


def update_schedules(patch: dict, *, expected_revision: str, session=None) -> dict:
    from crate.scheduler import DEFAULT_SCHEDULES

    if (
        not isinstance(patch, dict)
        or not patch
        or any(
            name not in DEFAULT_SCHEDULES
            or type(value) is not int
            or not 0 <= value <= SCHEDULE_MAX_INTERVAL
            for name, value in patch.items()
        )
    ):
        raise ValueError("Schedules require known names and bounded integer intervals")
    with optional_scope(session) as current:
        current.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended('crate:schedules',0))")
        )
        state = read_schedules_state(session=current)
        if state["revision"] != expected_revision:
            raise PolicyRevisionConflict("Schedule revision changed")
        _setting(
            current,
            "schedules",
            json.dumps({**state["schedules"], **patch}, sort_keys=True),
        )
        return read_schedules_state(session=current)


def update_runtime_policy(
    patch: dict,
    *,
    expected_revision: int,
    expected_policy_hash: str | None = None,
    session=None,
) -> dict:
    if type(expected_revision) is not int or expected_revision < 0:
        raise ValueError("A nonnegative runtime revision is required")
    with optional_scope(session) as current:
        current.execute(
            text(
                "SELECT pg_advisory_xact_lock(hashtextextended('crate:runtime-policy',0))"
            )
        )
        current.execute(
            text(
                "SELECT singleton FROM agent_runtime_policy WHERE singleton FOR UPDATE"
            )
        )
        state = read_runtime_policy_state(session=current)
        if (
            state["configured_revision"] != expected_revision
            or expected_policy_hash is not None
            and state["policy_hash"] != expected_policy_hash
        ):
            raise PolicyRevisionConflict("Runtime revision changed")
        policy = merge_runtime_policy(state["policy"], patch)
        if policy == state["policy"]:
            return state
        current.execute(
            text("""INSERT INTO agent_runtime_policy(singleton,revision,policy)
            VALUES(TRUE,:revision,CAST(:policy AS jsonb))
            ON CONFLICT(singleton) DO UPDATE SET revision=EXCLUDED.revision,
                policy=EXCLUDED.policy,updated_at=NOW()"""),
            {"revision": expected_revision + 1, "policy": json.dumps(policy)},
        )
        # Existing download consumers and Admin fields retain the same canonical values.
        window, downloads = policy["download_window"], policy["downloads"]
        for key, value in {
            "download_window_enabled": str(window["enabled"]).lower(),
            "download_window_start": window["start"],
            "download_window_end": window["end"],
            "download_window_timezone": window["timezone"],
            "download_max_active_users": str(downloads["max_active_users"]),
            "download_max_active_streams": str(downloads["max_active_streams"]),
        }.items():
            _setting(current, key, value)
        return read_runtime_policy_state(session=current)


def update_admission_slots(
    slots: int, *, expected_revision: int | None = None, session=None
) -> dict:
    if type(slots) is not int or not 1 <= slots <= 64:
        raise ValueError("Slots must be an integer between 1 and 64")
    state = read_runtime_policy_state(session=session)
    return update_runtime_policy(
        {
            "max_running": slots,
            "pools": {
                pool: min(limit, slots)
                for pool, limit in state["policy"]["pools"].items()
            },
        },
        expected_revision=state["configured_revision"]
        if expected_revision is None
        else expected_revision,
        expected_policy_hash=state["policy_hash"],
        session=session,
    )


def record_runtime_adoption(
    component: str,
    revision: int,
    policy_hash: str,
    *,
    consumer_id: str | None = None,
    session=None,
) -> None:
    if (
        component not in ADOPTION_COMPONENTS
        or type(revision) is not int
        or revision < 0
    ):
        raise ValueError("Unknown runtime consumer or revision")
    if not isinstance(policy_hash, str) or len(policy_hash) != 64:
        raise ValueError("A policy hash is required for adoption evidence")
    identity = consumer_id or f"{socket.gethostname()}:{os.getpid()}"
    if not identity or len(identity) > 160:
        raise ValueError("Invalid runtime consumer identity")
    with optional_scope(session) as current:
        current.execute(
            text("""INSERT INTO agent_runtime_adoptions(consumer_id,component,revision,policy_hash)
            VALUES(:consumer,:component,:revision,:hash)
            ON CONFLICT(consumer_id,component) DO UPDATE SET revision=EXCLUDED.revision,
                policy_hash=EXCLUDED.policy_hash,observed_at=NOW()"""),
            {
                "consumer": identity,
                "component": component,
                "revision": revision,
                "hash": policy_hash,
            },
        )
        # These are short-lived observations, not an ever-growing process registry.
        current.execute(
            text(
                "DELETE FROM agent_runtime_adoptions WHERE observed_at<NOW()-INTERVAL '1 day'"
            )
        )


def admit_task_start(
    current,
    task_id: str,
    worker_id: str | None,
    *,
    expected_revision=None,
    expected_hash=None,
) -> bool:
    """Used inside the task claim transaction, before pending -> running."""
    row = (
        current.execute(
            text("SELECT pool,status,type FROM tasks WHERE id=:id"), {"id": task_id}
        )
        .mappings()
        .first()
    )
    if row is None or row["status"] != "pending":
        return False
    pool = row["pool"] or "default"
    if pool not in POOLS:
        return False
    # The policy lock prevents a concurrent reduction from passing old admission.
    current.execute(
        text(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended('crate:runtime-policy',0))"
        )
    )
    current.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('crate:task-admission',0))")
    )
    state = read_runtime_policy_state(session=current, include_adoptions=False)
    if expected_revision is not None and (
        expected_revision != state["configured_revision"]
        or expected_hash != state["policy_hash"]
    ):
        return False
    if row["type"] == "agent_control":
        return (
            current.execute(
                text(
                    "SELECT 1 FROM tasks WHERE type='agent_control' AND status='running' LIMIT 1"
                )
            ).first()
            is None
        )
    counts = (
        current.execute(
            text("""SELECT COUNT(*) AS total,
        COUNT(*) FILTER(WHERE COALESCE(NULLIF(pool,''),'default')=:pool) AS in_pool
        FROM tasks WHERE status='running' AND type<>'agent_control'"""),
            {"pool": pool},
        )
        .mappings()
        .one()
    )
    allowed = (
        counts["total"] < state["policy"]["max_running"]
        and counts["in_pool"] < state["policy"]["pools"][pool]
    )
    record_runtime_adoption(
        f"pool:{pool}",
        state["configured_revision"],
        state["policy_hash"],
        consumer_id=worker_id or None,
        session=current,
    )
    return allowed


def mark_schedule_enqueued(task_type: str, *, session=None) -> None:
    with optional_scope(session) as current:
        _setting(
            current,
            f"schedule:last_run:{task_type}",
            datetime.now(UTC).isoformat(),
        )


def enqueue_schedule(
    task_type: str,
    *,
    origin,
    actor_user_id,
    agent_context,
    required_grants,
    decision,
    expected_schedule_revision=None,
    session=None,
) -> dict:
    from crate.db.repositories.tasks import create_task_dedup
    from crate.task_dedup_keys import GLOBAL_CATALOG_FULL_DEDUP_KEY

    with optional_scope(session) as current:
        current.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended('crate:schedules',0))")
        )
        current.execute(
            text(
                "SELECT pg_advisory_xact_lock_shared(hashtextextended('crate:runtime-policy',0))"
            )
        )
        schedule_state = read_schedules_state(session=current)
        if (
            expected_schedule_revision is not None
            and schedule_state["revision"] != expected_schedule_revision
        ):
            from crate.agent_diagnostics import DiagnosticError

            raise DiagnosticError(
                "PLAN_STALE", "Schedule configuration changed after approval"
            )
        schedules = schedule_state["schedules"]
        if schedules[task_type] <= 0:
            return {
                "status": "disabled",
                "task_id": None,
                "reason": "The schedule is disabled",
            }
        state = read_runtime_policy_state(session=current, include_adoptions=False)
        if (
            decision.policy_revision != state["configured_revision"]
            or decision.policy_hash != state["policy_hash"]
        ):
            raise PolicyRevisionConflict(
                "Runtime policy changed while checking schedule admission"
            )
        task_id = create_task_dedup(
            task_type,
            dedup_key=GLOBAL_CATALOG_FULL_DEDUP_KEY
            if task_type == "global_catalog_reconcile_full"
            else f"schedule:{task_type}",
            origin=origin,
            actor_user_id=actor_user_id,
            agent_context=agent_context,
            required_grants=required_grants,
            schedule_name=task_type,
            session=current,
        )
        if task_id:
            if (agent_context or {}).get("parent_authority"):
                current.execute(
                    text("UPDATE tasks SET max_retries=0 WHERE id=:id"), {"id": task_id}
                )
            mark_schedule_enqueued(task_type, session=current)
        record_runtime_adoption(
            "scheduler",
            state["configured_revision"],
            state["policy_hash"],
            session=current,
        )
        return {"status": "queued" if task_id else "already_queued", "task_id": task_id}


__all__ = [
    "admit_task_start",
    "enqueue_schedule",
    "mark_schedule_enqueued",
    "read_runtime_policy_state",
    "read_schedules_state",
    "record_runtime_adoption",
    "update_admission_slots",
    "update_runtime_policy",
    "update_schedules",
]
