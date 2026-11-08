"""Bounded, priority-aware Smart Mix profile backfill claims."""

from __future__ import annotations

import json
import os
import socket
import uuid
from typing import Any, Sequence

from sqlalchemy import text

from crate.db.repositories.smart_mix_refinements import refinement_latency_p50_ms
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
# Campaigns saved before the target recorded a profile schema targeted schema 1.
LEGACY_CAMPAIGN_PROFILE_VERSION = 1


def smart_mix_target_generation() -> str:
    """The claim generation of the current target: analyzer version and schema.

    Schema 1 keeps the bare analyzer version, the generation every existing claim
    carries. A schema bump on the same analyzer is a new generation, so claims of
    the previous schema neither count as in flight nor use up the new retry budget.
    """
    if PROFILE_SCHEMA_VERSION == 1:
        return SMART_MIX_ANALYZER_VERSION
    return f"{SMART_MIX_ANALYZER_VERSION}+schema{PROFILE_SCHEMA_VERSION}"


def campaign_targets_current(campaign: dict[str, Any] | None) -> bool:
    """Whether a saved campaign targets this build's analyzer and profile schema."""
    return (
        campaign is not None
        and campaign.get("target") == SMART_MIX_ANALYZER_VERSION
        and campaign.get("profile_version", LEGACY_CAMPAIGN_PROFILE_VERSION)
        == PROFILE_SCHEMA_VERSION
    )


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


# Ranking the whole library takes seconds on ~140K tracks, while a pass under the
# night window claims only its free slots, often one to four tracks. So the claim
# stores the ranking of the claimable tracks in smart_mix_backfill_candidates;
# later passes take its head, check each row is still claimable and remove what
# they claim. The ranking is rebuilt when its inputs change (target, retry budget,
# Python promotion), when it is older than RANKING_MAX_AGE_SECONDS and when it can
# no longer fill a pass. Until then, a track that becomes claimable (a failed
# attempt to retry, an import) or changes tier waits for the next ranking. The
# play queue and offline IDs change from one pass to the next, so every pass ranks
# them, first, among the tracks in the stored ranking.
RANKING_STATE_KEY = "smart_mix:backfill_ranking"
RANKING_MAX_AGE_SECONDS = 600
# Play queue and offline tracks checked per statement; a pass claims at most
# MAX_BACKFILL_BATCH_SIZE tracks.
_LIVE_CHUNK_SIZE = 200

