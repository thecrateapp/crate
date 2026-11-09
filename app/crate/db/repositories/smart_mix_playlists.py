"""Smart Mix playlists and their per-track stem work (Smart Mix Stems, STEM-D2).

A Smart Mix playlist is a playlist its owner marks for Smart Mix. While it is on, the
server separates its local tracks into stems, and Crate Decks keeps it as an offline set.
Only the owner turns it on or off; system playlists have no owner and never are.

- **Rows.** ``smart_mix_playlists`` has one row per playlist that was ever turned on,
  deleted with the playlist. Turning it off keeps the row with ``enabled = false``.
- **Revision.** Every change of a Smart Mix playlist (turned on or off, tracks added,
  removed or replaced while it is on) takes the next value of its owner's counter in
  ``smart_mix_playlist_revisions``, so Decks syncs "changes since revision N". The
  counter row also serialises the owner's changes, so the per-user limit holds under
  concurrent requests.
- **Limits.** Admin settings of each instance: at most 300 distinct local tracks per
  Smart Mix playlist by default, and optionally a limit on the distinct tracks of all of
  a user's Smart Mix playlists. Turning a playlist on, and adding tracks while it is on,
  is refused (:class:`SmartMixPlaylistLimitError`) when it would go over either.
- **Work.** ``track_stem_jobs`` has one row per track, whatever the number of
  playlists that hold it. A track gets a pending job when one of its Smart Mix
  playlists turns on or receives it and it has no server analysis of its current file
  (``track_stem_signals``). A finished job whose analysis no longer applies (the file
  changed) goes back to pending; a failed job only does when the file changed since.
  Removing tracks and turning a playlist off leave jobs and analyses alone, so the
  separation task, ``analyze_playlist_stems``, claims a job only while one of the
  track's Smart Mix playlists is on. Turning a playlist on, and adding tracks that need
  stems, queues that task in the same transaction (one at a time).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast

from sqlalchemy import INTEGER, bindparam, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from crate.db.orm.smart_mix import SmartMixPlaylistRow
from crate.db.tx import optional_scope, read_scope
from crate.smart_mix.stems import (
    DEFAULT_STEM_MAX_TRACKS_PER_PLAYLIST,
    ESTIMATED_STEM_SECONDS_PER_TRACK,
    STEM_JOB_STATES,
    STEM_MAX_TRACKS_PER_PLAYLIST_SETTING,
    STEM_MAX_TRACKS_PER_USER_SETTING,
    STEM_TASK_TYPE,
    StemJobState,
    stem_track_limit,
)
from crate.task_dedup_keys import SMART_MIX_STEMS_DEDUP_KEY

LimitKind = Literal["playlist", "user"]

# The estimate uses the mean time of the latest separations.
_PACE_WINDOW = 20


class SmartMixPlaylistError(Exception):
    """A refused Smart Mix playlist change. The transaction must roll back."""


class SmartMixPlaylistNotFoundError(SmartMixPlaylistError):
    def __init__(self, playlist_id: int) -> None:
        super().__init__(f"Playlist {playlist_id} not found")


class SmartMixPlaylistOwnerError(SmartMixPlaylistError):
    def __init__(self) -> None:
        super().__init__("Only the playlist's owner turns Smart Mix on or off")


class SmartMixPlaylistLimitError(SmartMixPlaylistError):
    """The playlist, or all of the owner's Smart Mix playlists, would hold too many tracks."""

    def __init__(self, limit: LimitKind, *, max_tracks: int, tracks: int) -> None:
        self.limit = limit
        self.max_tracks = max_tracks
        self.tracks = tracks
        if limit == "playlist":
            message = (
                f"A Smart Mix playlist holds at most {max_tracks} tracks; this one "
                f"would hold {tracks}"
            )
        else:
            message = (
                f"A user's Smart Mix playlists hold at most {max_tracks} tracks "
                f"together; they would hold {tracks}"
            )
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class SmartMixPlaylistLimits:
    max_tracks_per_playlist: int
    max_tracks_per_user: int | None


