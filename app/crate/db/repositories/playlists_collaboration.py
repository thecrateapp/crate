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
from crate.db.repositories.playlists_tracks import add_playlist_tracks
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


def copy_playlist(
    source: dict, tracks: list[dict], user_id: int, *, session: Session | None = None
) -> int:
    with optional_scope(session) as s:
        playlist_id = create_playlist(
            name=str(source.get("name") or "Playlist"),
            description=str(source.get("description") or ""),
            user_id=user_id,
            visibility="private",
            session=s,
        )
        if tracks:
            add_playlist_tracks(playlist_id, tracks, session=s)
        return playlist_id


__all__ = ["add_playlist_collaborator", "copy_playlist", "leave_playlist"]
