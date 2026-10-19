"""Paginated Smart Mix profile state per track for the admin Analysis view."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


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
_STATUS_PREDICATES = {
    "all": "TRUE",
    "current": """
        profile.track_id IS NOT NULL
        AND profile.quality <> 'unavailable'
        AND profile.profile_version = :profile_version
        AND profile.analyzer_version = :analyzer_version
        AND profile.source_stale_at IS NULL
    """,
    "outdated": """
        profile.track_id IS NOT NULL
        AND profile.quality <> 'unavailable'
        AND profile.source_stale_at IS NULL
        AND (
            profile.profile_version <> :profile_version
            OR profile.analyzer_version <> :analyzer_version
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
    session: Session | None = None,
) -> list[dict]:
    if status not in _STATUS_PREDICATES:
        raise ValueError(f"Unknown Smart Mix track status: {status}")
    params: dict = {
        "profile_version": SMART_MIX_PROFILE_VERSION,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "pipeline": SMART_MIX_PIPELINE,
        "limit": int(limit),
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
        return [_track_status(dict(row)) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _track_status(row: dict) -> dict:
    if row["analyzer_version"] is None:
        status = "missing"
    elif row["quality"] == "unavailable":
        status = "unavailable"
    elif row["source_stale_at"] is not None:
        status = "source_changed"
    elif (
        row["analyzer_version"] != SMART_MIX_ANALYZER_VERSION
        or row["profile_version"] != SMART_MIX_PROFILE_VERSION
    ):
        status = "outdated"
    else:
        status = "current"
    return {**row, "status": status}


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


__all__ = ["SMART_MIX_TRACK_STATUSES", "list_smart_mix_tracks"]
