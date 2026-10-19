"""Atomic UTC budgets and privacy-bounded activity.

Reserve charges input+maximum output immediately. Only a newly claimed reservation
returns its claim token; duplicate callers must never execute a provider request.
Terminal unknown usage keeps the entire charge but releases active concurrency.
Lock order: idempotency advisory lock (reserve only), connection, invocation, daily
buckets. Connection locks serialize all actions sharing a provider connection.
"""

from __future__ import annotations

import json
from uuid import UUID
from typing import NoReturn

from sqlalchemy import text

from crate.ai.actions import get_action
from crate.ai.contracts import AIConfigurationError
from crate.db.repositories.ai_configuration import _json, _read
from crate.db.tx import optional_scope


def _row(row, claimed=False) -> dict:
    data = _json(row)
    assert data is not None
    data["claimed"] = claimed
    data["claim_token"] = str(row["claim_token"]) if claimed else None
    return data


def _error(code, message) -> NoReturn:
    raise AIConfigurationError(code, message)


def reserve_invocation(
    context: dict,
    *,
    idempotency_key: str,
    input_tokens: int,
    output_tokens: int,
    actor_id: int | None = None,
    job_id: str | None = None,
    session=None,
) -> dict:
    """Return invocation row plus claimed:boolean and owner-only claim_token.

    context keys: connection_id, model_id (required), action_id for actions; profile_id,
    profile_version, config_fingerprint (optional). Raw input/output is never stored.
    invocation_kind defaults to 'action'. For 'probe', action_id must be None;
    probes share every connection budget, with profile/model metadata preserved.
    Budgets/errors raise AIConfigurationError. Tokens must be upper estimates.
    """
    kind = context.get("invocation_kind", "action")
    if kind == "action":
        action_id = context.get("action_id")
        if not isinstance(action_id, str):
            _error("AI_ACTION_UNKNOWN", "Unknown action")
        get_action(action_id)
    elif kind != "probe" or context.get("action_id") is not None:
        _error("AI_USAGE_INVALID", "Invalid invocation kind or action")
    if not 1 <= len(idempotency_key) <= 200 or any(
        type(n) is not int or not 0 <= n <= 1000000000
        for n in (input_tokens, output_tokens)
    ):
        _error("AI_USAGE_INVALID", "Invalid reservation")
    reserved = input_tokens + output_tokens
    with optional_scope(session) as s:
        # Global key serialization also handles the same key sent to different connections.
        s.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key,120))"),
            {"key": idempotency_key},
        )
        prior = (
            s.execute(
                text("SELECT * FROM ai_invocations WHERE idempotency_key=:key"),
                {"key": idempotency_key},
            )
            .mappings()
            .first()
        )
        if prior is not None:
            return _row(prior)
        conn = (
            s.execute(
                text("SELECT * FROM ai_provider_connections WHERE id=:id FOR UPDATE"),
                {"id": context["connection_id"]},
            )
            .mappings()
            .first()
        )
        if conn is None or not conn["enabled"]:
            _error("AI_CONNECTION_UNAVAILABLE", "Connection unavailable")
        day = s.execute(
            text("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date")
        ).scalar_one()
        # Read all action buckets while owning the connection lock; no aggregate race.
        totals = (
            s.execute(
                text(
                    "SELECT COALESCE(SUM(calls),0) calls,COALESCE(SUM(tokens),0) tokens FROM ai_usage_daily WHERE connection_id=:id AND day=:day"
                ),
                {"id": conn["id"], "day": day},
            )
            .mappings()
            .one()
        )
        if conn["active_invocations"] >= conn["max_concurrent"]:
            _error("AI_CONCURRENCY_LIMIT", "Connection concurrency limit reached")
        if totals["calls"] >= conn["daily_calls"]:
            _error("AI_DAILY_CALL_LIMIT", "Daily call limit reached")
        if totals["tokens"] + reserved > conn["daily_tokens"]:
            _error("AI_DAILY_TOKEN_LIMIT", "Daily token limit reached")
        params = {
            "connection_id": conn["id"],
            "action_id": context.get("action_id"),
            "kind": kind,
            "bucket_action": context.get("action_id") or "",
            "model_id": context["model_id"],
            "profile_id": context.get("profile_id"),
            "profile_version": context.get("profile_version"),
            "fingerprint": context.get("config_fingerprint"),
            "actor_id": actor_id,
            "job_id": job_id,
            "key": idempotency_key,
            "tokens": reserved,
            "day": day,
        }
        row = (
            s.execute(
                text("""INSERT INTO ai_invocations(connection_id,invocation_kind,action_id,model_id,profile_id,profile_version,
            config_fingerprint,actor_id,job_id,idempotency_key,reserved_tokens,charged_tokens,usage_day)
            VALUES(:connection_id,:kind,:action_id,:model_id,:profile_id,:profile_version,:fingerprint,:actor_id,:job_id,:key,:tokens,:tokens,:day) RETURNING *"""),
                params,
            )
            .mappings()
            .one()
        )
        s.execute(
            text(
                "UPDATE ai_provider_connections SET active_invocations=active_invocations+1 WHERE id=:connection_id"
            ),
            params,
        )
        s.execute(
            text("""INSERT INTO ai_usage_daily(day,connection_id,invocation_kind,action_id,calls,tokens)
            VALUES(:day,:connection_id,:kind,:bucket_action,1,:tokens) ON CONFLICT(day,connection_id,invocation_kind,action_id)
            DO UPDATE SET calls=ai_usage_daily.calls+1,tokens=ai_usage_daily.tokens+EXCLUDED.tokens"""),
            params,
        )
        return _row(row, claimed=True)


