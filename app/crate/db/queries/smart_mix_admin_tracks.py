"""Paginated Smart Mix profile state per track for the admin Analysis view."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.smart_mix.versions import (
    ANALYZER_VERSION,
    MODEL_BEATS_MAX_SECONDS,
    PROFILE_SCHEMA_VERSION,
)


SMART_MIX_ANALYZER_VERSION = ANALYZER_VERSION
SMART_MIX_PROFILE_VERSION = PROFILE_SCHEMA_VERSION
SMART_MIX_PIPELINE = "smart_mix"
SMART_MIX_TRACK_STATUSES = (
    "all",
    "current",
    "outdated",
    "source_changed",
    "unavailable",
    "missing",
    "failed",
)
# At the target but on the analyzer's own beats, within the length Beat This! runs
# on: where the model runs, the backfill still owes the track its beats, so it is
# outdated (``smart_mix_awaits_model_beats``).
_AWAITS_MODEL_BEATS = """
    (
        CAST(:awaits_model_beats AS boolean)
        AND profile.beat_tracker IS NULL
        AND COALESCE(track.duration, 0) <= :model_beats_max_seconds
    )
"""
_STATUS_PREDICATES = {
    "all": "TRUE",
    "current": f"""
        profile.track_id IS NOT NULL
        AND profile.quality <> 'unavailable'
        AND profile.profile_version = :profile_version
        AND profile.analyzer_version = :analyzer_version
        AND profile.source_stale_at IS NULL
        AND NOT {_AWAITS_MODEL_BEATS}
    """,
    "outdated": f"""
        profile.track_id IS NOT NULL
        AND profile.quality <> 'unavailable'
        AND profile.source_stale_at IS NULL
        AND (
            profile.profile_version <> :profile_version
            OR profile.analyzer_version <> :analyzer_version
            OR {_AWAITS_MODEL_BEATS}
        )
    """,
    "source_changed": """
        profile.track_id IS NOT NULL
        AND profile.quality <> 'unavailable'
        AND profile.source_stale_at IS NOT NULL
    """,
    "unavailable": "profile.quality = 'unavailable'",
    "missing": "profile.track_id IS NULL",
    "failed": "processing.state = 'failed'",
}


def list_smart_mix_tracks(
    *,
    status: str = "all",
    analyzer_version: str | None = None,
    search: str | None = None,
    before_track_id: int | None = None,
    limit: int = 50,
    awaits_model_beats: bool = True,
    session: Session | None = None,
) -> list[dict]:
    if status not in _STATUS_PREDICATES:
        raise ValueError(f"Unknown Smart Mix track status: {status}")
    params: dict = {
        "profile_version": SMART_MIX_PROFILE_VERSION,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "pipeline": SMART_MIX_PIPELINE,
        "limit": int(limit),
        "model_beats_max_seconds": MODEL_BEATS_MAX_SECONDS,
        "awaits_model_beats": bool(awaits_model_beats),
    }
    predicates = [_STATUS_PREDICATES[status]]
    if before_track_id is not None:
        predicates.append("track.id < :before_track_id")
        params["before_track_id"] = int(before_track_id)
    if analyzer_version:
        predicates.append("profile.analyzer_version = :version_filter")
        params["version_filter"] = analyzer_version
    if search:
        predicates.append(
            """(
                track.title ILIKE :pattern ESCAPE '\\'
                OR track.artist ILIKE :pattern ESCAPE '\\'
                OR track.album ILIKE :pattern ESCAPE '\\'
            )"""
        )
        params["pattern"] = f"%{_escape_like(search)}%"
    where = " AND ".join(f"({predicate.strip()})" for predicate in predicates)

    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    f"""
                    SELECT
                        track.id AS track_id,
                        track.entity_uid::text AS track_entity_uid,
                        track.title,
                        track.artist,
                        track.album,
                        profile.analyzer_version,
                        profile.profile_version,
                        profile.quality,
                        profile.bpm,
                        profile.intro_bpm,
                        profile.outro_bpm,
                        profile.analyzed_at,
                        profile.source_stale_at,
                        profile.beat_tracker,
                        track.duration,
                        processing.state AS processing_state,
                        processing.attempts AS processing_attempts,
                        processing.last_error AS processing_error
                    FROM library_tracks track
                    LEFT JOIN library_albums album ON album.id = track.album_id
                    LEFT JOIN track_mix_profiles profile ON profile.track_id = track.id
                    LEFT JOIN track_processing_state processing
                        ON processing.track_id = track.id
                       AND processing.pipeline = :pipeline
                    WHERE album.quarantined_at IS NULL
                      AND {where}
                    ORDER BY track.id DESC
                    LIMIT :limit
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )
        return [
            _track_status(dict(row), awaits_model_beats=awaits_model_beats)
            for row in rows
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _track_status(row: dict, *, awaits_model_beats: bool) -> dict:
    if row["analyzer_version"] is None:
        status = "missing"
    elif row["quality"] == "unavailable":
        status = "unavailable"
    elif row["source_stale_at"] is not None:
        status = "source_changed"
    elif (
        row["analyzer_version"] != SMART_MIX_ANALYZER_VERSION
        or row["profile_version"] != SMART_MIX_PROFILE_VERSION
        or (
            awaits_model_beats
            and row.get("beat_tracker") is None
            and (row.get("duration") or 0) <= MODEL_BEATS_MAX_SECONDS
        )
    ):
        status = "outdated"
    else:
        status = "current"
    row = {
        key: value
        for key, value in row.items()
        if key not in ("beat_tracker", "duration")
    }
    return {**row, "status": status}


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


__all__ = ["SMART_MIX_TRACK_STATUSES", "list_smart_mix_tracks"]
