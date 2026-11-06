"""Bounded, priority-aware Smart Mix profile backfill claims."""

from __future__ import annotations

import json
import os
import socket
import uuid
from typing import Any, Sequence

from sqlalchemy import text

from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.tx import optional_scope, read_scope
from crate.smart_mix.backfill_window import merge_backfill_window_settings
from crate.smart_mix.versions import (
    ANALYZER_VERSION,
    PROFILE_SCHEMA_VERSION,
    PYTHON_ANALYZER,
)


SMART_MIX_PIPELINE = "smart_mix"
SMART_MIX_ANALYZER_VERSION = ANALYZER_VERSION
MAX_BACKFILL_BATCH_SIZE = 100
DEFAULT_MAX_ATTEMPTS = 3
BACKFILL_TASK_TYPE = "backfill_smart_mix_profiles"
PROFILE_TASK_TYPE = "compute_smart_mix_profile"
CAMPAIGN_STATE_KEY = "smart_mix:backfill_campaign"
COVERAGE_STATE_KEY = "smart_mix:coverage"
LIVE_COVERAGE_MAX_AGE_SECONDS = 10
# The coordinator claims a batch and then queues one child task per claim, so a
# claim has no child for a moment. Past this grace a claim without a child is
# dead: the coordinator stopped between the two steps.
UNQUEUED_CLAIM_GRACE_SECONDS = 300
DEAD_CLAIM_ERROR = "The analysis task ended without settling its claim"
_PROFILE_DEDUP_PREFIX = "smart-mix-profile:"
# Serializes counting and claiming between coordinators, so two of them can
# never both see the same free slots.
_CLAIM_LOCK_KEY = "smart_mix:backfill_claim"

# A backfill claim is alive while its child task is pending or running, however
# long the resource governor defers it or its retries take; the task row is the
# source of truth. A child that failed for good, was cancelled or was lost with
# its worker (zombie cleanup marks it failed) ends its claim at once. A claim
# that never had a child counts only during the grace.
_CHILD_OF_CLAIM_SQL = (
    "child.type = :profile_task_type"
    " AND child.dedup_key"
    " = CAST(:profile_dedup_prefix AS text) || {claim}.track_id::text"
    " AND child.params_json->>'claim_token' = {claim}.claimed_by"
)
_LIVE_CLAIM_SQL = f"""
    (
        EXISTS (
            SELECT 1
            FROM tasks child
            WHERE {_CHILD_OF_CLAIM_SQL}
              AND child.status IN ('pending', 'running')
        )
        OR (
            {{claim}}.claimed_at
                >= NOW() - make_interval(secs => :unqueued_claim_grace)
            AND NOT EXISTS (
                SELECT 1
                FROM tasks child
                WHERE child.created_at >= {{claim}}.claimed_at - INTERVAL '1 minute'
                  AND {_CHILD_OF_CLAIM_SQL}
            )
        )
    )
"""
_LIVE_CLAIM_PARAMS = {
    "profile_task_type": PROFILE_TASK_TYPE,
    "profile_dedup_prefix": _PROFILE_DEDUP_PREFIX,
    "unqueued_claim_grace": UNQUEUED_CLAIM_GRACE_SECONDS,
}


def smart_mix_profile_dedup_key(track_id: int) -> str:
    """Dedup key of a track's profile task; claims find their child through it."""
    return f"{_PROFILE_DEDUP_PREFIX}{int(track_id)}"