def finish_invocation(
    id,
    usage: dict | None,
    status: str,
    error_code: str | None = None,
    duration_ms: int = 0,
    reported_model: str | None = None,
    *,
    session=None,
) -> dict:
    """Idempotently finalize. usage={input_tokens,output_tokens}; None means unknown.

    input_tokens includes cache; cached_input_tokens is its subset. output_tokens
    excludes separately reported thought_tokens; charge is max(input+output+thought,
    reliable total_tokens). Transport must normalize providers that combine thought
    with output. Optional counters are retained, never cache-double-counted.
    Missing/invalid usage remains conservatively charged at reservation maximum.
    Return invocation row with claimed=False and claim_token=None. Estimated cost
    stays null; token accounting never implies an exact provider invoice.
    """
    if status not in {"succeeded", "failed", "timeout", "cancelled"}:
        _error("AI_USAGE_INVALID", "Invalid terminal status")
    if (
        duration_ms < 0
        or (error_code and len(error_code) > 80)
        or (reported_model and len(reported_model) > 200)
    ):
        _error("AI_USAGE_INVALID", "Invalid completion metadata")
    known = usage is not None and all(
        type(usage.get(k)) is int and 0 <= usage[k] <= 1000000000
        for k in ("input_tokens", "output_tokens")
    )
    usage = usage or {}
    if known:
        known = all(
            usage.get(k) is None
            or (type(usage[k]) is int and 0 <= usage[k] <= 1000000000)
            for k in ("thought_tokens", "cached_input_tokens", "total_tokens")
        )
    if known and usage.get("cached_input_tokens") is not None:
        known = usage["cached_input_tokens"] <= usage["input_tokens"]
    with optional_scope(session) as s:
        # Nonlocking lookup discovers connection; never lock invocation before connection.
        connection_id = s.execute(
            text("SELECT connection_id FROM ai_invocations WHERE id=:id"), {"id": id}
        ).scalar_one_or_none()
        if connection_id is None:
            _error("AI_INVOCATION_UNKNOWN", "Invocation not found")
        s.execute(
            text("SELECT id FROM ai_provider_connections WHERE id=:id FOR UPDATE"),
            {"id": connection_id},
        )
        row = (
            s.execute(
                text("SELECT * FROM ai_invocations WHERE id=:id FOR UPDATE"), {"id": id}
            )
            .mappings()
            .one()
        )
        if row["status"] != "reserved":
            return _row(row)
        charged = (
            max(
                usage["input_tokens"]
                + usage["output_tokens"]
                + (usage.get("thought_tokens") or 0),
                usage.get("total_tokens") or 0,
            )
            if known
            else row["reserved_tokens"]
        )
        params = {
            "id": id,
            "connection": connection_id,
            "status": status,
            "error": error_code,
            "duration": duration_ms,
            "model": reported_model,
            "known": known,
            "input": usage["input_tokens"] if known else None,
            "output": usage["output_tokens"] if known else None,
            "thought": usage.get("thought_tokens") if known else None,
            "cached": usage.get("cached_input_tokens") if known else None,
            "total": usage.get("total_tokens") if known else None,
            "charged": charged,
            "delta": charged - row["charged_tokens"],
            "day": row["usage_day"],
            "action": row["action_id"] or "",
            "kind": row["invocation_kind"],
            "failed": int(status != "succeeded"),
        }
        s.execute(
            text(
                "UPDATE ai_provider_connections SET active_invocations=active_invocations-1 WHERE id=:connection"
            ),
            params,
        )
        s.execute(
            text("""UPDATE ai_usage_daily SET tokens=tokens+:delta,completed=completed+1,failed=failed+:failed
            WHERE day=:day AND connection_id=:connection AND invocation_kind=:kind AND action_id=:action"""),
            params,
        )
        result = (
            s.execute(
                text("""UPDATE ai_invocations SET status=:status,error_code=:error,duration_ms=:duration,
            reported_model=:model,usage_known=:known,input_tokens=:input,output_tokens=:output,thought_tokens=:thought,cached_input_tokens=:cached,total_tokens=:total,charged_tokens=:charged,finished_at=NOW()
            WHERE id=:id RETURNING *"""),
                params,
            )
            .mappings()
            .one()
        )
        return _row(result)


