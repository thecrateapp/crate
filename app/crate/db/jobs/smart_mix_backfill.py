"""Bounded, priority-aware Smart Mix profile backfill claims."""

from __future__ import annotations

import os
import socket
import uuid
from typing import Any, Sequence

from sqlalchemy import text

from crate.db.ops_runtime import get_ops_runtime_state, set_ops_runtime_state
from crate.db.tx import optional_scope, read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


SMART_MIX_PIPELINE = "smart_mix"
SMART_MIX_ANALYZER_VERSION = ANALYZER_VERSION
MAX_BACKFILL_BATCH_SIZE = 100
DEFAULT_MAX_ATTEMPTS = 3
BACKFILL_TASK_TYPE = "backfill_smart_mix_profiles"
CAMPAIGN_STATE_KEY = "smart_mix:backfill_campaign"
COVERAGE_STATE_KEY = "smart_mix:coverage"


def claim_smart_mix_backfill_batch(
    *,
    limit: int,
    offline_track_ids: Sequence[int] = (),
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    claimed_by: str | None = None,
    session=None,
) -> list[dict[str, Any]]:
    batch_size = max(1, min(int(limit), MAX_BACKFILL_BATCH_SIZE))
    retry_limit = max(1, min(int(max_attempts), 10))
    offline_ids = sorted({int(track_id) for track_id in offline_track_ids})
    worker = claimed_by or (
        f"{os.environ.get('CRATE_RUNTIME', 'runtime')}:{socket.gethostname()}"
    )
    with optional_scope(session) as active_session:
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
                      )
                      AND (
                          processing.track_id IS NULL
                          OR (
                              (
                                  processing.state <> 'analyzing'
                                  OR processing.claimed_at
                                      < NOW() - INTERVAL '2 hours'
                              )
                              AND (
                                  processing.target_generation
                                      IS DISTINCT FROM :analyzer_version
                                  OR processing.attempts < :max_attempts
                              )
                          )
                      )
                    ORDER BY ranked.priority, lt.id
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


def count_smart_mix_in_flight(*, session=None) -> int:
    with optional_scope(session) as active_session:
        return int(
            active_session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM track_processing_state
                    WHERE pipeline = :pipeline
                      AND state = 'analyzing'
                      AND target_generation = :analyzer_version
                      AND claimed_at >= NOW() - INTERVAL '2 hours'
                    """
                ),
                {
                    "pipeline": SMART_MIX_PIPELINE,
                    "analyzer_version": SMART_MIX_ANALYZER_VERSION,
                },
            ).scalar_one()
        )


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
                        COUNT(*) FILTER (WHERE quality = 'full')::int AS full_profiles,
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
    total_tracks = int(row["total_tracks"])
    current_profiles = int(row["current_profiles"])
    snapshot = {
        "profile_version": PROFILE_SCHEMA_VERSION,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "total_tracks": total_tracks,
        "current_profiles": current_profiles,
        "stale_profiles": int(row["stale_profiles"]),
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
        "processing": {
            "pending": int(row["pending"]),
            "active": int(row["active"]),
            "failed": int(row["failed"]),
            "exhausted": int(row["exhausted"]),
            "completed": int(row["completed"]),
        },
    }
    set_ops_runtime_state(COVERAGE_STATE_KEY, snapshot)
    return snapshot


def get_smart_mix_campaign() -> dict[str, Any] | None:
    return get_ops_runtime_state(CAMPAIGN_STATE_KEY)


def start_smart_mix_campaign(*, batch_size: int, max_attempts: int) -> dict[str, Any]:
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
    campaign = get_smart_mix_campaign()
    if not campaign or campaign.get("status") not in allowed_from:
        return None
    campaign = {**campaign, "status": status}
    save_smart_mix_campaign(campaign)
    return campaign


def queue_next_smart_mix_batch(campaign: dict[str, Any]) -> str | None:
    from crate.db.repositories.tasks import create_task_dedup

    sequence = int(campaign.get("sequence") or 0) + 1
    save_smart_mix_campaign({**campaign, "sequence": sequence})
    return create_task_dedup(
        BACKFILL_TASK_TYPE,
        {"triggered_by": "smart-mix-campaign"},
        dedup_key=f"smart-mix:backfill:{campaign.get('target')}:{sequence}",
    )


def save_smart_mix_campaign(campaign: dict[str, Any]) -> None:
    set_ops_runtime_state(
        CAMPAIGN_STATE_KEY,
        {key: value for key, value in campaign.items() if key != "updated_at"},
    )


__all__ = [
    "CAMPAIGN_STATE_KEY",
    "COVERAGE_STATE_KEY",
    "claim_smart_mix_backfill_batch",
    "count_smart_mix_in_flight",
    "get_smart_mix_campaign",
    "queue_next_smart_mix_batch",
    "refresh_smart_mix_coverage",
    "release_smart_mix_claims",
    "save_smart_mix_campaign",
    "set_smart_mix_campaign_status",
    "start_smart_mix_campaign",
]