def claim_smart_mix_backfill_batch(
    *,
    limit: int,
    max_in_flight: int | None = None,
    offline_track_ids: Sequence[int] = (),
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    claimed_by: str | None = None,
    promote_python_profiles: bool = False,
    session=None,
) -> list[dict[str, Any]]:
    """Claim up to ``limit`` tracks for the backfill.

    With ``max_in_flight`` the claim counts what is in flight and takes only the
    free slots, under a transaction lock, so concurrent coordinators cannot
    exceed the limit between the count and the claim.
    """
    batch_size = max(1, min(int(limit), MAX_BACKFILL_BATCH_SIZE))
    retry_limit = max(1, min(int(max_attempts), 10))
    offline_ids = sorted({int(track_id) for track_id in offline_track_ids})
    worker = claimed_by or (
        f"{os.environ.get('CRATE_RUNTIME', 'runtime')}:{socket.gethostname()}"
    )
    with optional_scope(session) as active_session:
        if max_in_flight is not None:
            active_session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                {"key": _CLAIM_LOCK_KEY},
            )
        release_dead_smart_mix_claims(session=active_session)
        if max_in_flight is not None:
            free = int(max_in_flight) - count_smart_mix_in_flight(
                session=active_session
            )
            if free <= 0:
                return []
            batch_size = min(batch_size, free)
        rows = (
            active_session.execute(
                text(
                    """
                    SELECT
                        lt.id,
                        lt.entity_uid::text AS entity_uid,
                        lt.path,
                        lt.artist,
                        lt.album,
                        lt.title,
                        ranked.priority
                    FROM library_tracks lt
                    LEFT JOIN library_albums la ON la.id = lt.album_id
                    LEFT JOIN track_mix_profiles profile
                        ON profile.track_id = lt.id
                    LEFT JOIN track_processing_state processing
                        ON processing.track_id = lt.id
                       AND processing.pipeline = :pipeline
                    CROSS JOIN LATERAL (
                        SELECT CASE
                            WHEN EXISTS (
                                SELECT 1
                                FROM user_playback_device_states playback
                                WHERE playback.track_id = lt.id
                                   OR playback.track_entity_uid = lt.entity_uid
                                   OR EXISTS (
                                       SELECT 1
                                       FROM jsonb_array_elements(
                                           COALESCE(playback.queue_json, '[]'::jsonb)
                                       ) queue_item
                                       WHERE NULLIF(
                                           COALESCE(
                                               queue_item->>'id',
                                               queue_item->>'trackId'
                                           ),
                                           ''
                                       ) = lt.id::text
                                          OR NULLIF(
                                              COALESCE(
                                                  queue_item->>'entityUid',
                                                  queue_item->>'trackEntityUid'
                                              ),
                                              ''
                                          ) = lt.entity_uid::text
                                   )
                            ) THEN 1
                            WHEN lt.id = ANY(CAST(:offline_track_ids AS integer[]))
                                THEN 2
                            WHEN EXISTS (
                                SELECT 1 FROM user_liked_tracks liked
                                WHERE liked.track_id = lt.id
                            ) OR EXISTS (
                                SELECT 1 FROM user_saved_albums saved
                                WHERE saved.album_id = lt.album_id
                            ) OR EXISTS (
                                SELECT 1 FROM playlist_tracks playlist_track
                                WHERE playlist_track.track_id = lt.id
                                   OR playlist_track.track_entity_uid = lt.entity_uid
                            ) OR EXISTS (
                                SELECT 1 FROM user_follows followed
                                WHERE followed.artist_name = lt.artist
                            ) THEN 3
                            WHEN EXISTS (
                                SELECT 1 FROM user_play_events played
                                WHERE played.track_id = lt.id
                                   OR played.track_entity_uid = lt.entity_uid
                            ) OR EXISTS (
                                SELECT 1 FROM play_history history
                                WHERE history.track_id = lt.id
                                   OR history.track_entity_uid = lt.entity_uid
                            ) THEN 4
                            ELSE 5
                        END AS priority
                    ) ranked
                    WHERE la.quarantined_at IS NULL
                      AND (
                          profile.track_id IS NULL
                          OR profile.profile_version <> 1
                          OR profile.analyzer_version <> :analyzer_version
                          OR profile.quality = 'unavailable'
                          OR profile.source_stale_at IS NOT NULL
                          OR (
                              :promote_python_profiles
                              AND profile.analyzer = :python_analyzer
                          )
                      )
                      AND (
                          processing.track_id IS NULL
                          OR (
                              processing.state <> 'analyzing'
                              AND (
                                  processing.target_generation
                                      IS DISTINCT FROM :analyzer_version
                                  OR processing.attempts < :max_attempts
                              )
                          )
                      )
                    ORDER BY
                        COALESCE(
                            profile.analyzer = :python_analyzer
                            AND profile.profile_version = 1
                            AND profile.analyzer_version = :analyzer_version
                            AND profile.quality <> 'unavailable'
                            AND profile.source_stale_at IS NULL,
                            FALSE
                        ),
                        ranked.priority,
                        lt.id
                    FOR UPDATE OF lt SKIP LOCKED
                    LIMIT :limit
                    """
                ),
                {
                    "pipeline": SMART_MIX_PIPELINE,
                    "analyzer_version": SMART_MIX_ANALYZER_VERSION,
                    "offline_track_ids": offline_ids,
                    "max_attempts": retry_limit,
                    "limit": batch_size,
                    "promote_python_profiles": promote_python_profiles,
                    "python_analyzer": PYTHON_ANALYZER,
                },
            )
            .mappings()
            .all()
        )
        claimed = []
        for row in rows:
            claim_token = f"{worker}:{uuid.uuid4().hex}"
            active_session.execute(
                text(
                    """
                    INSERT INTO track_processing_state (
                        track_id, pipeline, state, claimed_by, claimed_at,
                        attempts, priority, last_error, target_generation,
                        updated_at
                    )
                    VALUES (
                        :track_id, :pipeline, 'analyzing', :claimed_by, NOW(),
                        1, :priority, NULL, :analyzer_version, NOW()
                    )
                    ON CONFLICT (track_id, pipeline) DO UPDATE SET
                        state = 'analyzing',
                        claimed_by = EXCLUDED.claimed_by,
                        claimed_at = EXCLUDED.claimed_at,
                        attempts = CASE
                            WHEN track_processing_state.target_generation
                                IS DISTINCT FROM EXCLUDED.target_generation
                                THEN 1
                            ELSE track_processing_state.attempts + 1
                        END,
                        target_generation = EXCLUDED.target_generation,
                        priority = EXCLUDED.priority,
                        last_error = NULL,
                        completed_at = NULL,
                        updated_at = NOW()
                    """
                ),
                {
                    "track_id": int(row["id"]),
                    "pipeline": SMART_MIX_PIPELINE,
                    "claimed_by": claim_token,
                    "priority": int(row["priority"]),
                    "analyzer_version": SMART_MIX_ANALYZER_VERSION,
                },
            )
            claimed.append({**dict(row), "claim_token": claim_token})
        return claimed


