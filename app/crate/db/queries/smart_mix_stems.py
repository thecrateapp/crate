"""Reads of the server's stem work for the admin (Smart Mix Stems, ST2.PR4).

- :func:`get_track_stem_overview` is what a track's Audio profile dialog shows in its
  Stems tab: every stored analysis (stale ones too), the stems layer of the one Smart Mix
  uses, the job, the stem file and the Smart Mix playlists that hold the track. Three
  queries in one read scope: the track's work, its current profile and its analyses.
- :func:`list_admin_smart_mix_playlists` is the Analysis page's panel: every user's
  Smart Mix playlists with their stem work, and an instance overview with the stem
  files' quota use and the stem settings. Two queries.

Both count a track ``ready`` when it has a server analysis of its current file, as
:func:`crate.db.repositories.smart_mix_playlists.smart_mix_playlist_status` does.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.repositories.smart_mix import get_track_mix_profile
from crate.db.repositories.smart_mix_playlists import (
    CURRENT_ANALYSIS_JOINS,
    PACE_CTE,
    track_state,
)
from crate.db.repositories.smart_mix_stems import (
    StoredStemAnalysis,
    get_stored_stem_analyses,
)
from crate.db.tx import read_scope
from crate.smart_mix.models import TrackMixProfile
from crate.smart_mix.stems import (
    DEFAULT_STEM_MAX_TRACKS_PER_PLAYLIST,
    STEM_MAX_TRACKS_PER_PLAYLIST_SETTING,
    STEM_MAX_TRACKS_PER_USER_SETTING,
    STEM_QUOTA_SETTING,
    STEM_UPLOADS_SETTING,
    StemJobState,
    stem_quota_gib,
    stem_track_limit,
)

# The latest failures each admin row carries.
_FAILURES_PER_PLAYLIST = 3


@dataclass(frozen=True, slots=True)
class TrackStemJob:
    state: StemJobState
    attempts: int
    last_error: str | None
    requested_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None


@dataclass(frozen=True, slots=True)
class TrackStemFile:
    bytes: int
    separator_model: str
    separator_version: str
    source_revision: str
    created_at: datetime
    last_used_at: datetime


@dataclass(frozen=True, slots=True)
class SmartMixPlaylistRef:
    """A Smart Mix playlist that holds a track; ``ready`` of ``total`` while on."""

    playlist_id: int
    name: str
    owner_id: int | None
    owner_username: str | None
    enabled: bool
    ready: int
    total: int


@dataclass(frozen=True, slots=True)
class TrackStemOverview:
    """A track's stems. ``source_revision`` is its current file's, or None while it has
    no current profile; ``profile`` is that profile with its beat grid and structure."""

    track_id: int
    entity_uid: str | None
    library_duration_ms: int | None
    source_revision: str | None
    profile_analyzed_at: datetime | None
    source_stale_at: datetime | None
    profile: TrackMixProfile | None
    analyses: tuple[StoredStemAnalysis, ...]
    job: TrackStemJob | None
    file: TrackStemFile | None
    playlists: tuple[SmartMixPlaylistRef, ...]
    seconds_per_track: float | None


@dataclass(frozen=True, slots=True)
class StemStateCounts:
    pending: int
    analyzing: int
    ready: int
    failed: int


@dataclass(frozen=True, slots=True)
class StemFailure:
    track_id: int
    title: str | None
    artist: str | None
    attempts: int
    last_error: str | None
    finished_at: datetime | None


@dataclass(frozen=True, slots=True)
class AdminSmartMixPlaylist:
    """A Smart Mix playlist of any user. Its counts are zero while it is off; its
    ``total`` and stem files count its local tracks either way."""

    playlist_id: int
    name: str
    owner_id: int | None
    owner_username: str | None
    enabled: bool
    enabled_at: datetime | None
    disabled_at: datetime | None
    last_used_at: datetime | None
    total: int
    counts: StemStateCounts
    failures: tuple[StemFailure, ...]
    file_bytes: int
    files: int


@dataclass(frozen=True, slots=True)
class StemSettings:
    max_tracks_per_playlist: int
    max_tracks_per_user: int | None
    quota_gib: int
    uploads_enabled: bool


@dataclass(frozen=True, slots=True)
class SmartMixStemOverview:
    """The distinct tracks of the Smart Mix playlists that are on, and the stem files.

    ``evictable_bytes`` are the files of tracks in no Smart Mix playlist that is on, which
    the quota evicts first. ``server_separator`` is the separator of the latest server
    analysis of those tracks.
    """

    playlists_on: int
    playlists_off: int
    tracks: int
    counts: StemStateCounts
    server_separator: str | None
    used_bytes: int
    files: int
    evictable_bytes: int
    settings: StemSettings


@dataclass(frozen=True, slots=True)
class AdminSmartMixPlaylists:
    playlists: tuple[AdminSmartMixPlaylist, ...]
    overview: SmartMixStemOverview
    seconds_per_track: float | None


_TRACK_WORK = text(
    f"""
    WITH track AS (
        SELECT id, entity_uid::text AS entity_uid, duration
        FROM library_tracks
        WHERE id = :track_id
    ),
    {PACE_CTE},
    holding AS (
        SELECT DISTINCT smp.playlist_id, smp.enabled
        FROM playlist_tracks pt
        JOIN smart_mix_playlists smp ON smp.playlist_id = pt.playlist_id
        WHERE pt.track_id = :track_id
    ),
    visible AS (
        SELECT holding.playlist_id, holding.enabled, p.name, p.user_id,
               u.username
        FROM holding
        JOIN playlists p ON p.id = holding.playlist_id
        LEFT JOIN users u ON u.id = p.user_id
        WHERE :all_playlists
           OR p.user_id = :viewer_id
           OR EXISTS (
               SELECT 1 FROM playlist_members member
               WHERE member.playlist_id = p.id AND member.user_id = :viewer_id
           )
    ),
    tracks_on AS (
        SELECT DISTINCT pt.playlist_id, pt.track_id
        FROM playlist_tracks pt
        JOIN visible ON visible.playlist_id = pt.playlist_id AND visible.enabled
        WHERE pt.track_id IS NOT NULL
    ),
    counts AS (
        SELECT tracks_on.playlist_id, COUNT(tracks_on.track_id) AS total,
               COUNT(analysis.track_id) AS ready
        FROM tracks_on
        {CURRENT_ANALYSIS_JOINS.format(track="tracks_on.track_id")}
        GROUP BY tracks_on.playlist_id
    ),
    listed AS (
        SELECT COALESCE(
            json_agg(
                json_build_object(
                    'playlistId', visible.playlist_id,
                    'name', visible.name,
                    'ownerId', visible.user_id,
                    'ownerUsername', visible.username,
                    'enabled', visible.enabled,
                    'ready', COALESCE(counts.ready, 0),
                    'total', COALESCE(counts.total, 0)
                )
                ORDER BY visible.enabled DESC, visible.name, visible.playlist_id
            ),
            '[]'::json
        ) AS playlists
        FROM visible
        LEFT JOIN counts ON counts.playlist_id = visible.playlist_id
    )
    SELECT track.id, track.entity_uid, track.duration,
           profile.source_revision, profile.analyzed_at AS profile_analyzed_at,
           profile.source_stale_at,
           server.track_id IS NOT NULL AS analysed,
           job.state AS job_state, job.attempts, job.last_error, job.requested_at,
           job.started_at, job.finished_at,
           file.bytes AS file_bytes, file.separator_model AS file_separator_model,
           file.separator_version AS file_separator_version,
           file.source_revision AS file_source_revision,
           file.created_at AS file_created_at, file.last_used_at AS file_last_used_at,
           pace.seconds AS seconds_per_track, listed.playlists
    FROM track
    CROSS JOIN pace
    CROSS JOIN listed
    LEFT JOIN track_mix_profiles profile ON profile.track_id = track.id
    LEFT JOIN track_stem_signals server
           ON server.track_id = track.id
          AND server.producer_kind = 'server'
          AND server.source_revision = profile.source_revision
          AND profile.source_stale_at IS NULL
    LEFT JOIN track_stem_jobs job ON job.track_id = track.id
    LEFT JOIN track_stem_files file ON file.track_id = track.id
    """
)

# A local track's state, as ``track_state`` derives it in Python.
_STATE = """
    CASE
        WHEN analysis.track_id IS NOT NULL THEN 'ready'
        WHEN job.state IN ('pending', 'analyzing', 'failed') THEN job.state
        ELSE 'pending'
    END
