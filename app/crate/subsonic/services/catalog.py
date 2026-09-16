"""Catalog lookups and OpenSubsonic media projections."""

from __future__ import annotations

from typing import Any

from crate.db.queries.subsonic_global import (
    get_global_album,
    get_global_album_by_local_id,
    get_global_artist,
    get_global_artist_by_local_id,
    get_global_track,
    get_global_track_by_local_id,
    list_global_album_tracks,
    list_global_artist_albums,
    list_global_artists,
)
from crate.subsonic.global_ids import SubsonicEntityId, decode_subsonic_id
from crate.subsonic.serializers import (
    serialize_album,
    serialize_artist,
    serialize_artist_indexes,
    serialize_music_folders,
    serialize_song,
    serialize_user,
)


def music_folders() -> dict[str, Any]:
    return serialize_music_folders()


def user_profile(user: dict[str, Any]) -> dict[str, Any]:
    return serialize_user(user)


def artist_indexes() -> dict[str, Any]:
    return serialize_artist_indexes(list_global_artists())


def artist_detail(identifier: str) -> dict[str, Any] | None:
    entity_id = decode_subsonic_id(identifier, expected_kind="artist")
    artist, albums = _artist_and_albums(entity_id)
    if artist is None:
        return None
    return serialize_artist(artist, albums=albums)


def album_detail(identifier: str) -> dict[str, Any] | None:
    entity_id = decode_subsonic_id(identifier, expected_kind="album")
    if entity_id.scope == "global":
        album = get_global_album(str(entity_id.global_uid))
    else:
        album = get_global_album_by_local_id(int(entity_id.local_id or 0))
    if album is None:
        return None
    return serialize_album(
        album,
        songs=list_global_album_tracks(str(album["global_album_uid"])),
    )


def song_detail(identifier: str) -> dict[str, Any] | None:
    entity_id = decode_subsonic_id(identifier, expected_kind="track")
    if entity_id.scope == "global":
        song = get_global_track(str(entity_id.global_uid))
    else:
        song = get_global_track_by_local_id(int(entity_id.local_id or 0))
    return serialize_song(song) if song else None


def _artist_and_albums(
    entity_id: SubsonicEntityId,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    if entity_id.scope == "global":
        artist = get_global_artist(str(entity_id.global_uid))
    else:
        artist = get_global_artist_by_local_id(int(entity_id.local_id or 0))
    if artist is None:
        return None, []
    return artist, list_global_artist_albums(str(artist["global_artist_uid"]))


__all__ = [
    "album_detail",
    "artist_detail",
    "artist_indexes",
    "music_folders",
    "song_detail",
    "user_profile",
]
