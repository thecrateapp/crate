"""Compatibility facade for playlist write helpers."""

from __future__ import annotations

from crate.db.repositories.playlists_crud import (
    create_playlist,
    delete_playlist,
    duplicate_playlist,
    update_playlist,
)
from crate.db.repositories.playlists_follows import (
    add_playlist_member,
    follow_playlist,
    remove_playlist_member,
    unfollow_playlist,
)
from crate.db.repositories.playlists_invites import (
    consume_playlist_invite,
    create_playlist_invite,
)
from crate.db.repositories.playlists_tracks import (
    add_playlist_tracks,
    regenerate_playlist_tracks,
    remove_playlist_track,
    replace_playlist_tracks,
    reorder_playlist,
    set_playlist_track_lock,
)

__all__ = [
    "add_playlist_member",
    "add_playlist_tracks",
    "consume_playlist_invite",
    "create_playlist",
    "create_playlist_invite",
    "delete_playlist",
    "duplicate_playlist",
    "follow_playlist",
    "regenerate_playlist_tracks",
    "remove_playlist_member",
    "remove_playlist_track",
    "replace_playlist_tracks",
    "reorder_playlist",
    "set_playlist_track_lock",
    "unfollow_playlist",
    "update_playlist",
]