@dataclass(frozen=True, slots=True)
class SmartMixPlaylistState:
    playlist_id: int
    user_id: int
    enabled: bool
    enabled_at: datetime
    disabled_at: datetime | None
    last_used_at: datetime | None
    revision: int
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SmartMixSummary:
    """What playlist responses carry: ``ready`` of ``total`` local tracks while on."""

    enabled: bool
    ready: int
    total: int

    def as_response(self) -> dict[str, bool | int]:
        return {"enabled": self.enabled, "ready": self.ready, "total": self.total}


SMART_MIX_OFF = SmartMixSummary(enabled=False, ready=0, total=0)


@dataclass(frozen=True, slots=True)
class SmartMixTrackState:
    track_id: int
    entity_uid: str | None
    state: StemJobState
    attempts: int


@dataclass(frozen=True, slots=True)
class SmartMixPlaylistStatus:
    """A playlist's Smart Mix state and, while it is on, the state of each local track.

    ``playlist`` has the fields playlist access checks read (``id``, ``user_id``,
    ``scope``, ``visibility``, ``is_collaborative``). ``state`` is None for a playlist
    that was never turned on.
    """

    playlist: dict[str, Any]
    state: SmartMixPlaylistState | None
    tracks: tuple[SmartMixTrackState, ...]
    estimated_seconds_left: int | None

    @property
    def counts(self) -> dict[StemJobState, int]:
        counts = dict.fromkeys(STEM_JOB_STATES, 0)
        for track in self.tracks:
            counts[track.state] += 1
        return counts


_STATE_COLUMNS = (
    "playlist_id, user_id, enabled, enabled_at, disabled_at, last_used_at, revision, "
    "updated_at"
)

_LOCK_PLAYLIST = text(
    """
    SELECT p.user_id AS owner_id, p.scope, smp.playlist_id, smp.user_id,
           smp.enabled, smp.enabled_at, smp.disabled_at, smp.last_used_at,
           smp.revision, smp.updated_at
    FROM playlists p
    LEFT JOIN smart_mix_playlists smp ON smp.playlist_id = p.id
    WHERE p.id = :playlist_id
    FOR UPDATE OF p
    """
)

# The owner's counter row is locked until commit, so the owner's changes are serial.
_NEXT_REVISION = """
    bumped AS (
        INSERT INTO smart_mix_playlist_revisions AS counter (user_id, revision)
        VALUES (:user_id, 1)
        ON CONFLICT (user_id) DO UPDATE SET revision = counter.revision + 1
        RETURNING revision
    )
"""

_TURN = text(
    f"""
    WITH {_NEXT_REVISION}
    INSERT INTO smart_mix_playlists AS smp (
        playlist_id, user_id, enabled, enabled_at, disabled_at, last_used_at,
        revision, updated_at
    )
    SELECT :playlist_id, :user_id, :enabled, NOW(),
           CASE WHEN :enabled THEN NULL ELSE NOW() END, NOW(), bumped.revision, NOW()
    FROM bumped
    ON CONFLICT (playlist_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        enabled = EXCLUDED.enabled,
        enabled_at = CASE WHEN EXCLUDED.enabled THEN NOW() ELSE smp.enabled_at END,
        disabled_at = CASE WHEN EXCLUDED.enabled THEN NULL ELSE NOW() END,
        last_used_at = CASE
            WHEN EXCLUDED.enabled THEN NOW() ELSE smp.last_used_at
        END,
        revision = EXCLUDED.revision,
        updated_at = NOW()
    RETURNING {_STATE_COLUMNS}
    """
)

_TOUCH = text(
    f"""
    WITH {_NEXT_REVISION}
    UPDATE smart_mix_playlists AS smp
    SET revision = bumped.revision, updated_at = NOW()
    FROM bumped
    WHERE smp.playlist_id = :playlist_id
    """
)

_ENABLED_OWNER = text(
    "SELECT user_id FROM smart_mix_playlists WHERE playlist_id = :playlist_id "
    "AND enabled"
)

_SETTINGS = """
    (SELECT value FROM settings WHERE key = :playlist_setting) AS playlist_limit,
    (SELECT value FROM settings WHERE key = :user_setting) AS user_limit
"""