def list_invocations(filters, limit=50, cursor=None, *, session=None) -> dict:
    """Keyset page: {items, next_cursor}; filters connection_id/action_id/invocation_kind/status/actor_id.

    Cursor is opaque JSON [created_at,id] emitted by this repository. Claim tokens
    are omitted. Activity older than 90 days is excluded even before bounded prune.
    """
    clauses = ["created_at>=NOW()-INTERVAL '90 days'"]
    params = {"limit": min(max(limit, 1), 200) + 1}
    for key in ("connection_id", "action_id", "invocation_kind", "status", "actor_id"):
        if filters.get(key) is not None:
            clauses.append(f"{key}=:{key}")
            params[key] = filters[key]
    if cursor:
        try:
            created, identifier = json.loads(cursor)
            UUID(identifier)
        except (ValueError, TypeError):
            _error("AI_USAGE_INVALID", "Invalid activity cursor")
        clauses.append(
            "(created_at,id)<(CAST(:created AS timestamptz),CAST(:identifier AS uuid))"
        )
        params.update(created=created, identifier=identifier)
    with _read(session) as s:
        rows = (
            s.execute(
                text(
                    f"SELECT * FROM ai_invocations WHERE {' AND '.join(clauses)} ORDER BY created_at DESC,id DESC LIMIT :limit"
                ),
                params,
            )
            .mappings()
            .all()
        )
        has_more = len(rows) == params["limit"]
        items = [_row(r) for r in rows[: params["limit"] - 1]]
        next_cursor = (
            json.dumps([items[-1]["created_at"], items[-1]["id"]]) if has_more else None
        )
        return {"items": items, "next_cursor": next_cursor}


def usage_summary(*, session=None) -> dict:
    """{totals:{calls,tokens,completed,failed,estimated_cost},daily:[bucket rows]}.

    Only precomputed UTC buckets are aggregated, never invocation history.
    """
    with _read(session) as s:
        daily = [
            _json(r)
            for r in s.execute(
                text(
                    "SELECT * FROM ai_usage_daily WHERE day>=(NOW() AT TIME ZONE 'UTC')::date-89 ORDER BY day DESC,connection_id,action_id"
                )
            ).mappings()
        ]
        for bucket in daily:
            if bucket["invocation_kind"] == "probe":
                bucket["action_id"] = None
        totals: dict = {
            key: sum(row[key] for row in daily)
            for key in ("calls", "tokens", "completed", "failed")
        }
        totals["estimated_cost"] = None
        return {"totals": totals, "daily": daily}


def prune_ai_activity(limit=500, *, session=None) -> dict:
    """Delete at most limit terminal rows older than 90 days; retain usage buckets.

    Unfinished reservations are never reclaimed by time, avoiding billing bypass.
    """
    with optional_scope(session) as s:
        deleted = s.execute(
            text("""WITH expired AS (SELECT id FROM ai_invocations
            WHERE created_at<NOW()-INTERVAL '90 days' AND status<>'reserved'
            ORDER BY created_at,id LIMIT :limit FOR UPDATE SKIP LOCKED)
            DELETE FROM ai_invocations WHERE id IN (SELECT id FROM expired) RETURNING id"""),
            {"limit": min(max(limit, 1), 5000)},
        ).all()
        return {"deleted": len(deleted)}


__all__ = [
    "reserve_invocation",
    "finish_invocation",
    "list_invocations",
    "usage_summary",
    "prune_ai_activity",
]