"""

_ADMIN_PLAYLISTS = text(
    f"""
    WITH listed AS (
        SELECT smp.playlist_id, smp.enabled, smp.enabled_at, smp.disabled_at,
               smp.last_used_at, p.name, p.user_id AS owner_id,
               u.username AS owner_username
        FROM smart_mix_playlists smp
        JOIN playlists p ON p.id = smp.playlist_id
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY smp.enabled DESC, smp.enabled_at DESC NULLS LAST, smp.playlist_id
        LIMIT :limit
    ),
    tracks AS (
        SELECT DISTINCT pt.playlist_id, pt.track_id
        FROM playlist_tracks pt
        JOIN listed ON listed.playlist_id = pt.playlist_id
        WHERE pt.track_id IS NOT NULL
    ),
    states AS (
        SELECT tracks.playlist_id, tracks.track_id, listed.enabled,
               {_STATE} AS state,
               job.attempts, job.last_error, job.finished_at, file.bytes AS file_bytes
        FROM tracks
        JOIN listed ON listed.playlist_id = tracks.playlist_id
        {CURRENT_ANALYSIS_JOINS.format(track="tracks.track_id")}
        LEFT JOIN track_stem_jobs job ON job.track_id = tracks.track_id
        LEFT JOIN track_stem_files file ON file.track_id = tracks.track_id
    ),
    per_playlist AS (
        SELECT playlist_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE enabled AND state = 'pending') AS pending,
               COUNT(*) FILTER (WHERE enabled AND state = 'analyzing') AS analyzing,
               COUNT(*) FILTER (WHERE enabled AND state = 'ready') AS ready,
               COUNT(*) FILTER (WHERE enabled AND state = 'failed') AS failed,
               COALESCE(SUM(file_bytes), 0) AS file_bytes,
               COUNT(file_bytes) AS files
        FROM states
        GROUP BY playlist_id
    ),
    failures AS (
        SELECT ranked.playlist_id,
               json_agg(
                   json_build_object(
                       'trackId', ranked.track_id,
                       'title', ranked.title,
                       'artist', ranked.artist,
                       'attempts', COALESCE(ranked.attempts, 0),
                       'lastError', ranked.last_error,
                       'finishedAt', ranked.finished_at
                   )
                   ORDER BY ranked.position
               ) AS failures
        FROM (
            SELECT states.*, lt.title, lt.artist,
                   ROW_NUMBER() OVER (
                       PARTITION BY states.playlist_id
                       ORDER BY states.finished_at DESC NULLS LAST, states.track_id
                   ) AS position
            FROM states
            JOIN library_tracks lt ON lt.id = states.track_id
            WHERE states.enabled AND states.state = 'failed'
        ) ranked
        WHERE ranked.position <= {_FAILURES_PER_PLAYLIST}
        GROUP BY ranked.playlist_id
    )
    SELECT listed.*,
           COALESCE(per_playlist.total, 0) AS total,
           COALESCE(per_playlist.pending, 0) AS pending,
           COALESCE(per_playlist.analyzing, 0) AS analyzing,
           COALESCE(per_playlist.ready, 0) AS ready,
           COALESCE(per_playlist.failed, 0) AS failed,
           COALESCE(per_playlist.file_bytes, 0) AS file_bytes,
           COALESCE(per_playlist.files, 0) AS files,
           COALESCE(failures.failures, '[]'::json) AS failures
    FROM listed
    LEFT JOIN per_playlist ON per_playlist.playlist_id = listed.playlist_id
    LEFT JOIN failures ON failures.playlist_id = listed.playlist_id
    ORDER BY listed.enabled DESC, listed.enabled_at DESC NULLS LAST,
             listed.playlist_id
    """
)

_OVERVIEW = text(
    f"""
    WITH on_tracks AS (
        SELECT DISTINCT pt.track_id
        FROM smart_mix_playlists smp
        JOIN playlist_tracks pt ON pt.playlist_id = smp.playlist_id
        WHERE smp.enabled AND pt.track_id IS NOT NULL
    ),
    states AS (
        SELECT on_tracks.track_id, {_STATE} AS state,
               analysis.separator_version, analysis.updated_at
        FROM on_tracks
        {CURRENT_ANALYSIS_JOINS.format(track="on_tracks.track_id")}
        LEFT JOIN track_stem_jobs job ON job.track_id = on_tracks.track_id
    ),
    {PACE_CTE},
    storage AS (
        SELECT COALESCE(SUM(file.bytes), 0) AS used_bytes, COUNT(*) AS files,
               COALESCE(
                   SUM(file.bytes) FILTER (WHERE on_tracks.track_id IS NULL), 0
               ) AS evictable_bytes
        FROM track_stem_files file
        LEFT JOIN on_tracks ON on_tracks.track_id = file.track_id
    )
    SELECT
        (SELECT COUNT(*) FROM smart_mix_playlists WHERE enabled) AS playlists_on,
        (SELECT COUNT(*) FROM smart_mix_playlists WHERE NOT enabled)
            AS playlists_off,
        (SELECT COUNT(*) FROM states) AS tracks,
        (SELECT COUNT(*) FROM states WHERE state = 'pending') AS pending,
        (SELECT COUNT(*) FROM states WHERE state = 'analyzing') AS analyzing,
        (SELECT COUNT(*) FROM states WHERE state = 'ready') AS ready,
        (SELECT COUNT(*) FROM states WHERE state = 'failed') AS failed,
        (
            SELECT separator_version FROM states
            WHERE separator_version IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT 1
        ) AS server_separator,
        storage.used_bytes, storage.files, storage.evictable_bytes,
        pace.seconds AS seconds_per_track,
        (SELECT value FROM settings WHERE key = :playlist_setting) AS playlist_limit,
        (SELECT value FROM settings WHERE key = :user_setting) AS user_limit,
        (SELECT value FROM settings WHERE key = :quota_setting) AS quota,
        (SELECT value FROM settings WHERE key = :uploads_setting) AS uploads
    FROM storage
    CROSS JOIN pace
    """
)


def get_track_stem_overview(
    track_id: int,
    *,
    viewer_id: int | None,
    all_playlists: bool,
    session: Session | None = None,
) -> TrackStemOverview | None:
    """The track's stems, or None when there is no such local track.

    ``all_playlists`` lists every Smart Mix playlist that holds the track; otherwise
    only those ``viewer_id`` owns or belongs to.
    """

    def _impl(current: Session) -> TrackStemOverview | None:
        row = (
            current.execute(
                _TRACK_WORK,
                {
                    "track_id": int(track_id),
                    "viewer_id": viewer_id,
                    "all_playlists": all_playlists,
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        current_revision = (
            row["source_revision"] if row["source_stale_at"] is None else None
        )
        profile = (
            get_track_mix_profile(
                int(track_id),
                include_beat_grid=True,
                include_structure=True,
                session=current,
            )
            if current_revision is not None
            else None
        )
        analyses = tuple(get_stored_stem_analyses(int(track_id), session=current))
        return TrackStemOverview(
            track_id=int(row["id"]),
            entity_uid=row["entity_uid"],
            library_duration_ms=(
                None
                if row["duration"] is None
                else max(0, round(float(row["duration"]) * 1_000))
            ),
            source_revision=current_revision,
            profile_analyzed_at=row["profile_analyzed_at"],
            source_stale_at=row["source_stale_at"],
            profile=profile,
            analyses=analyses,
            job=_job(row),
            file=_file(row),
            playlists=tuple(_playlist_ref(item) for item in row["playlists"]),
            seconds_per_track=_seconds(row["seconds_per_track"]),
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def list_admin_smart_mix_playlists(
    *, limit: int, session: Session | None = None
) -> AdminSmartMixPlaylists:
    """Up to ``limit`` Smart Mix playlists of every user, those that are on first and
    then the latest turned on, and the instance overview."""

    def _impl(current: Session) -> AdminSmartMixPlaylists:
        rows = current.execute(_ADMIN_PLAYLISTS, {"limit": int(limit)}).mappings().all()
        overview = (
            current.execute(
                _OVERVIEW,
                {
                    "playlist_setting": STEM_MAX_TRACKS_PER_PLAYLIST_SETTING,
                    "user_setting": STEM_MAX_TRACKS_PER_USER_SETTING,
                    "quota_setting": STEM_QUOTA_SETTING,
                    "uploads_setting": STEM_UPLOADS_SETTING,
                },
            )
            .mappings()
            .one()
        )
        return AdminSmartMixPlaylists(
            playlists=tuple(_admin_playlist(row) for row in rows),
            overview=_overview(overview),
            seconds_per_track=_seconds(overview["seconds_per_track"]),
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _seconds(value: Any) -> float | None:
    return None if value is None else float(value)


def _job(row: Any) -> TrackStemJob | None:
    if row["job_state"] is None:
        return None
    return TrackStemJob(
        state=track_state(row),
        attempts=int(row["attempts"] or 0),
        last_error=row["last_error"],
        requested_at=row["requested_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def _file(row: Any) -> TrackStemFile | None:
    if row["file_bytes"] is None:
        return None
    return TrackStemFile(
        bytes=int(row["file_bytes"]),
        separator_model=row["file_separator_model"],
        separator_version=row["file_separator_version"],
        source_revision=row["file_source_revision"],
        created_at=row["file_created_at"],
        last_used_at=row["file_last_used_at"],
    )


def _playlist_ref(item: dict[str, Any]) -> SmartMixPlaylistRef:
    return SmartMixPlaylistRef(
        playlist_id=int(item["playlistId"]),
        name=str(item["name"]),
        owner_id=None if item["ownerId"] is None else int(item["ownerId"]),
        owner_username=item["ownerUsername"],
        enabled=bool(item["enabled"]),
        ready=int(item["ready"]),
        total=int(item["total"]),
    )


def _counts(row: Any) -> StemStateCounts:
    return StemStateCounts(
        pending=int(row["pending"]),
        analyzing=int(row["analyzing"]),
        ready=int(row["ready"]),
        failed=int(row["failed"]),
    )


def _admin_playlist(row: Any) -> AdminSmartMixPlaylist:
    return AdminSmartMixPlaylist(
        playlist_id=int(row["playlist_id"]),
        name=str(row["name"]),
        owner_id=None if row["owner_id"] is None else int(row["owner_id"]),
        owner_username=row["owner_username"],
        enabled=bool(row["enabled"]),
        enabled_at=row["enabled_at"],
        disabled_at=row["disabled_at"],
        last_used_at=row["last_used_at"],
        total=int(row["total"]),
        counts=_counts(row),
        failures=tuple(
            StemFailure(
                track_id=int(item["trackId"]),
                title=item["title"],
                artist=item["artist"],
                attempts=int(item["attempts"]),
                last_error=item["lastError"],
                finished_at=_timestamp(item["finishedAt"]),
            )
            for item in row["failures"]
        ),
        file_bytes=int(row["file_bytes"]),
        files=int(row["files"]),
    )


def _timestamp(value: str | None) -> datetime | None:
    # json_build_object writes timestamptz as ISO 8601.
    return None if value is None else datetime.fromisoformat(value)


def _overview(row: Any) -> SmartMixStemOverview:
    per_playlist = stem_track_limit(
        row["playlist_limit"], default=DEFAULT_STEM_MAX_TRACKS_PER_PLAYLIST
    )
    return SmartMixStemOverview(
        playlists_on=int(row["playlists_on"]),
        playlists_off=int(row["playlists_off"]),
        tracks=int(row["tracks"]),
        counts=_counts(row),
        server_separator=row["server_separator"],
        used_bytes=int(row["used_bytes"]),
        files=int(row["files"]),
        evictable_bytes=int(row["evictable_bytes"]),
        settings=StemSettings(
            max_tracks_per_playlist=cast(int, per_playlist),
            max_tracks_per_user=stem_track_limit(row["user_limit"], default=None),
            quota_gib=stem_quota_gib(row["quota"]),
            uploads_enabled=(row["uploads"] or "true") == "true",
        ),
    )


__all__ = [
    "AdminSmartMixPlaylist",
    "AdminSmartMixPlaylists",
    "SmartMixPlaylistRef",
    "SmartMixStemOverview",
    "StemFailure",
    "StemSettings",
    "StemStateCounts",
    "TrackStemFile",
    "TrackStemJob",
    "TrackStemOverview",
    "get_track_stem_overview",
    "list_admin_smart_mix_playlists",
]
