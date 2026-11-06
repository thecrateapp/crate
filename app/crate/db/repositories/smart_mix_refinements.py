"""Stored Smart Mix refinements (SM4.PR2, design §6, SM3-D5).

The table is the source of truth behind ``cache:smart-mix:refined-plan:v1:``.
The plan API reads it only for keys Redis misses, in one ``ANY(:keys)`` query;
reads are recorded later in a batch (``touch``) so serving a refinement never
writes to PostgreSQL. Rows hold the validated plan and the model's choice, never
the prompt or the raw answer.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, cast

from sqlalchemy import text
from sqlalchemy.engine import CursorResult

from crate.db.tx import optional_scope, read_scope

_COLUMNS = """
    refinement_key,
    from_entity_uid::text AS from_entity_uid,
    to_entity_uid::text AS to_entity_uid,
    from_profile_revision,
    to_profile_revision,
    planner_identifier,
    rules_revision,
    prompt_version,
    config_fingerprint,
    model_label,
    status,
    outcome_code,
    candidate_index,
    adjustments,
    plan,
    deterministic_plan_hash,
    reason,
    confidence,
    latency_ms,
    input_tokens,
    output_tokens,
    created_at,
    last_read_at
"""


def _public(row: Mapping[str, Any]) -> dict[str, Any]:
    stored = dict(row)
    if stored["confidence"] is not None:
        # REAL keeps about seven digits; the model reports two or three.
        stored["confidence"] = round(float(stored["confidence"]), 4)
    return stored


def get_many(keys: Sequence[str], *, session=None) -> dict[str, dict[str, Any]]:
    """The stored refinements of these keys, in one query."""
    unique = list(dict.fromkeys(key for key in keys if key))
    if not unique:
        return {}

    def _impl(current) -> dict[str, dict[str, Any]]:
        rows = current.execute(
            text(
                f"SELECT {_COLUMNS} FROM smart_mix_refined_plans "
                "WHERE refinement_key = ANY(:keys)"
            ),
            {"keys": unique},
        ).mappings()
        return {row["refinement_key"]: _public(row) for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def save(row: Mapping[str, Any], *, session=None) -> None:
    """Upsert one refinement by key; tokens come from its invocation, if any."""
    params = {
        **{
            key: row.get(key)
            for key in (
                "refinement_key",
                "from_entity_uid",
                "to_entity_uid",
                "from_profile_revision",
                "to_profile_revision",
                "planner_identifier",
                "rules_revision",
                "prompt_version",
                "config_fingerprint",
                "model_label",
                "status",
                "outcome_code",
                "candidate_index",
                "deterministic_plan_hash",
                "reason",
                "confidence",
                "latency_ms",
                "invocation_id",
            )
        },
        "adjustments": _json(row.get("adjustments")),
        "plan": _json(row.get("plan")),
    }
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                INSERT INTO smart_mix_refined_plans (
                    refinement_key, from_entity_uid, to_entity_uid,
                    from_profile_revision, to_profile_revision,
                    planner_identifier, rules_revision, prompt_version,
                    config_fingerprint, model_label, status, outcome_code,
                    candidate_index, adjustments, plan, deterministic_plan_hash,
                    reason, confidence, latency_ms, input_tokens, output_tokens
                )
                SELECT
                    :refinement_key, CAST(:from_entity_uid AS uuid),
                    CAST(:to_entity_uid AS uuid),
                    :from_profile_revision, :to_profile_revision,
                    :planner_identifier, :rules_revision, :prompt_version,
                    :config_fingerprint, :model_label, :status, :outcome_code,
                    :candidate_index, CAST(:adjustments AS jsonb),
                    CAST(:plan AS jsonb), :deterministic_plan_hash,
                    :reason, :confidence, :latency_ms,
                    invocation.input_tokens, invocation.output_tokens
                FROM (SELECT 1) AS one
                LEFT JOIN ai_invocations AS invocation
                    ON invocation.id = CAST(:invocation_id AS uuid)
                ON CONFLICT (refinement_key) DO UPDATE SET
                    from_profile_revision = EXCLUDED.from_profile_revision,
                    to_profile_revision = EXCLUDED.to_profile_revision,
                    config_fingerprint = EXCLUDED.config_fingerprint,
                    model_label = EXCLUDED.model_label,
                    status = EXCLUDED.status,
                    outcome_code = EXCLUDED.outcome_code,
                    candidate_index = EXCLUDED.candidate_index,
                    adjustments = EXCLUDED.adjustments,
                    plan = EXCLUDED.plan,
                    deterministic_plan_hash = EXCLUDED.deterministic_plan_hash,
                    reason = EXCLUDED.reason,
                    confidence = EXCLUDED.confidence,
                    latency_ms = EXCLUDED.latency_ms,
                    input_tokens = EXCLUDED.input_tokens,
                    output_tokens = EXCLUDED.output_tokens,
                    last_read_at = now()
                """
            ),
            params,
        )


