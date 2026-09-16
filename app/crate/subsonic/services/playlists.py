"""OpenSubsonic playlist operations backed by Crate's playlist repositories."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from crate.db.queries.subsonic_user_queries import get_user_by_username
from crate.db.repositories.playlists_collection_reads import (
    get_playlist as get_playlist_record,
    get_open_subsonic_playlists,
)
from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.repositories.playlists_membership_reads import (
    can_view_playlist,
    is_playlist_owner,
)
from crate.db.repositories.playlists_mutate import (
    delete_playlist as delete_playlist_record,
    lock_playlist,
    update_playlist as update_playlist_record,
)
from crate.db.repositories.playlists_create import (
    create_playlist as create_playlist_record,
)
from crate.db.repositories.playlists_tracks import (
    add_playlist_tracks,
    remove_playlist_track,
    replace_playlist_tracks,
)
from crate.db.tx import transaction_scope
from crate.playlist_covers import playlist_cover_abspath
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.global_ids import (
    SubsonicIdError,
    decode_subsonic_id,
    decode_subsonic_playlist_id,
    encode_subsonic_playlist_id,
)
from crate.subsonic.serializers import serialize_song
from crate.subsonic.services import catalog


def list_playlists(user: dict[str, Any], *, username: str | None = None) -> list[dict]:
    """Return playlists visible to the authenticated user or an admin target."""
    target = user
    if username:
        if user.get("role") != "admin":
            raise OpenSubsonicError(
                ErrorCode.NOT_AUTHORIZED, "Only administrators may select a user"
            )
        target = get_user_by_username(username)
        if target is None:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "User not found")

    return [
        _playlist_fields(playlist, target)
        for playlist in get_open_subsonic_playlists(
            user_id=int(target["id"]), is_admin=target.get("role") == "admin"
        )
    ]


def get_playlist(user: dict[str, Any], identifier: str) -> dict:
    playlist_id = _decode_playlist_id(identifier)
    playlist = get_playlist_record(playlist_id)
    if not _can_view(playlist, user):
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Playlist not found")
    assert playlist is not None
    tracks = get_playlist_tracks(playlist_id)
    result = _playlist_fields(playlist, user)
    result["songCount"] = len(tracks)
    result["duration"] = int(sum(float(track.get("duration") or 0) for track in tracks))
    result["entry"] = [serialize_song(track) for track in tracks]
    return result


def create_playlist(
    user: dict[str, Any],
    *,
    name: str | None = None,
    playlist_id: str | None = None,
    song_ids: list[str] | None = None,
) -> dict:
    tracks = _resolve_song_ids(song_ids or [])
    if playlist_id is None:
        if not name or not name.strip():
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Playlist name is required"
            )
        with transaction_scope() as session:
            new_id = create_playlist_record(
                name=name.strip(),
                user_id=int(user["id"]),
                scope="user",
                visibility="private",
                session=session,
            )
            if tracks:
                add_playlist_tracks(new_id, tracks, session=session)
        return get_playlist(user, encode_subsonic_playlist_id(new_id))

    target_id = _decode_playlist_id(playlist_id)
    with transaction_scope() as session:
        playlist = _lock_and_get_playlist(target_id, session)
        _require_owner(playlist, user)
        if name is not None:
            if not name.strip():
                raise OpenSubsonicError(
                    ErrorCode.MISSING_PARAMETER, "Playlist name cannot be empty"
                )
            update_playlist_record(target_id, session=session, name=name.strip())
        if song_ids is not None:
            replace_playlist_tracks(target_id, tracks, session=session)
    return get_playlist(user, encode_subsonic_playlist_id(target_id))


def update_playlist(
    user: dict[str, Any],
    identifier: str,
    *,
    name: str | None = None,
    comment: str | None = None,
    public: bool | None = None,
    song_ids_to_add: list[str] | None = None,
    song_indexes_to_remove: list[int] | None = None,
) -> None:
    playlist_id = _decode_playlist_id(identifier)
    tracks = _resolve_song_ids(song_ids_to_add or [])
    with transaction_scope() as session:
        playlist = _lock_and_get_playlist(playlist_id, session)
        _require_owner(playlist, user)

        removals = sorted(set(song_indexes_to_remove or []), reverse=True)
        current_tracks = get_playlist_tracks(playlist_id, session=session)
        if any(index < 0 or index >= len(current_tracks) for index in removals):
            raise OpenSubsonicError(
                ErrorCode.NOT_FOUND, "Playlist song index not found"
            )

        fields: dict[str, Any] = {}
        if name is not None:
            if not name.strip():
                raise OpenSubsonicError(
                    ErrorCode.MISSING_PARAMETER, "Playlist name cannot be empty"
                )
            fields["name"] = name.strip()
        if comment is not None:
            fields["description"] = comment
        if public is not None:
            fields["visibility"] = "public" if public else "private"
        if fields:
            update_playlist_record(playlist_id, session=session, **fields)

        for index in removals:
            # OpenSubsonic indices are zero-based; Crate stores positions from 1.
            remove_playlist_track(
                playlist_id,
                index + 1,
                session=session,
                record_exclusion=bool(playlist.get("is_smart")),
                excluded_by_user_id=int(user["id"]),
            )
        if tracks:
            add_playlist_tracks(playlist_id, tracks, session=session)


def delete_playlist(user: dict[str, Any], identifier: str) -> None:
    playlist_id = _decode_playlist_id(identifier)
    with transaction_scope() as session:
        playlist = _lock_and_get_playlist(playlist_id, session)
        _require_owner(playlist, user)
        if not delete_playlist_record(playlist_id, session=session):
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Playlist not found")


def _resolve_song_ids(song_ids: list[str]) -> list[dict[str, Any]]:
    result = []
    for identifier in song_ids:
        try:
            entity_id = decode_subsonic_id(identifier, expected_kind="track")
            song = catalog.song_detail(identifier)
        except (SubsonicIdError, ValueError) as error:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Song not found") from error
        if song is None:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Song not found")
        if entity_id.scope == "global":
            result.append(
                {"global_track_uid": entity_id.global_uid, "source": "manual"}
            )
        else:
            result.append({"track_id": entity_id.local_id, "source": "manual"})
    return result


def _lock_and_get_playlist(playlist_id: int, session) -> dict:
    if not lock_playlist(playlist_id, session=session):
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Playlist not found")
    playlist = get_playlist_record(playlist_id, session=session)
    if playlist is None:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Playlist not found")
    return playlist


def _require_owner(playlist: dict, user: dict[str, Any]) -> None:
    if _is_read_only(playlist):
        raise OpenSubsonicError(ErrorCode.NOT_AUTHORIZED, "Playlist is read-only")
    if user.get("role") != "admin" and not is_playlist_owner(playlist, int(user["id"])):
        raise OpenSubsonicError(ErrorCode.NOT_AUTHORIZED, "Playlist is read-only")


def _can_view(playlist: dict | None, user: dict[str, Any]) -> bool:
    return bool(
        playlist
        and (
            user.get("role") == "admin" or can_view_playlist(playlist, int(user["id"]))
        )
    )


def _playlist_fields(playlist: dict, user: dict[str, Any]) -> dict[str, Any]:
    playlist_id = int(playlist["id"])
    owner_id = playlist.get("user_id")
    created = _date_value(playlist.get("created_at"))
    updated = _date_value(playlist.get("updated_at"))
    cover_path = playlist_cover_abspath(playlist.get("cover_path"))
    can_edit = not _is_read_only(playlist) and (
        user.get("role") == "admin"
        or (owner_id is not None and int(owner_id) == int(user["id"]))
    )
    result: dict[str, Any] = {
        "id": encode_subsonic_playlist_id(playlist_id),
        "name": str(playlist.get("name") or ""),
        "comment": str(playlist.get("description") or ""),
        "public": playlist.get("scope") == "system"
        or playlist.get("visibility") == "public",
        "songCount": int(playlist.get("track_count") or 0),
        "duration": int(float(playlist.get("total_duration") or 0)),
        "readonly": not can_edit,
    }
    if created is not None:
        result["created"] = created
    if updated is not None:
        result["changed"] = updated
    if cover_path is not None and cover_path.is_file():
        result["coverArt"] = encode_subsonic_playlist_id(playlist_id)
    if owner_id is None:
        result["owner"] = "Crate"
    elif int(owner_id) == int(user["id"]):
        result["owner"] = str(user.get("username") or user.get("email") or "")
    return result


def _date_value(value: Any) -> str | None:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value) if value else None


def _is_read_only(playlist: dict) -> bool:
    return bool(
        playlist.get("scope") == "system"
        or playlist.get("is_smart")
        or playlist.get("generation_mode") == "smart"
    )


def _decode_playlist_id(identifier: str) -> int:
    try:
        return decode_subsonic_playlist_id(identifier)
    except SubsonicIdError as error:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Playlist not found") from error


__all__ = [
    "create_playlist",
    "delete_playlist",
    "get_playlist",
    "list_playlists",
    "update_playlist",
]
