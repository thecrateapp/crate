"""Catalog lookups and OpenSubsonic media projections."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode, urlsplit

from crate.db.queries.global_catalog import list_global_catalog_genres
from crate.db.queries.subsonic_track_queries import get_track_full
from crate.db.queries.subsonic_global import (
    get_global_album,
    get_global_album_metadata,
    get_global_album_by_local_id,
    get_global_artist_metadata,
    get_global_artist,
    get_global_artist_by_local_id,
    get_global_artists_by_names,
    get_global_catalog_last_modified,
    get_global_track,
    get_global_track_by_local_id,
    list_global_album_tracks,
    list_global_artist_albums,
    list_global_artists,
    search_global_catalog,
)
from crate.subsonic.global_ids import (
    EntityKind,
    SubsonicIdError,
    SubsonicEntityId,
    decode_subsonic_id,
    global_subsonic_id,
)
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


def search_catalog(
    query: str | None,
    *,
    artist_count: int = 20,
    artist_offset: int = 0,
    album_count: int = 20,
    album_offset: int = 0,
    song_count: int = 20,
    song_offset: int = 0,
    music_folder_id: str | None = None,
    artist_query: str | None = None,
    album_query: str | None = None,
    song_query: str | None = None,
    any_query: str | None = None,
    newer_than_ms: int | None = None,
    version: int = 3,
) -> dict[str, Any]:
    matches = search_global_catalog(
        query,
        artist_limit=artist_count,
        artist_offset=artist_offset,
        album_limit=album_count,
        album_offset=album_offset,
        track_limit=song_count,
        track_offset=song_offset,
        music_folder_id=music_folder_id,
        artist_query=artist_query,
        album_query=album_query,
        song_query=song_query,
        any_query=any_query,
        newer_than_ms=newer_than_ms,
        include_track_total=version == 1,
    )
    artists = [_search_artist(row) for row in matches["artists"]]
    albums = [serialize_album(row) for row in matches["albums"]]
    songs = [serialize_song(row) for row in matches["tracks"]]

    if version == 1:
        return {
            "match": songs,
            "offset": max(int(song_offset), 0),
            "totalHits": int(matches.get("track_total", len(songs))),
        }
    if version == 2:
        return {
            "artist": artists,
            "album": [_album_search_child(album) for album in albums],
            "song": songs,
        }
    if version == 3:
        return {"artist": artists, "album": albums, "song": songs}
    raise ValueError(f"Unsupported OpenSubsonic search version: {version}")


def _album_search_child(album: dict[str, Any]) -> dict[str, Any]:
    values = {
        "id": album["id"],
        "parent": album.get("artistId"),
        "isDir": True,
        "title": album["name"],
        "album": album["name"],
        "name": album["name"],
        "artist": album["artist"],
        "artistId": album.get("artistId"),
        "year": album.get("year"),
        "songCount": album["songCount"],
        "duration": album["duration"],
        "coverArt": album.get("coverArt"),
        "created": album.get("created"),
        "type": "music",
    }
    return {key: value for key, value in values.items() if value is not None}


def _search_artist(artist: dict[str, Any]) -> dict[str, Any]:
    identifier = global_subsonic_id("artist", str(artist["global_artist_uid"]))
    result: dict[str, Any] = {
        "id": identifier,
        "name": str(artist.get("name") or ""),
        "albumCount": int(artist.get("album_count") or 0),
    }
    if artist.get("has_photo"):
        result["coverArt"] = identifier
    return result


def artist_metadata(
    identifier: str,
    *,
    request,
    count: int = 20,
    include_not_present: bool = False,
) -> dict[str, Any] | None:
    artist_uid = _artist_uid_from_identifier(identifier)
    if artist_uid is None:
        return None
    metadata = get_global_artist_metadata(artist_uid)
    if metadata is None:
        return None

    result: dict[str, Any] = {}
    if metadata.get("biography") is not None:
        result["biography"] = str(metadata["biography"])
    musicbrainz_id = str(metadata.get("musicbrainz_id") or "").strip()
    if musicbrainz_id:
        result["musicBrainzId"] = musicbrainz_id
    urls = metadata.get("urls_json")
    lastfm_url = _lastfm_url(urls)
    if lastfm_url:
        result["lastFmUrl"] = lastfm_url

    artist_id = global_subsonic_id("artist", artist_uid)
    if metadata.get("has_photo"):
        result.update(_image_urls(request, artist_id))

    similar = metadata.get("similar_json")
    if isinstance(similar, list):
        names = _similar_artist_names(similar)
        candidates = get_global_artists_by_names(
            names,
            include_not_present=include_not_present,
            limit=min(max(int(count), 0), 100),
        )
        by_name = {str(item["name"]).casefold(): item for item in candidates}
        similar_artists = []
        for name in names:
            candidate = by_name.get(name.casefold())
            if candidate is None:
                continue
            projected: dict[str, Any] = {
                "id": global_subsonic_id("artist", str(candidate["global_artist_uid"])),
                "name": str(candidate["name"]),
            }
            if candidate.get("has_photo"):
                projected["coverArt"] = projected["id"]
            similar_artists.append(projected)
        result["similarArtist"] = similar_artists
    return result


def album_metadata(identifier: str, *, request) -> dict[str, Any] | None:
    album_uid = _album_uid_from_identifier(identifier)
    if album_uid is None:
        return None
    metadata = get_global_album_metadata(album_uid)
    if metadata is None:
        return None

    result: dict[str, Any] = {}
    musicbrainz_id = str(metadata.get("musicbrainz_id") or "").strip()
    if musicbrainz_id:
        result["musicBrainzId"] = musicbrainz_id
    if metadata.get("has_cover"):
        album_id = global_subsonic_id("album", album_uid)
        result.update(_image_urls(request, album_id))
    return result


def _entity_kind(identifier: str) -> EntityKind:
    if identifier.startswith(("ga-", "ar-")):
        return "artist"
    if identifier.startswith(("gal-", "al-")):
        return "album"
    return "track"


def _artist_uid_from_identifier(identifier: str) -> str | None:
    try:
        kind = _entity_kind(identifier)
        entity_id = decode_subsonic_id(identifier, expected_kind=kind)
    except SubsonicIdError:
        return None

    if kind == "artist":
        artist = (
            get_global_artist(str(entity_id.global_uid))
            if entity_id.scope == "global"
            else get_global_artist_by_local_id(int(entity_id.local_id or 0))
        )
        return str(artist["global_artist_uid"]) if artist else None

    if kind == "album":
        album = (
            get_global_album(str(entity_id.global_uid))
            if entity_id.scope == "global"
            else get_global_album_by_local_id(int(entity_id.local_id or 0))
        )
        return str(album["global_artist_uid"]) if album else None

    song = (
        get_global_track(str(entity_id.global_uid))
        if entity_id.scope == "global"
        else get_global_track_by_local_id(int(entity_id.local_id or 0))
    )
    return str(song["global_artist_uid"]) if song else None


def _album_uid_from_identifier(identifier: str) -> str | None:
    try:
        kind = _entity_kind(identifier)
        entity_id = decode_subsonic_id(identifier, expected_kind=kind)
    except SubsonicIdError:
        return None

    if kind == "album":
        album = (
            get_global_album(str(entity_id.global_uid))
            if entity_id.scope == "global"
            else get_global_album_by_local_id(int(entity_id.local_id or 0))
        )
        return str(album["global_album_uid"]) if album else None
    if kind != "track":
        return None
    song = (
        get_global_track(str(entity_id.global_uid))
        if entity_id.scope == "global"
        else get_global_track_by_local_id(int(entity_id.local_id or 0))
    )
    album_uid = song.get("global_album_uid") if song else None
    return str(album_uid) if album_uid else None


def _image_urls(request, identifier: str) -> dict[str, str]:
    endpoint = str(request.url_for("get_cover_art"))
    return {
        field: f"{endpoint}?{urlencode({'id': identifier, 'size': size})}"
        for field, size in (
            ("smallImageUrl", 34),
            ("mediumImageUrl", 64),
            ("largeImageUrl", 174),
        )
    }


def _lastfm_url(urls: Any) -> str | None:
    if not isinstance(urls, dict):
        return None
    value = next(
        (
            urls[key]
            for key in ("lastfm", "last_fm", "lastFmUrl", "lastfm_url")
            if urls.get(key)
        ),
        None,
    )
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    return value if parsed.scheme in {"http", "https"} and parsed.netloc else None


def _similar_artist_names(values: list[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        name = (
            str(value.get("name") or "").strip()
            if isinstance(value, dict)
            else str(value).strip()
        )
        key = name.casefold()
        if name and key not in seen:
            seen.add(key)
            result.append(name)
    return result


def artist_indexes() -> dict[str, Any]:
    return serialize_artist_indexes(list_global_artists())


def index_last_modified() -> int:
    return get_global_catalog_last_modified()


def genres() -> list[dict[str, Any]]:
    return [
        {
            "value": str(genre.get("canonical_name") or ""),
            "songCount": int(genre.get("track_count") or 0),
            "albumCount": int(genre.get("album_count") or 0),
        }
        for genre in list_global_catalog_genres()
        if genre.get("canonical_name")
    ]


def music_directory(identifier: str) -> dict[str, Any] | None:
    if identifier == "1":
        children = []
        for artist in list_global_artists():
            artist_id = global_artist_id(str(artist["global_artist_uid"]))
            child: dict[str, Any] = {
                "id": artist_id,
                "parent": "1",
                "isDir": True,
                "title": str(artist.get("name") or ""),
                "artist": str(artist.get("name") or ""),
                "artistId": artist_id,
                "albumCount": int(artist.get("album_count") or 0),
            }
            if artist.get("has_photo"):
                child["coverArt"] = artist_id
            children.append(child)
        return {"id": "1", "name": "Music", "child": children}

    if identifier.startswith(("ga-", "ar-")):
        decode_subsonic_id(identifier, expected_kind="artist")
        artist = artist_detail(identifier)
        if artist is None:
            return None
        children = []
        for album in artist["album"]:
            child = {
                "id": album["id"],
                "parent": identifier,
                "isDir": True,
                "title": album["name"],
                "artist": album["artist"],
                "artistId": album.get("artistId"),
                "album": album["name"],
                "year": album.get("year"),
                "coverArt": album.get("coverArt"),
            }
            children.append(child)
        return {"id": identifier, "name": artist["name"], "child": children}

    if identifier.startswith(("gal-", "al-")):
        decode_subsonic_id(identifier, expected_kind="album")
        album = album_detail(identifier)
        if album is None:
            return None
        return {
            "id": identifier,
            "parent": album.get("artistId"),
            "name": album["name"],
            "child": album["song"],
        }
    return None


def global_artist_id(global_artist_uid: str) -> str:
    return global_subsonic_id("artist", global_artist_uid)


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
        local_track_id = int(entity_id.local_id or 0)
        song = get_global_track_by_local_id(local_track_id)
        if song is None:
            song = get_track_full(local_track_id)
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
    "genres",
    "global_artist_id",
    "index_last_modified",
    "music_directory",
    "music_folders",
    "song_detail",
    "user_profile",
]