_LIMITS = text(
    f"""
    SELECT
        {_SETTINGS},
        (
            SELECT COUNT(DISTINCT track_id)
            FROM playlist_tracks
            WHERE playlist_id = :playlist_id AND track_id IS NOT NULL
        ) AS playlist_tracks,
        (
            SELECT COUNT(DISTINCT pt.track_id)
            FROM playlist_tracks pt
            WHERE pt.track_id IS NOT NULL
              AND (
                  pt.playlist_id = :playlist_id
                  OR pt.playlist_id IN (
                      SELECT playlist_id
                      FROM smart_mix_playlists
                      WHERE user_id = :user_id AND enabled
                  )
              )
        ) AS user_tracks
    """
)

# A server analysis of the track's current file (its profile's source revision).
_CURRENT_ANALYSIS_JOINS = """
    LEFT JOIN track_mix_profiles profile
           ON profile.track_id = {track} AND profile.source_stale_at IS NULL
    LEFT JOIN track_stem_signals analysis
           ON analysis.track_id = {track}
          AND analysis.producer_kind = 'server'
          AND analysis.source_revision = profile.source_revision
"""

_QUEUE = f"""
    INSERT INTO track_stem_jobs AS job (track_id, state, source_revision)
    SELECT DISTINCT pt.track_id, 'pending', profile.source_revision
    FROM smart_mix_playlists smp
    JOIN playlist_tracks pt ON pt.playlist_id = smp.playlist_id
    {_CURRENT_ANALYSIS_JOINS.format(track="pt.track_id")}
    WHERE smp.enabled
      AND pt.track_id IS NOT NULL
      AND analysis.track_id IS NULL
      {{playlists}}
    ON CONFLICT (track_id) DO UPDATE SET
        state = 'pending',
        attempts = 0,
        last_error = NULL,
        requested_at = NOW(),
        started_at = NULL,
        finished_at = NULL,
        source_revision = EXCLUDED.source_revision
    WHERE job.state = 'ready'
       OR (
           job.state IN ('pending', 'failed')
           AND job.source_revision IS DISTINCT FROM EXCLUDED.source_revision
       )
"""

_SUMMARIES = text(
    f"""
    WITH enabled AS (
        SELECT playlist_id
        FROM smart_mix_playlists
        WHERE playlist_id = ANY(:playlist_ids) AND enabled
    ),
    tracks AS (
        SELECT DISTINCT pt.playlist_id, pt.track_id
        FROM playlist_tracks pt
        JOIN enabled ON enabled.playlist_id = pt.playlist_id
        WHERE pt.track_id IS NOT NULL
    )
    SELECT enabled.playlist_id,
           COUNT(tracks.track_id) AS total,
           COUNT(analysis.track_id) AS ready
    FROM enabled
    LEFT JOIN tracks ON tracks.playlist_id = enabled.playlist_id
    {_CURRENT_ANALYSIS_JOINS.format(track="tracks.track_id")}
    GROUP BY enabled.playlist_id
    """
).bindparams(bindparam("playlist_ids", type_=ARRAY(INTEGER)))

_STATUS = text(
    f"""
    WITH playlist AS (
        SELECT p.id, p.user_id AS owner_id, p.scope, p.visibility,
               p.is_collaborative, smp.playlist_id, smp.user_id, smp.enabled,
               smp.enabled_at, smp.disabled_at, smp.last_used_at, smp.revision,
               smp.updated_at
        FROM playlists p
        LEFT JOIN smart_mix_playlists smp ON smp.playlist_id = p.id
        WHERE p.id = :playlist_id
    ),
    tracks AS (
        SELECT pt.track_id, MIN(pt.position) AS position
        FROM playlist_tracks pt
        JOIN playlist ON playlist.enabled
        WHERE pt.playlist_id = :playlist_id AND pt.track_id IS NOT NULL
        GROUP BY pt.track_id
    ),
    pace AS (
        SELECT EXTRACT(EPOCH FROM AVG(recent.finished_at - recent.started_at))
            AS seconds
        FROM (
            SELECT started_at, finished_at
            FROM track_stem_jobs
            WHERE state = 'ready'
              AND started_at IS NOT NULL
              AND finished_at IS NOT NULL
            ORDER BY finished_at DESC
            LIMIT {_PACE_WINDOW}
        ) recent
    )
    SELECT playlist.*, pace.seconds AS seconds_per_track, tracks.track_id,
           lt.entity_uid::text AS entity_uid, job.state AS job_state,
           COALESCE(job.attempts, 0) AS attempts,
           analysis.track_id IS NOT NULL AS analysed
    FROM playlist
    CROSS JOIN pace
    LEFT JOIN tracks ON TRUE
    LEFT JOIN library_tracks lt ON lt.id = tracks.track_id
    {_CURRENT_ANALYSIS_JOINS.format(track="tracks.track_id")}
    LEFT JOIN track_stem_jobs job ON job.track_id = tracks.track_id
    ORDER BY tracks.position
    """
)


