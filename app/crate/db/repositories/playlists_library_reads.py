"""Listen library page reads: owned, shared and followed playlists in one transaction."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from crate.db.orm.playlist import Playlist, PlaylistMember, UserFollowedPlaylist
from crate.db.orm.user import User
from crate.db.repositories.playlists_collection_reads import (
    get_followed_system_playlists,
    get_playlists,
)
from crate.db.repositories.playlists_shared import (
    attach_artwork_tracks,
    playlist_to_dict,
)
from crate.db.tx import read_scope


def _followed_user_playlists(s: Session, user_id: int) -> list[dict]:
    rows = s.execute(
        select(Playlist, UserFollowedPlaylist.followed_at)
        .join(UserFollowedPlaylist, UserFollowedPlaylist.playlist_id == Playlist.id)
        .where(
            UserFollowedPlaylist.user_id == user_id,
            Playlist.scope == "user",
            Playlist.visibility == "public",
            Playlist.user_id != user_id,
            ~select(PlaylistMember.playlist_id)
            .where(
                PlaylistMember.playlist_id == Playlist.id,
                PlaylistMember.user_id == user_id,
            )
            .exists(),
        )
        .order_by(UserFollowedPlaylist.followed_at.desc())
    ).all()
    results: list[dict] = []
    for playlist_row, followed_at in rows:
        playlist = playlist_to_dict(playlist_row)
        playlist["is_followed"] = True
        playlist["followed_at"] = followed_at
        results.append(playlist)
    return attach_artwork_tracks(s, results)


def _attach_owners(s: Session, playlists: list[dict]) -> None:
    owner_ids = {int(p["user_id"]) for p in playlists if p.get("user_id") is not None}
    if not owner_ids:
        return
    owners = {
        row.id: row
        for row in s.execute(
            select(User.id, User.username, User.name).where(User.id.in_(owner_ids))
        ).all()
    }
    for playlist in playlists:
        owner = owners.get(playlist.get("user_id"))
        playlist["owner_username"] = owner.username if owner else None
        playlist["owner_name"] = owner.name if owner else None


def get_library_playlists_page(user_id: int, *, session: Session | None = None) -> dict:
    def _impl(s: Session) -> dict:
        playlists = get_playlists(user_id=user_id, session=s)
        followed_user = _followed_user_playlists(s, user_id)
        _attach_owners(s, playlists + followed_user)
        return {
            "playlists": playlists,
            "followed_playlists": followed_user,
            "followed_curated_playlists": get_followed_system_playlists(
                user_id, session=s
            ),
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)
