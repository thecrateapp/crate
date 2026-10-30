from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.recommendation_policy import (
    SIGNIFICANT_PLAY_RATIO,
    SIGNIFICANT_PLAY_SECONDS,
    canonical_key,
)

_HISTORY_SQL = """
    WITH significant_events AS MATERIALIZED (
        SELECT track_id, track_entity_uid, global_track_uid,
               artist, title, ended_at, was_completed
        FROM user_play_events
        WHERE user_id = :user_id
          AND ended_at >= :since
          AND ended_at <= :now
          AND (
              was_completed
              OR (
                  played_seconds < 'Infinity'::float8
                  AND played_seconds >= LEAST(
                      :significant_seconds,
                      CASE
                          WHEN track_duration_seconds > 0
                           AND track_duration_seconds < 'Infinity'::float8
                          THEN :significant_ratio * track_duration_seconds
                          ELSE :significant_seconds
                      END
                  )
              )
          )
    ), global_refs AS MATERIALIZED (
        SELECT global_track_uid
        FROM significant_events WHERE global_track_uid IS NOT NULL
        UNION
        SELECT UNNEST(CAST(:global_uids AS uuid[]))
    ), catalog_globals AS MATERIALIZED (
        SELECT global_track_uid, local_track_id, local_track_entity_uid,
               canonical_title, artist_name
        FROM global_catalog_tracks
        WHERE global_track_uid = ANY(ARRAY(SELECT global_track_uid FROM global_refs))
    ), requested_globals AS MATERIALIZED (
        SELECT * FROM catalog_globals
        WHERE global_track_uid = ANY(CAST(:global_uids AS uuid[]))
    ), track_id_refs AS MATERIALIZED (
        SELECT track_id FROM significant_events WHERE track_id IS NOT NULL
        UNION
        SELECT UNNEST(CAST(:track_ids AS bigint[]))
        UNION
        SELECT local_track_id FROM catalog_globals WHERE local_track_id IS NOT NULL
    ), track_entity_refs AS MATERIALIZED (
        SELECT track_entity_uid FROM significant_events WHERE track_entity_uid IS NOT NULL
        UNION
        SELECT UNNEST(CAST(:entity_uids AS uuid[]))
        UNION
        SELECT local_track_entity_uid FROM catalog_globals
        WHERE local_track_entity_uid IS NOT NULL
    ), catalog_by_id AS MATERIALIZED (
        SELECT id, artist, title
        FROM library_tracks
        WHERE id = ANY(ARRAY(SELECT track_id FROM track_id_refs))
    ), catalog_by_entity AS MATERIALIZED (
        SELECT entity_uid, artist, title
        FROM library_tracks
        WHERE entity_uid = ANY(ARRAY(SELECT track_entity_uid FROM track_entity_refs))
    ), candidate_tracks AS MATERIALIZED (
        SELECT artist, title FROM catalog_by_id
        WHERE id = ANY(CAST(:track_ids AS bigint[]))
        UNION
        SELECT artist, title FROM catalog_by_entity
        WHERE entity_uid = ANY(CAST(:entity_uids AS uuid[]))
        UNION
        SELECT lt.artist, lt.title
        FROM requested_globals gct
        JOIN catalog_by_id lt ON lt.id = gct.local_track_id
        UNION
        SELECT lt.artist, lt.title
        FROM requested_globals gct
        JOIN catalog_by_entity lt ON lt.entity_uid = gct.local_track_entity_uid
        UNION
        SELECT gct.artist_name, gct.canonical_title
        FROM requested_globals gct
    )
    SELECT 'candidate' AS row_kind, artist, title,
           NULL::timestamptz AS ended_at, FALSE AS was_completed
    FROM candidate_tracks
    UNION ALL
    SELECT 'event' AS row_kind,
           COALESCE(NULLIF(by_id.artist, ''), NULLIF(by_entity.artist, ''),
                    NULLIF(global_by_entity.artist, ''), NULLIF(global_by_id.artist, ''),
                    NULLIF(gct.artist_name, ''), e.artist) AS artist,
           COALESCE(NULLIF(by_id.title, ''), NULLIF(by_entity.title, ''),
                    NULLIF(global_by_entity.title, ''), NULLIF(global_by_id.title, ''),
                    NULLIF(gct.canonical_title, ''), e.title) AS title,
           e.ended_at, e.was_completed
    FROM significant_events e
    LEFT JOIN catalog_by_id by_id ON by_id.id = e.track_id
    LEFT JOIN catalog_by_entity by_entity ON by_entity.entity_uid = e.track_entity_uid
    LEFT JOIN catalog_globals gct ON gct.global_track_uid = e.global_track_uid
    LEFT JOIN catalog_by_entity global_by_entity
      ON global_by_entity.entity_uid = gct.local_track_entity_uid
    LEFT JOIN catalog_by_id global_by_id ON global_by_id.id = gct.local_track_id
"""