def get_smart_mix_playlist_limits(
    *, session: Session | None = None
) -> SmartMixPlaylistLimits:
    """The instance's limits: 300 tracks per playlist and no per-user limit by default."""
    statement = text(f"SELECT {_SETTINGS}")

    def _impl(current: Session) -> SmartMixPlaylistLimits:
        row = current.execute(statement, _setting_keys()).mappings().one()
        return _limits(row)

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def set_smart_mix_playlist(
    playlist_id: int,
    *,
    user_id: int,
    enabled: bool,
    session: Session | None = None,
) -> SmartMixPlaylistState | None:
    """Turn the playlist's Smart Mix on or off as its owner ``user_id``.

    Turning it on checks both limits and queues stem jobs for its tracks. Setting the
    state it already has changes nothing, except that turning on again queues what is
    missing. Returns None when turning off a playlist that was never on.
    """
    with optional_scope(session) as current:
        row = (
            current.execute(_LOCK_PLAYLIST, {"playlist_id": playlist_id})
            .mappings()
            .first()
        )
        if row is None:
            raise SmartMixPlaylistNotFoundError(playlist_id)
        if row["scope"] == "system" or row["owner_id"] != user_id:
            raise SmartMixPlaylistOwnerError()
        if row["playlist_id"] is None and not enabled:
            return None
        if row["playlist_id"] is not None and row["enabled"] == enabled:
            if enabled:
                _queue(current, [playlist_id])
                _wake_separation(current)
            return _state(row)
        state = _state(
            current.execute(
                _TURN,
                {"playlist_id": playlist_id, "user_id": user_id, "enabled": enabled},
            )
            .mappings()
            .one()
        )
        if enabled:
            _check_limits(current, playlist_id=playlist_id, user_id=user_id)
            _queue(current, [playlist_id])
            _wake_separation(current)
        return state


def smart_mix_playlist_tracks_changed(
    playlist_id: int, *, added: bool, session: Session
) -> None:
    """Record a change to the tracks of a playlist, in the transaction that made it.

    For a Smart Mix playlist that is on, the change takes a new revision; when tracks
    were added it also checks both limits (raising :class:`SmartMixPlaylistLimitError`,
    so the transaction rolls back) and queues stem jobs for the new tracks. Other
    playlists cost one query.
    """
    session.flush()
    user_id = session.execute(
        _ENABLED_OWNER, {"playlist_id": playlist_id}
    ).scalar_one_or_none()
    if user_id is None:
        return
    session.execute(_TOUCH, {"playlist_id": playlist_id, "user_id": user_id})
    if added:
        _check_limits(session, playlist_id=playlist_id, user_id=int(user_id))
        if _queue(session, [playlist_id]):
            _wake_separation(session)


def queue_smart_mix_stem_jobs(
    playlist_ids: Sequence[int] | None = None, *, session: Session | None = None
) -> int:
    """Queue stem jobs for the tracks of Smart Mix playlists that are on.

    ``playlist_ids`` limits it to those playlists; None covers every Smart Mix
    playlist that is on, so a worker can catch tracks whose file changed since their
    analysis. Returns the number of jobs queued or queued again.
    """
    with optional_scope(session) as current:
        return _queue(current, playlist_ids)


