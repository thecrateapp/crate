"""Owner-managed collaboration, leaving and copying for user playlists."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_follows import (
    add_playlist_member,
    remove_playlist_member,
)
from crate.db.repositories.playlists_shared import emit_playlist_domain_event
from crate.db.tx import optional_scope


def add_playlist_collaborator(
    playlist_id: int,
    user_id: int,
    *,
    added_by: int,
    session: Session | None = None,
) -> None:
    with optional_scope(session) as s:
        add_playlist_member(
            playlist_id, user_id, role="collab", invited_by=added_by, session=s
        )
        s.execute(
            text("UPDATE playlists SET is_collaborative = TRUE WHERE id = :id"),
            {"id": playlist_id},
        )
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="collaborator_added",
            payload={"user_id": user_id, "added_by": added_by},
        )


def leave_playlist(
    playlist_id: int, user_id: int, *, session: Session | None = None
) -> bool:
    with optional_scope(session) as s:
        owner_id = s.execute(
            text("SELECT user_id FROM playlists WHERE id = :id"), {"id": playlist_id}
        ).scalar_one_or_none()
        if owner_id is None or owner_id == user_id:
            return False
        return remove_playlist_member(playlist_id, user_id, session=s)


def copy_playlist(source: dict, user_id: int, *, session: Session | None = None) -> int:
    with optional_scope(session) as s:
        playlist_id = create_playlist(
            name=str(source.get("name") or "Playlist"),
            description=str(source.get("description") or ""),
            user_id=user_id,
            visibility="private",
            session=s,
        )
        copied = s.execute(
            text(
                """
                INSERT INTO playlist_tracks (
                    playlist_id, track_id, track_entity_uid, track_storage_id, track_path,
                    title, artist, album, duration, position, source, locked, added_at,
                    global_track_uid
                )
                SELECT
                    :playlist_id, track_id, track_entity_uid, track_storage_id, track_path,
                    title, artist, album, duration, position, 'manual', FALSE, NOW(),
                    global_track_uid
                FROM playlist_tracks
                WHERE playlist_id = :source_id
                ORDER BY position
                """
            ),
            {"playlist_id": playlist_id, "source_id": int(source["id"])},
        ).rowcount
        s.execute(
            text(
                """
                UPDATE playlists
                SET track_count = source.track_count,
                    total_duration = source.total_duration,
                    updated_at = NOW()
                FROM playlists AS source
                WHERE playlists.id = :playlist_id AND source.id = :source_id
                """
            ),
            {"playlist_id": playlist_id, "source_id": int(source["id"])},
        )
        emit_playlist_domain_event(
            s,
            playlist_id=playlist_id,
            action="tracks_added",
            payload={"track_count_delta": copied, "copied_from": int(source["id"])},
        )
        return playlist_id


__all__ = ["add_playlist_collaborator", "copy_playlist", "leave_playlist"]
