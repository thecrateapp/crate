"""Membership and permission read helpers for playlists."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from crate.db.orm.playlist import PlaylistMember
from crate.db.orm.user import User
from crate.db.tx import read_scope


def get_playlist_members(
    playlist_id: int, *, session: Session | None = None
) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = (
            s.execute(
                select(
                    PlaylistMember.playlist_id,
                    PlaylistMember.user_id,
                    PlaylistMember.role,
                    PlaylistMember.invited_by,
                    PlaylistMember.created_at,
                    User.username,
                    User.name.label("display_name"),
                    User.avatar,
                )
                .join(User, User.id == PlaylistMember.user_id)
                .where(PlaylistMember.playlist_id == playlist_id)
                .order_by(
                    (PlaylistMember.role == "owner").desc(),
                    PlaylistMember.created_at.asc(),
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_playlist_member(
    playlist_id: int, user_id: int, *, session: Session | None = None
) -> dict | None:
    def _impl(s: Session) -> dict | None:
        member = s.get(PlaylistMember, {"playlist_id": playlist_id, "user_id": user_id})
        if member is None:
            return None
        return {
            "playlist_id": member.playlist_id,
            "user_id": member.user_id,
            "role": member.role,
            "invited_by": member.invited_by,
            "created_at": member.created_at,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def can_view_playlist(
    playlist: dict | None, user_id: int | None, *, session: Session | None = None
) -> bool:
    if not playlist:
        return False
    if playlist.get("scope") == "system":
        return True
    if playlist.get("visibility") == "public":
        return True
    if user_id is None:
        return False
    if playlist.get("user_id") == user_id:
        return True
    return (
        get_playlist_member(int(playlist["id"]), user_id, session=session) is not None
    )


def get_playlist_access(
    playlist: dict | None, user_id: int | None, *, session: Session | None = None
) -> str:
    """Viewer access: owner, collaborator, public or none."""
    if not playlist:
        return "none"
    if playlist.get("scope") == "system":
        return "public"
    if user_id is not None and playlist.get("user_id") == user_id:
        return "owner"
    if user_id is not None and playlist.get("is_collaborative"):
        member = get_playlist_member(int(playlist["id"]), user_id, session=session)
        if member and member.get("role") in {"owner", "collab"}:
            return "collaborator"
    if playlist.get("visibility") == "public":
        return "public"
    if user_id is not None and get_playlist_member(
        int(playlist["id"]), user_id, session=session
    ):
        return "public"
    return "none"


def can_edit_playlist(
    playlist: dict | None, user_id: int | None, *, session: Session | None = None
) -> bool:
    return get_playlist_access(playlist, user_id, session=session) in {
        "owner",
        "collaborator",
    }


def is_playlist_owner(
    playlist: dict | None, user_id: int | None, *, session: Session | None = None
) -> bool:
    if not playlist or user_id is None or playlist.get("scope") == "system":
        return False
    return playlist.get("user_id") == user_id


__all__ = [
    "get_playlist_access",
    "can_edit_playlist",
    "can_view_playlist",
    "get_playlist_member",
    "get_playlist_members",
    "is_playlist_owner",
]