def list_smart_mix_playlists(
    user_id: int, *, since_revision: int | None, session: Session | None = None
) -> list[SmartMixPlaylistState]:
    """The user's Smart Mix playlists changed after ``since_revision``, in order.

    Playlists turned off are included; None lists every one the user has.
    """
    statement = (
        select(SmartMixPlaylistRow)
        .where(
            SmartMixPlaylistRow.user_id == user_id,
            SmartMixPlaylistRow.revision > (since_revision or 0),
        )
        .order_by(SmartMixPlaylistRow.revision)
    )

    def _impl(current: Session) -> list[SmartMixPlaylistState]:
        return [
            _state(
                {column: getattr(row, column) for column in _STATE_FIELDS},
            )
            for row in current.execute(statement).scalars()
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def smart_mix_summaries(
    playlist_ids: Sequence[int], *, session: Session | None = None
) -> dict[int, SmartMixSummary]:
    """The Smart Mix summary of each playlist, in one query.

    Every requested playlist is a key. ``ready`` counts the local tracks with a server
    analysis of their current file and ``total`` the distinct local tracks, both while
    Smart Mix is on; a playlist that is off (or never was on) is all zero.
    """
    requested = list(dict.fromkeys(int(playlist_id) for playlist_id in playlist_ids))
    if not requested:
        return {}

    def _impl(current: Session) -> dict[int, SmartMixSummary]:
        summaries = dict.fromkeys(requested, SMART_MIX_OFF)
        for row in current.execute(_SUMMARIES, {"playlist_ids": requested}).mappings():
            summaries[int(row["playlist_id"])] = SmartMixSummary(
                enabled=True, ready=int(row["ready"]), total=int(row["total"])
            )
        return summaries

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def attach_smart_mix_summaries(
    playlists: list[dict], *, session: Session | None = None
) -> list[dict]:
    """Set ``smartMix`` on each playlist dict from one :func:`smart_mix_summaries` query."""
    summaries = smart_mix_summaries(
        [int(playlist["id"]) for playlist in playlists], session=session
    )
    for playlist in playlists:
        playlist["smartMix"] = summaries[int(playlist["id"])].as_response()
    return playlists


def smart_mix_playlist_status(
    playlist_id: int, *, session: Session | None = None
) -> SmartMixPlaylistStatus | None:
    """The playlist's Smart Mix state and per-track states, in one query.

    A track is ``ready`` when it has a server analysis of its current file; otherwise
    it has its job's state, and is ``pending`` without a job or when its finished job
    no longer applies. The estimate is the time left for the playlist's pending and
    analysing tracks at the mean time of the latest separations (five minutes per track
    until there is one), ignoring other queued work. None when the playlist does not
    exist.
    """

    def _impl(current: Session) -> SmartMixPlaylistStatus | None:
        rows = current.execute(_STATUS, {"playlist_id": playlist_id}).mappings().all()
        if not rows:
            return None
        first = rows[0]
        state = _state(first) if first["playlist_id"] is not None else None
        tracks = tuple(
            SmartMixTrackState(
                track_id=int(row["track_id"]),
                entity_uid=row["entity_uid"],
                state=_track_state(row),
                attempts=int(row["attempts"]),
            )
            for row in rows
            if row["track_id"] is not None
        )
        estimate = None
        if state is not None and state.enabled:
            seconds = first["seconds_per_track"]
            per_track = (
                float(seconds)
                if seconds is not None
                else float(ESTIMATED_STEM_SECONDS_PER_TRACK)
            )
            left = sum(1 for t in tracks if t.state in ("pending", "analyzing"))
            estimate = round(left * per_track)
        return SmartMixPlaylistStatus(
            playlist={
                "id": int(first["id"]),
                "user_id": first["owner_id"],
                "scope": first["scope"],
                "visibility": first["visibility"],
                "is_collaborative": first["is_collaborative"],
            },
            state=state,
            tracks=tracks,
            estimated_seconds_left=estimate,
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


_STATE_FIELDS = (
    "playlist_id",
    "user_id",
    "enabled",
    "enabled_at",
    "disabled_at",
    "last_used_at",
    "revision",
    "updated_at",
)


def _state(row: Any) -> SmartMixPlaylistState:
    return SmartMixPlaylistState(
        playlist_id=int(row["playlist_id"]),
        user_id=int(row["user_id"]),
        enabled=bool(row["enabled"]),
        enabled_at=row["enabled_at"],
        disabled_at=row["disabled_at"],
        last_used_at=row["last_used_at"],
        revision=int(row["revision"]),
        updated_at=row["updated_at"],
    )


def _track_state(row: Any) -> StemJobState:
    if row["analysed"]:
        return "ready"
    job_state = row["job_state"]
    if job_state in ("pending", "analyzing", "failed"):
        return cast(StemJobState, job_state)
    # No job, or a finished one whose analysis no longer applies.
    return "pending"


def _setting_keys() -> dict[str, str]:
    return {
        "playlist_setting": STEM_MAX_TRACKS_PER_PLAYLIST_SETTING,
        "user_setting": STEM_MAX_TRACKS_PER_USER_SETTING,
    }


def _limits(row: Any) -> SmartMixPlaylistLimits:
    per_playlist = stem_track_limit(
        row["playlist_limit"], default=DEFAULT_STEM_MAX_TRACKS_PER_PLAYLIST
    )
    assert per_playlist is not None
    return SmartMixPlaylistLimits(
        max_tracks_per_playlist=per_playlist,
        max_tracks_per_user=stem_track_limit(row["user_limit"], default=None),
    )


def _check_limits(session: Session, *, playlist_id: int, user_id: int) -> None:
    row = (
        session.execute(
            _LIMITS,
            {"playlist_id": playlist_id, "user_id": user_id, **_setting_keys()},
        )
        .mappings()
        .one()
    )
    limits = _limits(row)
    if row["playlist_tracks"] > limits.max_tracks_per_playlist:
        raise SmartMixPlaylistLimitError(
            "playlist",
            max_tracks=limits.max_tracks_per_playlist,
            tracks=int(row["playlist_tracks"]),
        )
    per_user = limits.max_tracks_per_user
    if per_user is not None and row["user_tracks"] > per_user:
        raise SmartMixPlaylistLimitError(
            "user", max_tracks=per_user, tracks=int(row["user_tracks"])
        )


def _wake_separation(session: Session) -> None:
    """Queue analyze_playlist_stems in this transaction, unless one is queued or
    running; it is sent to the worker after commit."""
    from crate.db.repositories.tasks import create_task_dedup

    create_task_dedup(
        STEM_TASK_TYPE, {}, dedup_key=SMART_MIX_STEMS_DEDUP_KEY, session=session
    )


def _queue(session: Session, playlist_ids: Sequence[int] | None) -> int:
    if playlist_ids is None:
        statement = text(_QUEUE.format(playlists=""))
        return int(getattr(session.execute(statement), "rowcount", 0) or 0)
    ids = [int(playlist_id) for playlist_id in playlist_ids]
    if not ids:
        return 0
    statement = text(
        _QUEUE.format(playlists="AND pt.playlist_id = ANY(:playlist_ids)")
    ).bindparams(bindparam("playlist_ids", type_=ARRAY(INTEGER)))
    return int(
        getattr(session.execute(statement, {"playlist_ids": ids}), "rowcount", 0) or 0
    )


__all__ = [
    "SMART_MIX_OFF",
    "SmartMixPlaylistError",
    "SmartMixPlaylistLimitError",
    "SmartMixPlaylistLimits",
    "SmartMixPlaylistNotFoundError",
    "SmartMixPlaylistOwnerError",
    "SmartMixPlaylistState",
    "SmartMixPlaylistStatus",
    "SmartMixSummary",
    "SmartMixTrackState",
    "attach_smart_mix_summaries",
    "get_smart_mix_playlist_limits",
    "list_smart_mix_playlists",
    "queue_smart_mix_stem_jobs",
    "set_smart_mix_playlist",
    "smart_mix_playlist_status",
    "smart_mix_playlist_tracks_changed",
    "smart_mix_summaries",
]