def release_smart_mix_claims(track_ids: Sequence[int], *, session=None) -> int:
    cleaned = sorted({int(track_id) for track_id in track_ids if track_id})
    if not cleaned:
        return 0
    with optional_scope(session) as active_session:
        result = active_session.execute(
            text(
                """
                UPDATE track_processing_state
                SET state = 'pending',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    updated_at = NOW()
                WHERE pipeline = :pipeline
                  AND track_id = ANY(:track_ids)
                  AND state = 'analyzing'
                """
            ),
            {"pipeline": SMART_MIX_PIPELINE, "track_ids": cleaned},
        )
        return int(getattr(result, "rowcount", 0) or 0)


def release_dead_smart_mix_claims(*, session=None) -> int:
    """Settle claims whose child task is gone as failed attempts.

    The attempt was counted when the track was claimed, so a track whose
    analysis keeps killing its worker still runs out of attempts. The service
    loop calls this after its zombie cleanup, and every claim starts with it.
    Rows another transaction holds are skipped: two sweeps at once would
    otherwise wait on each other, and the claim of a coordinator would fail on
    the lock timeout. The other sweep settles them.
    """
    with optional_scope(session) as active_session:
        result = active_session.execute(
            text(
                f"""
                WITH dead AS (
                    SELECT claim.track_id, claim.pipeline
                    FROM track_processing_state claim
                    WHERE claim.pipeline = :pipeline
                      AND claim.state = 'analyzing'
                      AND NOT {_LIVE_CLAIM_SQL.format(claim="claim")}
                    FOR UPDATE OF claim SKIP LOCKED
                )
                UPDATE track_processing_state settled
                SET state = 'failed',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    last_error = :reason,
                    updated_at = NOW()
                FROM dead
                WHERE settled.track_id = dead.track_id
                  AND settled.pipeline = dead.pipeline
                """
            ),
            {
                "pipeline": SMART_MIX_PIPELINE,
                "reason": DEAD_CLAIM_ERROR,
                **_LIVE_CLAIM_PARAMS,
            },
        )
        return int(getattr(result, "rowcount", 0) or 0)