_CLAIMABLE_JOINS_SQL = """
    LEFT JOIN library_albums la ON la.id = lt.album_id
    LEFT JOIN track_mix_profiles profile ON profile.track_id = lt.id
    LEFT JOIN track_processing_state processing
        ON processing.track_id = lt.id
       AND processing.pipeline = :pipeline
"""
# Claimable: an album that is not quarantined, a profile that is not at the target
# analyzer and schema, current and usable (or a Python one to promote), and no
# claim in flight or retry budget spent for this generation.
_CLAIMABLE_SQL = """
    la.quarantined_at IS NULL
    AND (
        profile.track_id IS NULL
        OR profile.profile_version <> :profile_version
        OR profile.analyzer_version <> :analyzer_version
        OR profile.quality = 'unavailable'
        OR profile.source_stale_at IS NOT NULL
        OR (:promote_python_profiles AND profile.analyzer = :python_analyzer)
    )
    AND (
        processing.track_id IS NULL
        OR (
            processing.state <> 'analyzing'
            AND (
                processing.target_generation IS DISTINCT FROM :target_generation
                OR processing.attempts < :max_attempts
            )
        )
    )
"""
# A claimable profile that is otherwise current is a Python one to promote; those
# go after every other track.
_PROMOTION_SQL = """
    COALESCE(
        profile.analyzer = :python_analyzer
        AND profile.profile_version = :profile_version
        AND profile.analyzer_version = :analyzer_version
        AND profile.quality <> 'unavailable'
        AND profile.source_stale_at IS NULL,
        FALSE
    )
"""
# Priority 1: the play queue (current track and queued items of every device).
# Listen stores queue items with track_id and track_entity_uid
# (sanitize_queue_snapshot); id, trackId, entityUid and trackEntityUid are older
# names. Only canonical text is cast: the only values that matched when the
# track id and entity UID were compared as text.
_PLAY_QUEUE_SQL = """
    WITH queue_item AS (
        SELECT
            CASE WHEN raw.item_id ~ '^(0|[1-9][0-9]{0,17})$'
                THEN CAST(raw.item_id AS bigint)
            END AS track_id,
            CASE WHEN raw.item_uid
                    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN CAST(raw.item_uid AS uuid)
            END AS track_entity_uid
        FROM (
            SELECT
                NULLIF(
                    COALESCE(item->>'track_id', item->>'id', item->>'trackId'), ''
                ) AS item_id,
                NULLIF(
                    COALESCE(
                        item->>'track_entity_uid',
                        item->>'entityUid',
                        item->>'trackEntityUid'
                    ),
                    ''
                ) AS item_uid
            FROM user_playback_device_states playback
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(playback.queue_json) = 'array'
                    THEN playback.queue_json
                    ELSE '[]'::jsonb
                END
            ) item
        ) raw
    )
    SELECT playback.track_id
    FROM user_playback_device_states playback
    WHERE playback.track_id IS NOT NULL
    UNION
    SELECT track.id
    FROM user_playback_device_states playback
    JOIN library_tracks track ON track.entity_uid = playback.track_entity_uid
    UNION
    SELECT track.id
    FROM queue_item
    JOIN library_tracks track ON track.id = queue_item.track_id
    UNION
    SELECT track.id
    FROM queue_item
    JOIN library_tracks track ON track.entity_uid = queue_item.track_entity_uid
"""
# The play queue (1) and offline IDs (2) in claim order.
_LIVE_ROWS_SQL = f"""
    FROM (
        SELECT queue.track_id, 1 AS priority FROM ({_PLAY_QUEUE_SQL}) queue
        UNION ALL
        SELECT offline.track_id, 2
        FROM unnest(CAST(:offline_track_ids AS integer[])) AS offline(track_id)
    ) live
"""
_LIVE_SQL = f"""
    SELECT live.track_id, MIN(live.priority) AS priority
    {_LIVE_ROWS_SQL}
    GROUP BY live.track_id
    ORDER BY priority, live.track_id
"""
# With the stored ranking, only tracks still in it: claimed and finished ones
# have left it, so a long queue that is mostly analyzed is not checked again.
_LIVE_RANKED_SQL = f"""
    SELECT live.track_id, MIN(live.priority) AS priority
    {_LIVE_ROWS_SQL}
    JOIN smart_mix_backfill_candidates candidate
        ON candidate.track_id = live.track_id
    GROUP BY live.track_id
    ORDER BY priority, live.track_id
"""
# Priorities 3 (favorites and collections) and 4 (listening history), computed
# as sets once per ranking instead of once per track.
_STORED_TIERS_SQL = """
    favorite AS (
        SELECT liked.track_id FROM user_liked_tracks liked
        UNION
        SELECT track.id
        FROM user_saved_albums saved
        JOIN library_tracks track ON track.album_id = saved.album_id
        UNION
        SELECT playlist_track.track_id FROM playlist_tracks playlist_track
        UNION
        SELECT track.id
        FROM playlist_tracks playlist_track
        JOIN library_tracks track
            ON track.entity_uid = playlist_track.track_entity_uid
        UNION
        SELECT track.id
        FROM user_follows followed
        JOIN library_tracks track ON track.artist = followed.artist_name
    ),
    played AS (
        SELECT played.track_id FROM user_play_events played
        UNION
        SELECT track.id
        FROM user_play_events played
        JOIN library_tracks track ON track.entity_uid = played.track_entity_uid
        UNION
        SELECT history.track_id FROM play_history history
        UNION
        SELECT track.id
        FROM play_history history
        JOIN library_tracks track ON track.entity_uid = history.track_entity_uid
    )
"""
_STORED_PRIORITY_SQL = """
    CASE
        WHEN favorite.track_id IS NOT NULL THEN 3
        WHEN played.track_id IS NOT NULL THEN 4
        ELSE 5
    END
"""
_RANKED_FROM_SQL = f"""
    FROM library_tracks lt
    {_CLAIMABLE_JOINS_SQL}
    LEFT JOIN favorite ON favorite.track_id = lt.id
    LEFT JOIN played ON played.track_id = lt.id
"""
_RANK_SQL = f"""
    INSERT INTO smart_mix_backfill_candidates (track_id, promotion, priority)
    WITH {_STORED_TIERS_SQL}
    SELECT lt.id, {_PROMOTION_SQL}, {_STORED_PRIORITY_SQL}
    {_RANKED_FROM_SQL}
    WHERE {_CLAIMABLE_SQL}
"""
_CLAIMED_COLUMNS_SQL = """
    lt.id,
    lt.entity_uid::text AS entity_uid,
    lt.path,
    lt.artist,
    lt.album,
    lt.title
"""
_CLAIM_LIVE_SQL = f"""
    SELECT {_CLAIMED_COLUMNS_SQL}, live.priority
    FROM unnest(
        CAST(:live_track_ids AS integer[]), CAST(:live_priorities AS integer[])
    ) AS live(track_id, priority)
    JOIN library_tracks lt ON lt.id = live.track_id
    {_CLAIMABLE_JOINS_SQL}
    WHERE {_PROMOTION_SQL} = :promotion
      AND {_CLAIMABLE_SQL}
    ORDER BY live.priority, lt.id
    FOR UPDATE OF lt SKIP LOCKED
    LIMIT :limit
"""
# Walks the ranking index from its head and stops at the limit.
_CLAIM_STORED_SQL = f"""
    SELECT {_CLAIMED_COLUMNS_SQL}, candidate.priority
    FROM smart_mix_backfill_candidates candidate
    JOIN library_tracks lt ON lt.id = candidate.track_id
    {_CLAIMABLE_JOINS_SQL}
    WHERE candidate.promotion = :promotion
      AND {_CLAIMABLE_SQL}
    ORDER BY candidate.priority, candidate.track_id
    FOR UPDATE OF lt SKIP LOCKED
    LIMIT :limit
"""
_CLAIM_RANKED_INLINE_SQL = f"""
    WITH {_STORED_TIERS_SQL}
    SELECT {_CLAIMED_COLUMNS_SQL}, {_STORED_PRIORITY_SQL} AS priority
    {_RANKED_FROM_SQL}
    WHERE {_PROMOTION_SQL} = :promotion
      AND {_CLAIMABLE_SQL}
    ORDER BY {_STORED_PRIORITY_SQL}, lt.id
    FOR UPDATE OF lt SKIP LOCKED
    LIMIT :limit
"""


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
    """Claim up to ``limit`` tracks for the backfill, in priority order.

    With ``max_in_flight`` the claim counts what is in flight and takes only the
    free slots, under a transaction lock, so concurrent coordinators cannot
    exceed the limit between the count and the claim.

    The order is: no Python promotion before a promotion, then priority (1 play
    queue, 2 supplied offline IDs, 3 favorites and collections, 4 listening
    history, 5 the rest), then track id. Priorities 3 to 5 come from the stored
    ranking, which only the holder of the claim lock reads and rebuilds; a claim
    without ``max_in_flight`` that finds the lock taken ranks the library inline
    instead, as every claim did before the ranking was stored.
    """
    batch_size = max(1, min(int(limit), MAX_BACKFILL_BATCH_SIZE))
    retry_limit = max(1, min(int(max_attempts), 10))
    offline_ids = sorted({int(track_id) for track_id in offline_track_ids})
    worker = claimed_by or (
        f"{os.environ.get('CRATE_RUNTIME', 'runtime')}:{socket.gethostname()}"
    )
    params = {
        "pipeline": SMART_MIX_PIPELINE,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "profile_version": PROFILE_SCHEMA_VERSION,
        "target_generation": smart_mix_target_generation(),
        "max_attempts": retry_limit,
        "promote_python_profiles": bool(promote_python_profiles),
        "python_analyzer": PYTHON_ANALYZER,
    }
    with optional_scope(session) as active_session:
        lock_sql = (
            "SELECT pg_advisory_xact_lock(hashtext(:key))"
            if max_in_flight is not None
            else "SELECT pg_try_advisory_xact_lock(hashtext(:key))"
        )
        locked = active_session.execute(
            text(lock_sql), {"key": _CLAIM_LOCK_KEY}
        ).scalar_one()
        stored = max_in_flight is not None or bool(locked)
        release_dead_smart_mix_claims(session=active_session)
        if max_in_flight is not None:
            free = int(max_in_flight) - count_smart_mix_in_flight(
                session=active_session
            )
            if free <= 0:
                return []
            batch_size = min(batch_size, free)
        ranked = False
        if stored and not _stored_ranking_is_current(active_session, params):
            _rank_backfill_candidates(active_session, params)
            ranked = True
        claimed = _claim_in_order(
            active_session,
            params,
            offline_ids=offline_ids,
            stored=stored,
            limit=batch_size,
            worker=worker,
        )
        if stored and not ranked and len(claimed) < batch_size:
            # The ranking ran out or its head stopped being claimable: rank
            # again before claiming fewer than asked, so a pass that claims
            # nothing (which completes the campaign when nothing is in flight)
            # always comes from a fresh ranking.
            _rank_backfill_candidates(active_session, params)
            claimed += _claim_in_order(
                active_session,
                params,
                offline_ids=offline_ids,
                stored=True,
                limit=batch_size - len(claimed),
                worker=worker,
            )
        return claimed


