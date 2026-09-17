"""Atomic playlist mutations initiated through OpenSubsonic."""

from __future__ import annotations

from typing import Any, Literal

from crate.db.repositories.playlists_collection_reads import get_playlist
from crate.db.repositories.playlists_create import create_playlist
from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.repositories.playlists_mutate import (
    delete_playlist,
    lock_playlist,
    update_playlist,
)
from crate.db.repositories.playlists_tracks import (
    add_playlist_tracks,
    remove_playlist_track,
    replace_playlist_tracks,
)
from crate.db.tx import transaction_scope


PlaylistMutationFailure = Literal["not-found", "not-authorized", "invalid-index"]


class PlaylistMutationError(ValueError):
    def __init__(self, reason: PlaylistMutationFailure) -> None:
        self.reason = reason
        super().__init__(reason)


def create_subsonic_playlist(
    name: str, user_id: int, tracks: list[dict[str, Any]]
) -> int:
    with transaction_scope() as session:
        playlist_id = create_playlist(
            name=name,
            user_id=user_id,
            scope="user",
            visibility="private",
            session=session,
        )
        if tracks:
            add_playlist_tracks(playlist_id, tracks, session=session)
    return playlist_id


def replace_subsonic_playlist(
    playlist_id: int,
    *,
    user_id: int,
    is_admin: bool,
    name: str | None,
    tracks: list[dict[str, Any]] | None,
) -> None:
    with transaction_scope() as session:
        _lock_owned_playlist(
            playlist_id, user_id=user_id, is_admin=is_admin, session=session
        )
        if name is not None:
            update_playlist(playlist_id, session=session, name=name)
        if tracks is not None:
            replace_playlist_tracks(playlist_id, tracks, session=session)


def update_subsonic_playlist(
    playlist_id: int,
    *,
    user_id: int,
    is_admin: bool,
    fields: dict[str, Any],
    remove_indexes: list[int],
    tracks_to_add: list[dict[str, Any]],
) -> None:
    with transaction_scope() as session:
        playlist = _lock_owned_playlist(
            playlist_id, user_id=user_id, is_admin=is_admin, session=session
        )
        removals = sorted(set(remove_indexes), reverse=True)
        current_tracks = get_playlist_tracks(playlist_id, session=session)
        if any(index < 0 or index >= len(current_tracks) for index in removals):
            raise PlaylistMutationError("invalid-index")

        if fields:
            update_playlist(playlist_id, session=session, **fields)
        for index in removals:
            remove_playlist_track(
                playlist_id,
                index + 1,
                session=session,
                record_exclusion=bool(playlist.get("is_smart")),
                excluded_by_user_id=user_id,
            )
        if tracks_to_add:
            add_playlist_tracks(playlist_id, tracks_to_add, session=session)


def delete_subsonic_playlist(playlist_id: int, *, user_id: int, is_admin: bool) -> None:
    with transaction_scope() as session:
        _lock_owned_playlist(
            playlist_id, user_id=user_id, is_admin=is_admin, session=session
        )
        if not delete_playlist(playlist_id, session=session):
            raise PlaylistMutationError("not-found")


def _lock_owned_playlist(
    playlist_id: int, *, user_id: int, is_admin: bool, session
) -> dict[str, Any]:
    if not lock_playlist(playlist_id, session=session):
        raise PlaylistMutationError("not-found")
    playlist = get_playlist(playlist_id, session=session)
    if playlist is None:
        raise PlaylistMutationError("not-found")
    if _is_read_only(playlist):
        raise PlaylistMutationError("not-authorized")
    owner_id = playlist.get("user_id")
    if not is_admin and (owner_id is None or int(owner_id) != user_id):
        raise PlaylistMutationError("not-authorized")
    return playlist


def _is_read_only(playlist: dict[str, Any]) -> bool:
    return bool(
        playlist.get("scope") == "system"
        or playlist.get("is_smart")
        or playlist.get("generation_mode") == "smart"
    )
