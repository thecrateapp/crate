"""Strict OpenSubsonic media projections and response serializers."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Mapping, Sequence

from pydantic import BaseModel, ConfigDict, Field

from crate.subsonic.global_ids import global_subsonic_id


class _Projection(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class MusicFolderProjection(_Projection):
    id: int
    name: str


class UserProjection(_Projection):
    username: str
    email: str
    admin_role: bool = Field(alias="adminRole")
    scrobbling_enabled: bool = Field(alias="scrobblingEnabled")
    settings_role: bool = Field(alias="settingsRole")
    download_role: bool = Field(alias="downloadRole")
    upload_role: bool = Field(alias="uploadRole")
    playlist_role: bool = Field(alias="playlistRole")
    cover_art_role: bool = Field(alias="coverArtRole")
    comment_role: bool = Field(alias="commentRole")
    podcast_role: bool = Field(alias="podcastRole")
    stream_role: bool = Field(alias="streamRole")
    jukebox_role: bool = Field(alias="jukeboxRole")
    share_role: bool = Field(alias="shareRole")


class ArtistProjection(_Projection):
    id: str
    name: str
    album_count: int = Field(alias="albumCount")
    cover_art: str | None = Field(default=None, alias="coverArt")


class ArtistIndexProjection(_Projection):
    name: str
    artist: list[ArtistProjection]


class ArtistsProjection(_Projection):
    ignored_articles: str = Field(alias="ignoredArticles")
    index: list[ArtistIndexProjection]


class AlbumProjection(_Projection):
    id: str
    name: str
    artist: str
    artist_id: str | None = Field(alias="artistId")
    year: int | None
    song_count: int = Field(alias="songCount")
    duration: int | float
    cover_art: str | None = Field(alias="coverArt")
    created: str | None = None


class SongProjection(_Projection):
    id: str
    parent: str | None = None
    is_dir: bool = Field(alias="isDir")
    title: str
    artist: str
    album: str
    album_id: str | None = Field(alias="albumId")
    artist_id: str | None = Field(alias="artistId")
    track: int
    disc_number: int = Field(alias="discNumber")
    year: int | None
    duration: int | float
    bit_rate: int = Field(alias="bitRate")
    suffix: str
    content_type: str = Field(alias="contentType")
    path: str
    cover_art: str | None = Field(alias="coverArt")
    type: Literal["music"]
    size: int | None = None
    created: str | None = None
    starred: str | None = None


class ArtistDetailProjection(ArtistProjection):
    album: list[AlbumProjection]


class AlbumDetailProjection(AlbumProjection):
    song: list[SongProjection]


def serialize_music_folders() -> dict[str, Any]:
    folder = MusicFolderProjection(id=1, name="Music")
    return {"musicFolder": [_dump(folder)]}


def serialize_user(user: Mapping[str, Any]) -> dict[str, Any]:
    projection = UserProjection(
        username=str(user.get("username") or user.get("email") or ""),
        email=str(user.get("email") or ""),
        adminRole=user.get("role") == "admin",
        scrobblingEnabled=True,
        settingsRole=True,
        downloadRole=True,
        uploadRole=False,
        playlistRole=True,
        coverArtRole=True,
        commentRole=False,
        podcastRole=False,
        streamRole=True,
        jukeboxRole=False,
        shareRole=True,
    )
    return _dump(projection)


def serialize_artist_indexes(artists: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[ArtistProjection]] = {}
    for artist in artists:
        name = str(artist.get("name") or "?")
        letter = name[0].upper()
        if not letter.isalpha():
            letter = "#"
        grouped.setdefault(letter, []).append(
            ArtistProjection(**_artist_fields(artist, name=name))
        )

    projection = ArtistsProjection(
        ignoredArticles="The El La Los Las",
        index=[
            ArtistIndexProjection(name=letter, artist=rows)
            for letter, rows in sorted(grouped.items())
        ],
    )
    return _dump(projection)


def serialize_artist(
    artist: Mapping[str, Any],
    *,
    albums: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    album_projections = [
        AlbumProjection.model_validate(serialize_album(album)) for album in albums
    ]
    return _dump(
        ArtistDetailProjection(
            **_artist_fields(
                artist,
                name=str(artist.get("name") or ""),
                album_count=len(album_projections),
            ),
            album=album_projections,
        )
    )


def serialize_album(
    album: Mapping[str, Any],
    *,
    songs: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    values = {
        "id": _album_id(album),
        "name": str(album.get("name") or ""),
        "artist": str(album.get("artist") or ""),
        "artistId": _artist_id_from_album(album),
        "year": _year(album.get("year")),
        "songCount": (
            len(songs)
            if songs is not None
            else _as_int(album.get("track_count"), default=0)
        ),
        "duration": album.get("duration") or 0,
        "coverArt": _album_id(album) if bool(album.get("has_cover")) else None,
    }
    if album.get("created") is not None:
        values["created"] = _date_string(album["created"])
    if songs is None:
        return _dump(AlbumProjection(**values))

    song_projections = [
        SongProjection.model_validate(serialize_song(song)) for song in songs
    ]
    return _dump(AlbumDetailProjection(**values, song=song_projections))


def serialize_song(song: Mapping[str, Any]) -> dict[str, Any]:
    album_id = _album_id_from_song(song)
    artist_id = _artist_id_from_song(song)
    audio_format = str(song.get("format") or "mp3").lower()
    title = str(song.get("title") or "")
    artist = str(song.get("artist") or "")
    album = str(song.get("album") or "")
    path = "/".join(part for part in (artist, album, title) if part)
    values: dict[str, Any] = {
        "id": _track_id(song),
        "parent": album_id,
        "isDir": False,
        "title": title,
        "artist": artist,
        "album": album,
        "albumId": album_id,
        "artistId": artist_id,
        "track": _as_int(song.get("track_number", song.get("track")), default=0),
        "discNumber": _as_int(song.get("disc_number", song.get("disc")), default=1),
        "year": _year(song.get("year")),
        "duration": song.get("duration") or 0,
        "bitRate": _as_int(song.get("bitrate"), default=0),
        "suffix": audio_format,
        "contentType": _content_type(audio_format),
        "path": path,
        "coverArt": album_id if album_id and bool(song.get("has_cover")) else None,
        "type": "music",
    }
    if song.get("size") is not None:
        values["size"] = _as_int(song["size"], default=0)
    if song.get("created") is not None:
        values["created"] = _date_string(song["created"])
    if song.get("starred"):
        values["starred"] = _date_string(song["starred"])
    return _dump(SongProjection(**values))


def _artist_id(artist: Mapping[str, Any]) -> str:
    return global_subsonic_id("artist", str(artist["global_artist_uid"]))


def _artist_fields(
    artist: Mapping[str, Any], *, name: str, album_count: int | None = None
) -> dict[str, Any]:
    values: dict[str, Any] = {
        "id": _artist_id(artist),
        "name": name,
        "albumCount": (
            _as_int(artist.get("album_count"), default=0)
            if album_count is None
            else album_count
        ),
    }
    if bool(artist.get("has_photo")):
        values["coverArt"] = _artist_id(artist)
    return values


def _album_id(album: Mapping[str, Any]) -> str:
    return global_subsonic_id("album", str(album["global_album_uid"]))


def _track_id(song: Mapping[str, Any]) -> str:
    return global_subsonic_id("track", str(song["global_track_uid"]))


def _artist_id_from_album(album: Mapping[str, Any]) -> str | None:
    uid = album.get("global_artist_uid")
    return global_subsonic_id("artist", str(uid)) if uid else None


def _album_id_from_song(song: Mapping[str, Any]) -> str | None:
    uid = song.get("global_album_uid")
    return global_subsonic_id("album", str(uid)) if uid else None


def _artist_id_from_song(song: Mapping[str, Any]) -> str | None:
    uid = song.get("global_artist_uid")
    return global_subsonic_id("artist", str(uid)) if uid else None


def _year(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 0 < year <= 9999 else None


def _as_int(value: Any, *, default: int) -> int:
    if isinstance(value, bool):
        return int(value)
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError, OverflowError):
        return default


def _date_string(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _content_type(audio_format: str | None) -> str:
    content_types = {
        "flac": "audio/flac",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "wav": "audio/wav",
        "opus": "audio/opus",
    }
    return content_types.get((audio_format or "mp3").lower(), "audio/mpeg")


def _dump(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(by_alias=True, exclude_unset=True)


__all__ = [
    "AlbumDetailProjection",
    "AlbumProjection",
    "ArtistDetailProjection",
    "ArtistIndexProjection",
    "ArtistProjection",
    "ArtistsProjection",
    "MusicFolderProjection",
    "SongProjection",
    "UserProjection",
    "serialize_album",
    "serialize_artist",
    "serialize_artist_indexes",
    "serialize_music_folders",
    "serialize_song",
    "serialize_user",
]