def _stored_ranking_is_current(session, params: dict[str, Any]) -> bool:
    row = (
        session.execute(
            text(
                """
                SELECT
                    payload_json->'inputs' AS inputs,
                    updated_at >= NOW() - make_interval(secs => :max_age) AS fresh
                FROM ops_runtime_state
                WHERE key = :key
                """
            ),
            {"key": RANKING_STATE_KEY, "max_age": RANKING_MAX_AGE_SECONDS},
        )
        .mappings()
        .first()
    )
    return row is not None and bool(row["fresh"]) and row["inputs"] == params


def _rank_backfill_candidates(session, params: dict[str, Any]) -> int:
    """Store the claimable tracks with their promotion flag and priority 3-5."""
    session.execute(text("DELETE FROM smart_mix_backfill_candidates"))
    result = session.execute(text(_RANK_SQL), params)
    candidates = int(getattr(result, "rowcount", 0) or 0)
    session.execute(
        text(
            """
            INSERT INTO ops_runtime_state (key, payload_json, updated_at)
            VALUES (:key, CAST(:payload_json AS jsonb), NOW())
            ON CONFLICT (key) DO UPDATE SET
                payload_json = EXCLUDED.payload_json,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "key": RANKING_STATE_KEY,
            "payload_json": json.dumps({"inputs": params, "candidates": candidates}),
        },
    )
    return candidates


def _claim_in_order(
    session,
    params: dict[str, Any],
    *,
    offline_ids: Sequence[int],
    stored: bool,
    limit: int,
    worker: str,
) -> list[dict[str, Any]]:
    """Claim in the order promotion, priority, track id, one source at a time.

    Live rows (priorities 1-2) come before ranked rows (3-5) of the same
    promotion flag. Each step records its claims before the next one runs, so a
    track in both sources is claimed once.
    """
    live = {
        int(row.track_id): int(row.priority)
        for row in session.execute(
            text(_LIVE_RANKED_SQL if stored else _LIVE_SQL),
            {"offline_track_ids": list(offline_ids)},
        )
    }
    live_ids = list(live)
    ranked_sql = _CLAIM_STORED_SQL if stored else _CLAIM_RANKED_INLINE_SQL
    claimed: list[dict[str, Any]] = []

    def claim(sql: str, promotion: bool, **source: Any) -> None:
        rows = (
            session.execute(
                text(sql),
                {
                    **params,
                    **source,
                    "promotion": promotion,
                    "limit": limit - len(claimed),
                },
            )
            .mappings()
            .all()
        )
        claimed.extend(
            _record_claims(
                session,
                rows,
                worker=worker,
                target_generation=params["target_generation"],
                stored=stored,
            )
        )

    for promotion in (False, True):
        # Chunks in claim order keep each step's sort small and stop at the limit.
        for start in range(0, len(live_ids), _LIVE_CHUNK_SIZE):
            if len(claimed) >= limit:
                return claimed
            chunk = live_ids[start : start + _LIVE_CHUNK_SIZE]
            claim(
                _CLAIM_LIVE_SQL,
                promotion,
                live_track_ids=chunk,
                live_priorities=[live[track_id] for track_id in chunk],
            )
        if len(claimed) >= limit:
            return claimed
        claim(ranked_sql, promotion)
    return claimed


def _record_claims(
    session,
    rows: Sequence[Any],
    *,
    worker: str,
    target_generation: str,
    stored: bool,
) -> list[dict[str, Any]]:
    claimed = []
    for row in rows:
        claim_token = f"{worker}:{uuid.uuid4().hex}"
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id, pipeline, state, claimed_by, claimed_at,
                    attempts, priority, last_error, target_generation,
                    updated_at
                )
                VALUES (
                    :track_id, :pipeline, 'analyzing', :claimed_by, NOW(),
                    1, :priority, NULL, :target_generation, NOW()
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
                "target_generation": target_generation,
            },
        )
        claimed.append({**dict(row), "claim_token": claim_token})
    if stored and claimed:
        session.execute(
            text(
                """
                DELETE FROM smart_mix_backfill_candidates
                WHERE track_id = ANY(:track_ids)
                """
            ),
            {"track_ids": [int(row["id"]) for row in claimed]},
        )
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
                      AND claim.target_generation = :target_generation
                      AND {_LIVE_CLAIM_SQL.format(claim="claim")}
                    """
                ),
                {
                    "pipeline": SMART_MIX_PIPELINE,
                    "target_generation": smart_mix_target_generation(),
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
                            -- CASE: AND does not guarantee the order, and
                            -- jsonb_array_length fails on anything but an array.
                            CASE
                                WHEN jsonb_typeof(profile.phrases) = 'array'
                                THEN jsonb_array_length(profile.phrases) > 0
                                ELSE false
                            END AS has_phrases,
                            processing.state,
                            processing.attempts,
                            processing.target_generation = :target_generation
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
                        COUNT(*) FILTER (
                            WHERE is_current AND has_phrases
                        )::int AS structure_profiles,
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
                    "target_generation": smart_mix_target_generation(),
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
    structure_profiles = int(row["structure_profiles"])
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
        # Current profiles with at least one phrase (planner v3 plans on them),
        # over every track: smart_mix.structure in capabilities reads it.
        "structure_profiles": structure_profiles,
        "structure_percent": (
            round(structure_profiles / total_tracks * 100, 1) if total_tracks else 0.0
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
    # Capabilities announce it as smart_mix.ai_assisted.typical_latency_ms (SM3-D9).
    snapshot["refinement_latency_p50_ms"] = refinement_latency_p50_ms()
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
    # Only a running or paused campaign of this target continues with its counters;
    # anything else (another analyzer or schema, cancelled, completed) starts anew.
    continues = current is not None and (
        campaign_targets_current(current)
        and current.get("status") in {"running", "paused"}
    )
    campaign = {
        **(current if continues and current else {}),
        "target": SMART_MIX_ANALYZER_VERSION,
        "profile_version": PROFILE_SCHEMA_VERSION,
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
    "RANKING_MAX_AGE_SECONDS",
    "RANKING_STATE_KEY",
    "campaign_targets_current",
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
    "smart_mix_target_generation",
    "start_smart_mix_campaign",
]