def _uuid(value: object) -> str | None:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _positive_track_id(value: object) -> int | None:
    if not str(value).isdecimal():
        return None
    try:
        track_id = int(str(value))
    except (ValueError, TypeError, OverflowError):
        return None
    return track_id if 0 < track_id <= 2**63 - 1 else None


def _candidate_ids(
    candidate_refs: list[dict | str],
) -> tuple[list[int], list[str], list[str]]:
    track_ids: set[int] = set()
    entity_uids: set[str] = set()
    global_uids: set[str] = set()
    for ref in candidate_refs:
        if isinstance(ref, str):
            if track_id := _positive_track_id(ref):
                track_ids.add(track_id)
            elif uid := _uuid(ref):
                entity_uids.add(uid)
                global_uids.add(uid)
            continue
        if track_id := _positive_track_id(ref.get("track_id") or ref.get("id")):
            track_ids.add(track_id)
        if uid := _uuid(ref.get("entity_uid") or ref.get("track_entity_uid")):
            entity_uids.add(uid)
        if uid := _uuid(ref.get("global_track_uid")):
            global_uids.add(uid)
    return sorted(track_ids), sorted(entity_uids), sorted(global_uids)


def history_for_candidates(
    user_id: int,
    candidate_refs: list[dict | str] | None,
    since: datetime,
    *,
    now: datetime | None = None,
    session: Session | None = None,
) -> dict[tuple[str, str], dict]:
    """Read significant event history, independent of listening projections.

    Catalog metadata resolves once per distinct ID/UUID in one batch. Event work
    is bounded by the user's significant events in [since, now]:
    O(candidates + significant window events).
    Matching uses the shared Python song identity so Unicode normalization and
    version families stay consistent. Pass None to preload radio's seven-day
    window before candidate retrieval, returning every significant song key in
    one query. An empty list returns immediately without accessing the database.
    """
    if candidate_refs is not None and not candidate_refs:
        return {}
    now = now or datetime.now(timezone.utc)
    refs = candidate_refs or []
    track_ids, entity_uids, global_uids = _candidate_ids(refs)
    candidate_keys = {
        key
        for ref in refs
        if isinstance(ref, dict) and (key := canonical_key(ref)) is not None
    }
    if candidate_refs is not None and not (
        track_ids or entity_uids or global_uids or candidate_keys
    ):
        return {}

    def _impl(current: Session) -> dict[tuple[str, str], dict]:
        rows = (
            current.execute(
                text(_HISTORY_SQL),
                {
                    "user_id": user_id,
                    "track_ids": track_ids,
                    "entity_uids": entity_uids,
                    "global_uids": global_uids,
                    "since": since,
                    "now": now,
                    "significant_seconds": SIGNIFICANT_PLAY_SECONDS,
                    "significant_ratio": SIGNIFICANT_PLAY_RATIO,
                },
            )
            .mappings()
            .all()
        )
        keys = candidate_keys | {
            key
            for row in rows
            if row["row_kind"] == "candidate"
            and (key := canonical_key(dict(row))) is not None
        }
        history: dict[tuple[str, str], dict] = {}
        for row in rows:
            if row["row_kind"] != "event":
                continue
            key = canonical_key(dict(row))
            if key is None or (candidate_refs is not None and key not in keys):
                continue
            ended_at = row["ended_at"].astimezone(timezone.utc)
            entry = history.setdefault(
                key,
                {"last_significant_play_at": ended_at, "frequency": 0, "completed": 0},
            )
            entry["last_significant_play_at"] = max(
                entry["last_significant_play_at"], ended_at
            )
            entry["frequency"] += 1
            entry["completed"] += int(row["was_completed"])
        return history

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["history_for_candidates"]