def count_smart_mix_in_flight(*, session=None) -> int:
    """Count the live claims of this backfill for the current target."""
    with optional_scope(session) as active_session:
        return int(
            active_session.execute(
                text(
                    f"""
                    SELECT COUNT(*)
                    FROM track_processing_state claim
                    WHERE claim.pipeline = :pipeline
                      AND claim.state = 'analyzing'
                      AND claim.target_generation = :analyzer_version
                      AND {_LIVE_CLAIM_SQL.format(claim="claim")}
                    """
                ),
                {
                    "pipeline": SMART_MIX_PIPELINE,
                    "analyzer_version": SMART_MIX_ANALYZER_VERSION,
                    **_LIVE_CLAIM_PARAMS,
                },
            ).scalar_one()
        )


def seconds_since_smart_mix_change(*, session=None) -> float | None:
    """Seconds since a Smart Mix processing row last changed, or None if none.

    Claims, finished and failed analyses and released claims all touch
    ``updated_at``, so this is how long the backfill's slots have stayed as
    they are. An index range on ``(pipeline, updated_at DESC)`` answers it.
    """
    with optional_scope(session) as active_session:
        seconds = active_session.execute(
            text(
                """
                SELECT EXTRACT(EPOCH FROM NOW() - MAX(updated_at))
                FROM track_processing_state
                WHERE pipeline = :pipeline
                """
            ),
            {"pipeline": SMART_MIX_PIPELINE},
        ).scalar_one_or_none()
    return None if seconds is None else float(seconds)


