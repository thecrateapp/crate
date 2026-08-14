"""Bounded, priority-aware Smart Mix profile backfill claims."""

from __future__ import annotations

import os
import socket
from typing import Any, Sequence

from sqlalchemy import text

from crate.db.tx import optional_scope


SMART_MIX_PIPELINE = "smart_mix"
SMART_MIX_ANALYZER_VERSION = "smart-mix-v1"
MAX_BACKFILL_BATCH_SIZE = 100
DEFAULT_MAX_ATTEMPTS = 3


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
                      )
                      AND (
                          processing.track_id IS NULL
                          OR (
                              processing.attempts < :max_attempts
                              AND (
                                  processing.state IN ('pending', 'failed')
                                  OR (
                                      processing.state = 'analyzing'
                                      AND processing.claimed_at
                                          < NOW() - INTERVAL '2 hours'
                                  )
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
        for row in rows:
            active_session.execute(
                text(
                    """
                    INSERT INTO track_processing_state (
                        track_id, pipeline, state, claimed_by, claimed_at,
                        attempts, priority, last_error, updated_at
                    )
                    VALUES (
                        :track_id, :pipeline, 'analyzing', :claimed_by, NOW(),
                        1, :priority, NULL, NOW()
                    )
                    ON CONFLICT (track_id, pipeline) DO UPDATE SET
                        state = 'analyzing',
                        claimed_by = EXCLUDED.claimed_by,
                        claimed_at = EXCLUDED.claimed_at,
                        attempts = track_processing_state.attempts + 1,
                        priority = EXCLUDED.priority,
                        last_error = NULL,
                        completed_at = NULL,
                        updated_at = NOW()
                    """
                ),
                {
                    "track_id": int(row["id"]),
                    "pipeline": SMART_MIX_PIPELINE,
                    "claimed_by": worker,
                    "priority": int(row["priority"]),
                },
            )
        return [dict(row) for row in rows]


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


__all__ = [
    "claim_smart_mix_backfill_batch",
    "release_smart_mix_claims",
]