def touch(keys: Sequence[str], *, session=None) -> int:
    """Record reads in one statement; returns how many stored keys it touched."""
    unique = list(dict.fromkeys(key for key in keys if key))
    if not unique:
        return 0
    with optional_scope(session) as current:
        result = current.execute(
            text(
                "UPDATE smart_mix_refined_plans SET last_read_at = now() "
                "WHERE refinement_key = ANY(:keys)"
            ),
            {"keys": unique},
        )
        return int(cast(CursorResult, result).rowcount or 0)


def invalidate_for_tracks(entity_uids: Sequence[str], *, session=None) -> int:
    """Delete refinements whose stored revision no longer matches a track's profile.

    A refinement of a track without a current profile is deleted too. Rows of
    other tracks, and of these tracks at their current revision, stay.
    """
    uids = list(dict.fromkeys(str(uid) for uid in entity_uids if uid))
    if not uids:
        return 0
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                WITH current_revision AS (
                    SELECT track.entity_uid, profile.profile_revision
                    FROM library_tracks AS track
                    LEFT JOIN track_mix_profiles AS profile
                        ON profile.track_id = track.id
                        AND profile.source_stale_at IS NULL
                    WHERE track.entity_uid = ANY(CAST(:uids AS uuid[]))
                ),
                requested AS (
                    SELECT CAST(uid AS uuid) AS entity_uid
                    FROM unnest(CAST(:uids AS text[])) AS uid
                ),
                revision AS (
                    SELECT requested.entity_uid, current_revision.profile_revision
                    FROM requested
                    LEFT JOIN current_revision USING (entity_uid)
                )
                DELETE FROM smart_mix_refined_plans AS refined
                USING revision
                WHERE (
                    refined.from_entity_uid = revision.entity_uid
                    AND refined.from_profile_revision
                        IS DISTINCT FROM revision.profile_revision
                ) OR (
                    refined.to_entity_uid = revision.entity_uid
                    AND refined.to_profile_revision
                        IS DISTINCT FROM revision.profile_revision
                )
                """
            ),
            {"uids": uids},
        )
        return int(cast(CursorResult, result).rowcount or 0)


def cleanup_unread_refinements(
    *, older_than_days: int = 180, limit: int = 10_000, session=None
) -> int:
    """Delete up to ``limit`` refinements unread for ``older_than_days`` days."""
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                DELETE FROM smart_mix_refined_plans
                WHERE refinement_key IN (
                    SELECT refinement_key FROM smart_mix_refined_plans
                    WHERE last_read_at < now() - make_interval(days => :days)
                    ORDER BY last_read_at
                    LIMIT :limit
                )
                """
            ),
            {"days": int(older_than_days), "limit": int(limit)},
        )
        return int(cast(CursorResult, result).rowcount or 0)


def refinement_latency_p50_ms(*, hours: int = 24, session=None) -> int | None:
    """Median model latency of the refinements stored in the last ``hours``.

    Only the coverage refresh reads this (capabilities serve its snapshot).
    """

    def _impl(current) -> int | None:
        value = current.execute(
            text(
                """
                SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
                FROM smart_mix_refined_plans
                WHERE created_at >= now() - make_interval(hours => :hours)
                  AND latency_ms IS NOT NULL
                """
            ),
            {"hours": int(hours)},
        ).scalar_one_or_none()
        return None if value is None else round(float(value))

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _json(value: Any) -> str | None:
    return None if value is None else json.dumps(value, sort_keys=True)


__all__ = [
    "cleanup_unread_refinements",
    "get_many",
    "invalidate_for_tracks",
    "refinement_latency_p50_ms",
    "save",
    "touch",
]
