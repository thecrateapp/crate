"""Track mutation helpers for playlist repository modules."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistTrack
from crate.db.repositories.library_track_reads import (
    resolve_library_track_reference,
)
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope
from crate.federation.global_policy import global_catalog_remote_playlist_refs_allowed


def _resolve_playlist_track(track: dict, *, session: Session) -> dict | None:
    global_track_uid = track.get("global_track_uid") or track.get("globalTrackUid")
    if global_track_uid:
        if not global_catalog_remote_playlist_refs_allowed():
            return None
        return _resolve_global_playlist_track(str(global_track_uid), session=session)

    track_id = track.get("track_id") or track.get("libraryTrackId") or track.get("id")
    track_entity_uid = (
        track.get("track_entity_uid")
        or track.get("entity_uid")
        or track.get("trackEntityUid")
        or track.get("entityUid")
    )
    track_storage_id = track.get("track_storage_id") or track.get("trackStorageId")
    track_path = track.get("track_path") or track.get("path") or ""

    library_track = resolve_library_track_reference(
        track_id=int(track_id) if track_id is not None else None,
        track_entity_uid=str(track_entity_uid) if track_entity_uid else None,
        track_storage_id=str(track_storage_id) if track_storage_id else None,
        track_path=track_path or None,
        session=session,
    )

    if library_track:
        resolved_entity_uid = library_track.get("entity_uid") or track_entity_uid
        resolved_storage_id = library_track.get("storage_id") or track_storage_id
        if not resolved_entity_uid and not resolved_storage_id:
            return None
        return {
            "global_track_uid": _resolve_local_global_track_uid(
                session,
                track_id=library_track.get("id"),
                track_entity_uid=resolved_entity_uid,
            ),
            "track_id": library_track.get("id"),
            "track_entity_uid": resolved_entity_uid,
            "track_storage_id": resolved_storage_id,
            "track_path": library_track.get("path") or track_path,
            "title": track.get("title")
            or library_track.get("title")
            or library_track.get("filename")
            or "",
            "artist": track.get("artist") or library_track.get("artist") or "",
            "album": track.get("album") or library_track.get("album") or "",
            "duration": float(
                track.get("duration") or library_track.get("duration") or 0
            ),
        }

    return None


def _resolve_local_global_track_uid(
    session: Session, *, track_id: int | None, track_entity_uid: str | None
) -> str | None:
    row = (
        session.execute(
            text(
                """
                SELECT global_track_uid::text AS global_track_uid
                FROM global_catalog_tracks
                WHERE local_track_id = :track_id
                   OR (
                        :track_entity_uid IS NOT NULL
                        AND local_track_entity_uid = CAST(:track_entity_uid AS uuid)
                   )
                ORDER BY local_track_id = :track_id DESC
                LIMIT 1
                """
            ),
            {"track_id": track_id, "track_entity_uid": track_entity_uid},
        )
        .mappings()
        .first()
    )
    return str(row["global_track_uid"]) if row else None


def _resolve_global_playlist_track(
    global_track_uid: str, *, session: Session
) -> dict | None:
    row = (
        session.execute(
            text(
                """
                SELECT
                    global_track_uid::text AS global_track_uid,
                    canonical_title,
                    artist_name,
                    album_name,
                    duration_seconds
                FROM global_catalog_tracks
                WHERE global_track_uid = :global_track_uid
                """
            ),
            {"global_track_uid": global_track_uid},
        )
        .mappings()
        .first()
    )
    if not row:
        return None
    return {
        "global_track_uid": row["global_track_uid"],
        "track_id": None,
        "track_entity_uid": None,
        "track_storage_id": None,
        "track_path": None,
        "title": row["canonical_title"] or "",
        "artist": row["artist_name"] or "",
        "album": row["album_name"] or "",
        "duration": float(row["duration_seconds"] or 0),
    }


def add_playlist_tracks(
    playlist_id: int, tracks: list[dict], *, session: Session | None = None
) -> int:
    def _impl(s: Session) -> int:
        now = datetime.now(timezone.utc)
        max_position = int(
            s.execute(
                select(func.coalesce(func.max(PlaylistTrack.position), 0)).where(
                    PlaylistTrack.playlist_id == playlist_id
                )
            ).scalar_one()
            or 0
        )
        position = max_position
        added = 0
        for track in tracks:
            resolved = _resolve_playlist_track(track, session=s)
            if resolved is None:
                continue
            position += 1
            added += 1
            s.add(
                PlaylistTrack(
                    playlist_id=playlist_id,
                    global_track_uid=resolved["global_track_uid"],
                    track_id=resolved["track_id"],
                    track_entity_uid=resolved["track_entity_uid"],
                    track_storage_id=resolved["track_storage_id"],
                    track_path=resolved["track_path"],
                    title=resolved["title"],
                    artist=resolved["artist"],
                    album=resolved["album"],
                    duration=resolved["duration"],
                    position=position,
                    source=str(track.get("source") or "manual"),
                    locked=bool(track.get("locked", False)),
                    added_at=now,
                )
            )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.track_count = int(
                s.execute(
                    select(func.count())
                    .select_from(PlaylistTrack)
                    .where(PlaylistTrack.playlist_id == playlist_id)
                ).scalar_one()
                or 0
            )
            playlist.total_duration = float(
                s.execute(
                    select(func.coalesce(func.sum(PlaylistTrack.duration), 0)).where(
                        PlaylistTrack.playlist_id == playlist_id
                    )
                ).scalar_one()
                or 0
            )
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="tracks_added",
            payload={"track_count_delta": added, "requested_count": len(tracks)},
        )
        return added

    with optional_scope(session) as s:
        return _impl(s)


def remove_playlist_track(
    playlist_id: int,
    position: int,
    *,
    session: Session | None = None,
    record_exclusion: bool = False,
    excluded_by_user_id: int | None = None,
) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        removed = (
            s.execute(
                text(
                    """
                    SELECT id, global_track_uid, track_id, track_entity_uid,
                           track_storage_id, track_path, source
                    FROM playlist_tracks
                    WHERE playlist_id = :playlist_id AND position = :position
                    """
                ),
                {"playlist_id": playlist_id, "position": position},
            )
            .mappings()
            .first()
        )
        if record_exclusion and removed and removed.get("source") == "generated":
            _insert_playlist_track_exclusion(
                s,
                playlist_id=playlist_id,
                track=dict(removed),
                created_by=excluded_by_user_id,
            )
        s.execute(
            text(
                "DELETE FROM playlist_tracks WHERE playlist_id = :playlist_id AND position = :position"
            ),
            {"playlist_id": playlist_id, "position": position},
        )
        s.execute(
            text(
                "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos "
                "FROM playlist_tracks WHERE playlist_id = :playlist_id) "
                "UPDATE playlist_tracks SET position = ordered.new_pos "
                "FROM ordered WHERE playlist_tracks.id = ordered.id"
            ),
            {"playlist_id": playlist_id},
        )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.track_count = int(
                s.execute(
                    select(func.count())
                    .select_from(PlaylistTrack)
                    .where(PlaylistTrack.playlist_id == playlist_id)
                ).scalar_one()
                or 0
            )
            playlist.total_duration = float(
                s.execute(
                    select(func.coalesce(func.sum(PlaylistTrack.duration), 0)).where(
                        PlaylistTrack.playlist_id == playlist_id
                    )
                ).scalar_one()
                or 0
            )
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="track_removed",
            payload={"position": position},
        )

    with optional_scope(session) as s:
        _impl(s)


def reorder_playlist(
    playlist_id: int,
    track_ids: list[int],
    *,
    session: Session | None = None,
    lock_tracks: bool = False,
) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        for position, track_id in enumerate(track_ids, 1):
            s.execute(
                text(
                    "UPDATE playlist_tracks SET position = :pos, locked = CASE WHEN :lock_tracks THEN TRUE ELSE locked END WHERE id = :tid AND playlist_id = :playlist_id"
                ),
                {
                    "pos": position,
                    "tid": track_id,
                    "playlist_id": playlist_id,
                    "lock_tracks": lock_tracks,
                },
            )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="reordered",
            payload={"track_ids": list(track_ids)},
        )

    with optional_scope(session) as s:
        _impl(s)


def replace_playlist_tracks(
    playlist_id: int, tracks: list[dict], *, session: Session | None = None
) -> int:
    def _impl(s: Session) -> int:
        now = datetime.now(timezone.utc)
        s.execute(
            text("DELETE FROM playlist_tracks WHERE playlist_id = :playlist_id"),
            {"playlist_id": playlist_id},
        )

        position = 0
        total_duration = 0.0
        for track in tracks:
            resolved = _resolve_playlist_track(track, session=s)
            if resolved is None:
                continue
            position += 1
            total_duration += float(resolved["duration"] or 0)
            s.add(
                PlaylistTrack(
                    playlist_id=playlist_id,
                    global_track_uid=resolved["global_track_uid"],
                    track_id=resolved["track_id"],
                    track_entity_uid=resolved["track_entity_uid"],
                    track_storage_id=resolved["track_storage_id"],
                    track_path=resolved["track_path"],
                    title=resolved["title"],
                    artist=resolved["artist"],
                    album=resolved["album"],
                    duration=resolved["duration"],
                    position=position,
                    source=str(track.get("source") or "generated"),
                    locked=bool(track.get("locked", False)),
                    added_at=now,
                )
            )

        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.track_count = position
            playlist.total_duration = total_duration
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="tracks_replaced",
            payload={"track_count": position, "requested_count": len(tracks)},
        )
        return position

    with optional_scope(session) as s:
        return _impl(s)


def regenerate_playlist_tracks(
    playlist_id: int,
    tracks: list[dict],
    *,
    target_count: int,
    session: Session | None = None,
) -> int:
    def _impl(s: Session) -> int:
        preserved = _get_preserved_playlist_tracks(s, playlist_id)
        exclusions = _get_playlist_track_exclusion_keys(s, playlist_id)
        preserved_keys = {_track_identity_key(track) for track in preserved}
        generated: list[dict] = []
        for track in tracks:
            resolved = _resolve_playlist_track(track, session=s)
            if resolved is None:
                continue
            key = _track_identity_key(resolved)
            if key in exclusions or key in preserved_keys:
                continue
            generated.append({**resolved, "source": "generated", "locked": False})

        desired_count = max(target_count, len(preserved))
        output = _merge_preserved_and_generated(
            preserved, generated, target_count=desired_count
        )
        return replace_playlist_tracks(playlist_id, output, session=s)

    with optional_scope(session) as s:
        return _impl(s)


def set_playlist_track_lock(
    playlist_id: int,
    position: int,
    *,
    locked: bool,
    session: Session | None = None,
) -> None:
    def _impl(s: Session) -> None:
        now = datetime.now(timezone.utc)
        s.execute(
            text(
                """
                UPDATE playlist_tracks
                SET locked = :locked
                WHERE playlist_id = :playlist_id AND position = :position
                """
            ),
            {"playlist_id": playlist_id, "position": position, "locked": locked},
        )
        playlist = s.get(Playlist, playlist_id)
        if playlist is not None:
            playlist.updated_at = now
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="track_lock_changed",
            payload={"position": position, "locked": locked},
        )

    with optional_scope(session) as s:
        _impl(s)


def _insert_playlist_track_exclusion(
    s: Session, *, playlist_id: int, track: dict, created_by: int | None
) -> None:
    s.execute(
        text(
            """
            INSERT INTO playlist_track_exclusions (
                playlist_id, global_track_uid, track_id, track_entity_uid,
                track_storage_id, track_path, created_by
            )
            VALUES (
                :playlist_id, CAST(:global_track_uid AS uuid), :track_id,
                :track_entity_uid, :track_storage_id, :track_path, :created_by
            )
            ON CONFLICT DO NOTHING
            """
        ),
        {
            "playlist_id": playlist_id,
            "global_track_uid": track.get("global_track_uid"),
            "track_id": track.get("track_id"),
            "track_entity_uid": track.get("track_entity_uid"),
            "track_storage_id": track.get("track_storage_id"),
            "track_path": track.get("track_path"),
            "created_by": created_by,
        },
    )


def _get_preserved_playlist_tracks(s: Session, playlist_id: int) -> list[dict]:
    rows = (
        s.execute(
            text(
                """
                SELECT global_track_uid::text AS global_track_uid, track_id,
                       track_entity_uid, track_storage_id, track_path,
                       title, artist, album, duration, position, source, locked
                FROM playlist_tracks
                WHERE playlist_id = :playlist_id
                  AND (source != 'generated' OR locked = TRUE)
                ORDER BY position
                """
            ),
            {"playlist_id": playlist_id},
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


def _get_playlist_track_exclusion_keys(s: Session, playlist_id: int) -> set[tuple]:
    rows = (
        s.execute(
            text(
                """
                SELECT global_track_uid::text AS global_track_uid, track_id,
                       track_entity_uid, track_storage_id, track_path
                FROM playlist_track_exclusions
                WHERE playlist_id = :playlist_id
                """
            ),
            {"playlist_id": playlist_id},
        )
        .mappings()
        .all()
    )
    return {_track_identity_key(dict(row)) for row in rows}


def _track_identity_key(track: dict) -> tuple:
    return (
        str(track.get("global_track_uid") or ""),
        str(track.get("track_entity_uid") or ""),
        str(track.get("track_storage_id") or ""),
        str(track.get("track_path") or ""),
        str(track.get("track_id") or ""),
    )


def _merge_preserved_and_generated(
    preserved: list[dict], generated: list[dict], *, target_count: int
) -> list[dict]:
    preserved_by_position = {
        int(track.get("position") or index + 1): track
        for index, track in enumerate(preserved)
    }
    generated_iter = iter(generated)
    output: list[dict] = []
    for position in range(1, target_count + 1):
        preserved_track = preserved_by_position.get(position)
        if preserved_track is not None:
            output.append(preserved_track)
            continue
        try:
            output.append(next(generated_iter))
        except StopIteration:
            continue

    overflow = [
        track
        for position, track in sorted(preserved_by_position.items())
        if position > target_count
    ]
    output.extend(overflow)
    return output


__all__ = [
    "add_playlist_tracks",
    "regenerate_playlist_tracks",
    "remove_playlist_track",
    "replace_playlist_tracks",
    "reorder_playlist",
    "set_playlist_track_lock",
]