def refresh_smart_mix_coverage(*, max_attempts: int = DEFAULT_MAX_ATTEMPTS) -> dict:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    WITH eligible AS MATERIALIZED (
                        SELECT track.id
                        FROM library_tracks track
                        LEFT JOIN library_albums album ON album.id = track.album_id
                        WHERE album.quarantined_at IS NULL
                    ),
                    profiles AS (
                        SELECT
                            eligible.id,
                            profile.quality,
                            profile.track_id IS NOT NULL
                                AND profile.quality <> 'unavailable'
                                AND profile.profile_version = :profile_version
                                AND profile.analyzer_version = :analyzer_version
                                AND profile.source_stale_at IS NULL
                                AS is_current,
                            profile.track_id IS NOT NULL
                                AND profile.quality <> 'unavailable'
                                AND (
                                    profile.profile_version <> :profile_version
                                    OR profile.analyzer_version <> :analyzer_version
                                    OR profile.source_stale_at IS NOT NULL
                                )
                                AS is_stale,
                            profile.track_id IS NOT NULL
                                AND profile.quality <> 'unavailable'
                                AND profile.source_stale_at IS NULL
                                AND (
                                    profile.profile_version <> :profile_version
                                    OR profile.analyzer_version <> :analyzer_version
                                )
                                AS is_outdated,
                            profile.track_id IS NOT NULL
                                AND profile.quality <> 'unavailable'
                                AND profile.source_stale_at IS NOT NULL
                                AS is_source_changed,
                            processing.state,
                            processing.attempts,
                            processing.target_generation = :analyzer_version
                                AS targets_current
                        FROM eligible
                        LEFT JOIN track_mix_profiles profile
                            ON profile.track_id = eligible.id
                        LEFT JOIN track_processing_state processing
                            ON processing.track_id = eligible.id
                           AND processing.pipeline = :pipeline
                    )
                    SELECT
                        COUNT(*)::int AS total_tracks,
                        COUNT(*) FILTER (WHERE is_current)::int AS current_profiles,
                        COUNT(*) FILTER (WHERE is_stale)::int AS stale_profiles,
                        COUNT(*) FILTER (WHERE is_outdated)::int AS outdated_profiles,
                        COUNT(*) FILTER (
                            WHERE is_source_changed
                        )::int AS source_changed_profiles,
                        COUNT(*) FILTER (WHERE quality = 'full')::int AS full_profiles,
                        COUNT(*) FILTER (
                            WHERE is_current AND quality = 'full'
                        )::int AS current_full_profiles,
                        COUNT(*) FILTER (
                            WHERE is_current AND quality = 'partial'
                        )::int AS current_partial_profiles,
                        COUNT(*) FILTER (
                            WHERE is_current AND quality = 'legacy'
                        )::int AS current_legacy_profiles,
                        COUNT(*) FILTER (
                            WHERE quality = 'partial'
                        )::int AS partial_profiles,
                        COUNT(*) FILTER (
                            WHERE quality = 'legacy'
                        )::int AS legacy_profiles,
                        COUNT(*) FILTER (
                            WHERE quality = 'unavailable'
                        )::int AS unavailable_profiles,
                        COUNT(*) FILTER (WHERE state = 'pending')::int AS pending,
                        COUNT(*) FILTER (WHERE state = 'analyzing')::int AS active,
                        COUNT(*) FILTER (
                            WHERE state = 'failed'
                              AND targets_current
                              AND attempts < :max_attempts
                        )::int AS failed,
                        COUNT(*) FILTER (
                            WHERE NOT is_current
                              AND targets_current
                              AND state <> 'analyzing'
                              AND attempts >= :max_attempts
                        )::int AS exhausted,
                        COUNT(*) FILTER (WHERE state = 'done')::int AS completed
                    FROM profiles
                    """
                ),
                {
                    "pipeline": SMART_MIX_PIPELINE,
                    "profile_version": PROFILE_SCHEMA_VERSION,
                    "analyzer_version": SMART_MIX_ANALYZER_VERSION,
                    "max_attempts": max(1, int(max_attempts)),
                },
            )
            .mappings()
            .one()
        )
        version_rows = (
            session.execute(
                text(
                    """
                    SELECT profile.analyzer_version, COUNT(*)::int AS profiles
                    FROM track_mix_profiles profile
                    JOIN library_tracks track ON track.id = profile.track_id
                    LEFT JOIN library_albums album ON album.id = track.album_id
                    WHERE album.quarantined_at IS NULL
                    GROUP BY profile.analyzer_version
                    ORDER BY profiles DESC, profile.analyzer_version
                    """
                )
            )
            .mappings()
            .all()
        )
    total_tracks = int(row["total_tracks"])
    current_profiles = int(row["current_profiles"])
    snapshot = {
        "profile_version": PROFILE_SCHEMA_VERSION,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "total_tracks": total_tracks,
        "current_profiles": current_profiles,
        "stale_profiles": int(row["stale_profiles"]),
        "outdated_profiles": int(row["outdated_profiles"]),
        "source_changed_profiles": int(row["source_changed_profiles"]),
        "missing_profiles": max(total_tracks - current_profiles, 0),
        "coverage_percent": (
            round(current_profiles / total_tracks * 100, 1) if total_tracks else 0.0
        ),
        "quality": {
            "full": int(row["full_profiles"]),
            "partial": int(row["partial_profiles"]),
            "legacy": int(row["legacy_profiles"]),
            "unavailable": int(row["unavailable_profiles"]),
        },
        "current_quality": {
            "full": int(row["current_full_profiles"]),
            "partial": int(row["current_partial_profiles"]),
            "legacy": int(row["current_legacy_profiles"]),
        },
        "processing": {
            "pending": int(row["pending"]),
            "active": int(row["active"]),
            "failed": int(row["failed"]),
            "exhausted": int(row["exhausted"]),
            "completed": int(row["completed"]),
        },
        "versions": [
            {
                "analyzer_version": version["analyzer_version"],
                "profiles": int(version["profiles"]),
                "current": version["analyzer_version"] == SMART_MIX_ANALYZER_VERSION,
            }
            for version in version_rows
        ],
    }
    set_ops_runtime_state(COVERAGE_STATE_KEY, snapshot)
    return snapshot


def refresh_live_smart_mix_coverage() -> bool:
    fresh = get_ops_runtime_state(
        COVERAGE_STATE_KEY, max_age_seconds=LIVE_COVERAGE_MAX_AGE_SECONDS
    )
    if fresh is not None and count_smart_mix_in_flight() > 0:
        return False
    campaign = get_smart_mix_campaign() or {}
    refresh_smart_mix_coverage(
        max_attempts=int(campaign.get("max_attempts") or DEFAULT_MAX_ATTEMPTS)
    )
    return True


def get_smart_mix_campaign() -> dict[str, Any] | None:
    return get_ops_runtime_state(CAMPAIGN_STATE_KEY)


def start_smart_mix_campaign(
    *,
    batch_size: int,
    max_attempts: int,
    night_window: dict[str, str] | None = None,
    night_concurrency: int | None = None,
    day_concurrency: int | None = None,
) -> dict[str, Any]:
    """Start, resume or reconfigure the campaign.

    The night window settings describe the machine rather than one pass, so an
    omitted setting keeps the value stored in the previous campaign, even a
    finished one, and falls back to the default when there is none.
    """
    current = get_smart_mix_campaign()
    continues = bool(current) and (
        current.get("target") == SMART_MIX_ANALYZER_VERSION
        and current.get("status") in {"running", "paused"}
    )
    campaign = {
        **(current if continues and current else {}),
        "target": SMART_MIX_ANALYZER_VERSION,
        "status": "running",
        "batch_size": max(1, min(int(batch_size), MAX_BACKFILL_BATCH_SIZE)),
        "max_attempts": max(1, min(int(max_attempts), 10)),
        **merge_backfill_window_settings(
            current,
            night_window=night_window,
            night_concurrency=night_concurrency,
            day_concurrency=day_concurrency,
        ),
    }
    if not continues:
        campaign.update({"batches": 0, "claimed": 0})
        campaign.setdefault("sequence", int((current or {}).get("sequence") or 0))
    save_smart_mix_campaign(campaign)
    return campaign


def set_smart_mix_campaign_status(
    status: str,
    *,
    allowed_from: set[str],
) -> dict[str, Any] | None:
    return _update_smart_mix_campaign(
        "payload_json || jsonb_build_object('status', CAST(:status AS text))",
        "payload_json->>'status' = ANY(:allowed_from)",
        {"status": status, "allowed_from": sorted(allowed_from)},
    )


def queue_next_smart_mix_batch(*, batches: int = 0, claimed: int = 0) -> str | None:
    from crate.db.repositories.tasks import create_task_dedup

    campaign = _update_smart_mix_campaign(
        """
        payload_json || jsonb_build_object(
            'batches', COALESCE((payload_json->>'batches')::int, 0) + CAST(:batches AS int),
            'claimed', COALESCE((payload_json->>'claimed')::int, 0) + CAST(:claimed AS int),
            'sequence', COALESCE((payload_json->>'sequence')::int, 0) + 1
        )
        """,
        "payload_json->>'status' = 'running'",
        {"batches": int(batches), "claimed": int(claimed)},
    )
    if campaign is None:
        return None
    return create_task_dedup(
        BACKFILL_TASK_TYPE,
        {"triggered_by": "smart-mix-campaign"},
        dedup_key=(
            f"smart-mix:backfill:{campaign.get('target')}:{campaign.get('sequence')}"
        ),
    )


def complete_smart_mix_campaign() -> bool:
    return (
        _update_smart_mix_campaign(
            "payload_json || jsonb_build_object('status', 'completed')",
            "payload_json->>'status' = 'running'",
            {},
        )
        is not None
    )


def _update_smart_mix_campaign(
    payload_sql: str, condition_sql: str, params: dict[str, Any]
) -> dict[str, Any] | None:
    with optional_scope(None) as session:
        payload = session.execute(
            text(
                f"""
                UPDATE ops_runtime_state
                SET payload_json = {payload_sql},
                    updated_at = NOW()
                WHERE key = :key
                  AND {condition_sql}
                RETURNING payload_json
                """
            ),
            {"key": CAMPAIGN_STATE_KEY, **params},
        ).scalar_one_or_none()
    if payload is None:
        return None
    return payload if isinstance(payload, dict) else json.loads(payload)


def save_smart_mix_campaign(campaign: dict[str, Any]) -> None:
    set_ops_runtime_state(
        CAMPAIGN_STATE_KEY,
        {key: value for key, value in campaign.items() if key != "updated_at"},
    )


__all__ = [
    "CAMPAIGN_STATE_KEY",
    "COVERAGE_STATE_KEY",
    "claim_smart_mix_backfill_batch",
    "complete_smart_mix_campaign",
    "count_smart_mix_in_flight",
    "get_smart_mix_campaign",
    "queue_next_smart_mix_batch",
    "refresh_smart_mix_coverage",
    "release_dead_smart_mix_claims",
    "release_smart_mix_claims",
    "smart_mix_profile_dedup_key",
    "save_smart_mix_campaign",
    "seconds_since_smart_mix_change",
    "set_smart_mix_campaign_status",
    "start_smart_mix_campaign",
]
