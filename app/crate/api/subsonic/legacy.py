"""Subsonic API compatible endpoints.

Allows third-party music players (Symfonium, DSub, play:Sub, Ultrasonic, etc.)
to browse, search, and stream from the Crate library.

Spec: http://www.subsonic.org/pages/api.jsp
"""

import hashlib
import logging
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from crate.db.queries.subsonic_global import (
    get_global_track,
    get_global_tracks_by_genre,
    get_random_global_tracks,
    get_starred_global_tracks,
    list_global_albums,
    search_global_catalog,
)
from crate.db.queries.subsonic_track_queries import (
    get_track_full,
    get_track_path_and_format,
)
from crate.subsonic.global_ids import (
    EntityKind,
    SubsonicEntityId,
    SubsonicIdError,
    decode_subsonic_id,
    decode_subsonic_playlist_id,
    global_subsonic_id,
)
from crate.subsonic.services import catalog
from crate.subsonic.services.artwork import serve_playlist_cover
from crate.subsonic.serializers import serialize_album, serialize_song
from crate.api._deps import library_path
from crate.api.schemas.subsonic import (
    SubsonicAlbumListResponse,
    SubsonicAlbumList2Response,
    SubsonicAlbumResponse,
    SubsonicArtistResponse,
    SubsonicArtistsResponse,
    SubsonicLicenseResponse,
    SubsonicDirectoryResponse,
    SubsonicGenresResponse,
    SubsonicIndexesResponse,
    SubsonicMusicFoldersResponse,
    SubsonicOkResponse,
    SubsonicPlaylistsResponse,
    SubsonicRandomSongsResponse,
    SubsonicSongsResponse,
    SubsonicSearchResult3Response,
    SubsonicSongResponse,
    SubsonicStarred2Response,
    SubsonicUserResponse,
)

log = logging.getLogger(__name__)

SUBSONIC_API_VERSION = "1.16.1"
SERVER_NAME = "Crate"


def _subsonic_docs_params(
    username: str = Query("", alias="u", description="Subsonic username or email."),
    password: str = Query(
        "",
        alias="p",
        description="Plain password, or `enc:` plus a UTF-8 hex payload. Use either `p` or `t` + `s`.",
    ),
    token: str = Query(
        "", alias="t", description="MD5 token used for Subsonic token authentication."
    ),
    salt: str = Query("", alias="s", description="Random salt paired with `t`."),
    version: str = Query(
        SUBSONIC_API_VERSION, alias="v", description="Requested Subsonic API version."
    ),
    client: str = Query("crate-docs", alias="c", description="Client identifier."),
    response_format: str = Query(
        "json",
        alias="f",
        description="Requested response format. Crate currently responds with JSON.",
    ),
) -> None:
    del username, password, token, salt, version, client, response_format


router = APIRouter(
    prefix="/rest", tags=["subsonic"], dependencies=[Depends(_subsonic_docs_params)]
)


# ── Auth ────────────────────────────────────────────────────────


def _subsonic_auth(request: Request) -> dict | None:
    """Authenticate using the dedicated OpenSubsonic credential mechanisms."""
    from crate.subsonic.auth import authenticate
    from crate.subsonic.errors import OpenSubsonicError
    from crate.subsonic.params import RequestParameters

    grouped: defaultdict[str, list[str]] = defaultdict(list)
    for name, value in request.query_params.multi_items():
        grouped[name].append(value)
    try:
        return authenticate(
            RequestParameters({name: tuple(values) for name, values in grouped.items()})
        )
    except OpenSubsonicError as error:
        raise SubsonicAuthError(error.code, error.message) from error


def _subsonic_response(data: dict, status: str = "ok") -> JSONResponse:
    """Wrap response in Subsonic format."""
    return JSONResponse(
        {
            "subsonic-response": {
                "status": status,
                "version": SUBSONIC_API_VERSION,
                "type": SERVER_NAME,
                "serverVersion": "0.1.0",
                **data,
            }
        }
    )


def _subsonic_error(code: int, message: str) -> JSONResponse:
    return _subsonic_response(
        {"error": {"code": code, "message": message}}, status="failed"
    )


def _require_subsonic_auth(request: Request) -> dict:
    user = _subsonic_auth(request)
    if not user:
        raise SubsonicAuthError()
    return user


class SubsonicAuthError(Exception):
    def __init__(self, code: int = 40, message: str = "Wrong username or password"):
        super().__init__(message)
        self.code = code
        self.message = message


def _subsonic_auth_error_response(error: SubsonicAuthError) -> JSONResponse:
    return _subsonic_error(error.code, error.message)


def _decode_entity_id(value: str, kind: EntityKind) -> SubsonicEntityId | None:
    try:
        return decode_subsonic_id(value, expected_kind=kind)
    except SubsonicIdError:
        return None


def _global_album_payload(album: dict) -> dict:
    return serialize_album(album)


def _global_song_payload(track: dict) -> dict:
    return serialize_song(track)


# ── System ──────────────────────────────────────────────────────


@router.get("/ping", response_model=SubsonicOkResponse, summary="Ping the Subsonic API")
@router.get("/ping.view", include_in_schema=False)
def ping(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({})


@router.get(
    "/getLicense",
    response_model=SubsonicLicenseResponse,
    summary="Get the Subsonic license status",
)
@router.get("/getLicense.view", include_in_schema=False)
def get_license(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response(
        {
            "license": {
                "valid": True,
                "email": "crate@local",
                "licenseExpires": "2099-12-31T00:00:00",
            }
        }
    )


@router.get(
    "/getMusicFolders",
    response_model=SubsonicMusicFoldersResponse,
    summary="List available Subsonic music folders",
)
@router.get("/getMusicFolders.view", include_in_schema=False)
def get_music_folders(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"musicFolders": catalog.music_folders()})


@router.get(
    "/getUser",
    response_model=SubsonicUserResponse,
    summary="Fetch a Subsonic user profile",
)
@router.get("/getUser.view", include_in_schema=False)
def get_user(request: Request, username: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"user": catalog.user_profile(user)})


# ── Browse ──────────────────────────────────────────────────────


@router.get(
    "/getIndexes",
    response_model=SubsonicIndexesResponse,
    summary="Browse artists grouped by index letter",
)
@router.get("/getIndexes.view", include_in_schema=False)
def get_indexes(
    request: Request,
    musicFolderId: str | None = Query(None),
    ifModifiedSince: int | None = Query(None, ge=0),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if not _valid_music_folder(musicFolderId):
        return _subsonic_error(0, "Invalid musicFolderId")
    last_modified = catalog.index_last_modified()
    indexes = {
        "ignoredArticles": "The El La Los Las",
        "lastModified": last_modified,
    }
    if ifModifiedSince is None or ifModifiedSince < last_modified:
        indexes.update(catalog.artist_indexes())
    return _subsonic_response({"indexes": indexes})


@router.get(
    "/getMusicDirectory",
    response_model=SubsonicDirectoryResponse,
    summary="Browse the contents of a music directory",
)
@router.get("/getMusicDirectory.view", include_in_schema=False)
def get_music_directory(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if not id:
        return _subsonic_error(70, "Music directory not found")
    try:
        directory = catalog.music_directory(id)
    except SubsonicIdError:
        directory = None
    if directory is None:
        return _subsonic_error(70, "Music directory not found")
    return _subsonic_response({"directory": directory})


@router.get(
    "/getGenres",
    response_model=SubsonicGenresResponse,
    summary="List genres with album and song counts",
)
@router.get("/getGenres.view", include_in_schema=False)
def get_genres(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"genres": {"genre": catalog.genres()}})


@router.get(
    "/getSongsByGenre",
    response_model=SubsonicSongsResponse,
    summary="List songs matching a genre",
)
@router.get("/getSongsByGenre.view", include_in_schema=False)
def get_songs_by_genre(
    request: Request,
    genre: str = Query(""),
    count: int = Query(10, ge=0, le=500),
    offset: int = Query(0, ge=0),
    musicFolderId: str | None = Query(None),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if not genre.strip():
        return _subsonic_error(0, "genre is required")
    if not _valid_music_folder(musicFolderId):
        return _subsonic_error(0, "Invalid musicFolderId")
    tracks = get_global_tracks_by_genre(
        genre.strip(), size=count, offset=offset, music_folder_id=musicFolderId
    )
    return _subsonic_response(
        {"songs": {"song": [_global_song_payload(track) for track in tracks]}}
    )


@router.get(
    "/getArtists",
    response_model=SubsonicArtistsResponse,
    response_model_exclude_unset=True,
    summary="Browse artists grouped by index letter",
)
@router.get("/getArtists.view", include_in_schema=False)
def get_artists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    return _subsonic_response({"artists": catalog.artist_indexes()})


@router.get(
    "/getArtist",
    response_model=SubsonicArtistResponse,
    response_model_exclude_unset=True,
    summary="Fetch a Subsonic artist with albums",
)
@router.get("/getArtist.view", include_in_schema=False)
def get_artist(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    try:
        artist = catalog.artist_detail(id)
    except SubsonicIdError:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if not artist:
        return _subsonic_error(70, "Artist not found")
    return _subsonic_response({"artist": artist})


@router.get(
    "/getAlbum",
    response_model=SubsonicAlbumResponse,
    summary="Fetch a Subsonic album with songs",
)
@router.get("/getAlbum.view", include_in_schema=False)
def get_album(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    try:
        album = catalog.album_detail(id)
    except SubsonicIdError:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if not album:
        return _subsonic_error(70, "Album not found")
    return _subsonic_response({"album": album})


@router.get(
    "/getSong",
    response_model=SubsonicSongResponse,
    summary="Fetch a single Subsonic song",
)
@router.get("/getSong.view", include_in_schema=False)
def get_song(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    try:
        song = catalog.song_detail(id)
    except SubsonicIdError:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if not song:
        return _subsonic_error(70, "Song not found")
    return _subsonic_response({"song": song})


# ── Album Lists ─────────────────────────────────────────────────


_ALBUM_LIST_TYPES = {
    "random",
    "newest",
    "highest",
    "frequent",
    "recent",
    "alphabeticalByName",
    "alphabeticalByArtist",
    "starred",
    "byYear",
    "byGenre",
}


def _valid_music_folder(music_folder_id: str | None) -> bool:
    return music_folder_id is None or music_folder_id == "1"


def _album_list(
    request: Request,
    *,
    list_type: str,
    size: int,
    offset: int,
    from_year: int | None,
    to_year: int | None,
    genre: str | None,
    music_folder_id: str | None,
):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if list_type not in _ALBUM_LIST_TYPES:
        return _subsonic_error(0, "Unsupported album list type")
    if not _valid_music_folder(music_folder_id):
        return _subsonic_error(0, "Invalid musicFolderId")
    if list_type == "byYear" and (from_year is None or to_year is None):
        return _subsonic_error(0, "fromYear and toYear are required for byYear")
    if list_type == "byGenre" and not (genre or "").strip():
        return _subsonic_error(0, "genre is required for byGenre")

    albums = list_global_albums(
        list_type,
        size=size,
        offset=offset,
        from_year=from_year,
        to_year=to_year,
        genre=genre.strip() if genre else None,
        user_id=int(user["id"]),
        music_folder_id=music_folder_id,
    )
    return albums


def _legacy_album_payload(album: dict) -> dict:
    serialized = _global_album_payload(album)
    return {
        "id": serialized["id"],
        "parent": serialized.get("artistId"),
        "isDir": True,
        "title": str(album.get("name") or ""),
        "artist": str(album.get("artist") or ""),
        "artistId": serialized.get("artistId"),
        "album": str(album.get("name") or ""),
        "year": serialized.get("year"),
        "coverArt": serialized.get("coverArt"),
    }


@router.get(
    "/getAlbumList",
    response_model=SubsonicAlbumListResponse,
    summary="List albums using a Subsonic album-list strategy",
)
@router.get("/getAlbumList.view", include_in_schema=False)
def get_album_list(
    request: Request,
    type: str = Query(...),
    size: int = Query(10, ge=1, le=500),
    offset: int = Query(0, ge=0),
    fromYear: int | None = Query(None),
    toYear: int | None = Query(None),
    genre: str | None = Query(None),
    musicFolderId: str | None = Query(None),
):
    albums = _album_list(
        request,
        list_type=type,
        size=size,
        offset=offset,
        from_year=fromYear,
        to_year=toYear,
        genre=genre,
        music_folder_id=musicFolderId,
    )
    if isinstance(albums, JSONResponse):
        return albums
    return _subsonic_response(
        {"albumList": {"album": [_legacy_album_payload(album) for album in albums]}}
    )


@router.get(
    "/getAlbumList2",
    response_model=SubsonicAlbumList2Response,
    summary="List albums using a Subsonic album-list strategy",
)
@router.get("/getAlbumList2.view", include_in_schema=False)
def get_album_list2(
    request: Request,
    type: str = Query(...),
    size: int = Query(10, ge=1, le=500),
    offset: int = Query(0, ge=0),
    fromYear: int | None = Query(None),
    toYear: int | None = Query(None),
    genre: str | None = Query(None),
    musicFolderId: str | None = Query(None),
):
    albums = _album_list(
        request,
        list_type=type,
        size=size,
        offset=offset,
        from_year=fromYear,
        to_year=toYear,
        genre=genre,
        music_folder_id=musicFolderId,
    )
    if isinstance(albums, JSONResponse):
        return albums

    return _subsonic_response(
        {
            "albumList2": {
                "album": [_global_album_payload(album) for album in albums],
            }
        }
    )


# ── Search ──────────────────────────────────────────────────────


@router.get(
    "/search3",
    response_model=SubsonicSearchResult3Response,
    summary="Search artists, albums, and songs",
)
@router.get("/search3.view", include_in_schema=False)
def search3(
    request: Request,
    query: str = Query("", alias="query"),
    artistCount: int = Query(5, ge=0, le=100),
    albumCount: int = Query(5, ge=0, le=100),
    songCount: int = Query(10, ge=0, le=200),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    matches = search_global_catalog(
        query,
        artist_limit=artistCount,
        album_limit=albumCount,
        track_limit=songCount,
    )
    result: dict = {
        "artist": [
            {
                "id": global_subsonic_id("artist", row["global_artist_uid"]),
                "name": row["name"],
            }
            for row in matches["artists"]
        ],
        "album": [_global_album_payload(row) for row in matches["albums"]],
        "song": [_global_song_payload(row) for row in matches["tracks"]],
    }

    return _subsonic_response({"searchResult3": result})


# ── Stream & Cover Art ──────────────────────────────────────────


@router.get(
    "/stream",
    summary="Stream a track through the Subsonic API",
    responses={
        200: {
            "description": "Audio stream for the requested track, or a Subsonic error envelope.",
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/SubsonicOkResponse"}
                },
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/flac": {"schema": {"type": "string", "format": "binary"}},
                "audio/ogg": {"schema": {"type": "string", "format": "binary"}},
                "audio/mp4": {"schema": {"type": "string", "format": "binary"}},
                "audio/aac": {"schema": {"type": "string", "format": "binary"}},
                "audio/wav": {"schema": {"type": "string", "format": "binary"}},
                "audio/opus": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        403: {"description": "Forbidden path outside the library root."},
        404: {"description": "Track file not found."},
    },
)
@router.get("/stream.view", include_in_schema=False)
def stream(request: Request, id: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    entity_id = _decode_entity_id(id, "track")
    if entity_id is None:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if entity_id.scope == "global":
        from crate.federation.playback_service import (
            PlaybackServiceError,
            stream_global_track,
        )

        try:
            return stream_global_track(
                str(entity_id.global_uid),
                user=user,
                request_headers=dict(request.headers),
            )
        except PlaybackServiceError as exc:
            return Response(status_code=exc.status_code)

    track_id = int(entity_id.local_id or 0)
    track = get_track_path_and_format(track_id)
    if not track:
        return Response(status_code=404)

    lib = library_path()
    filepath = Path(track["path"])
    if not filepath.is_absolute():
        filepath = lib / filepath
    # Prevent path traversal
    if not filepath.resolve().is_relative_to(lib.resolve()):
        return Response(status_code=403)
    if not filepath.is_file():
        return Response(status_code=404)

    media_type = _content_type(track["format"])
    return FileResponse(
        path=str(filepath),
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get(
    "/getCoverArt",
    summary="Fetch artist, album or playlist artwork via the Subsonic API",
    responses={
        200: {
            "description": "Artwork image, or a Subsonic error envelope.",
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/SubsonicOkResponse"}
                },
                "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                "image/png": {"schema": {"type": "string", "format": "binary"}},
                "image/webp": {"schema": {"type": "string", "format": "binary"}},
            },
        },
        404: {"description": "Artwork not found."},
    },
)
@router.get("/getCoverArt.view", include_in_schema=False)
def get_cover_art(
    request: Request,
    id: str = Query(""),
    size: int | None = Query(None, gt=0, le=2048),
):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if id.startswith("pl-"):
        try:
            playlist_id = decode_subsonic_playlist_id(id)
        except SubsonicIdError:
            return _subsonic_error(70, "Invalid Subsonic entity ID")
        return serve_playlist_cover(playlist_id, user=user, size=size)

    entity_type: EntityKind
    if id.startswith(("al-", "gal-")):
        entity_type = "album"
    elif id.startswith(("ar-", "ga-")):
        entity_type = "artist"
    else:
        return Response(status_code=404)

    entity_id = _decode_entity_id(id, entity_type)
    if entity_id is None:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if entity_id.scope == "global":
        from crate.federation.global_artwork import serve_global_artwork

        return serve_global_artwork(
            str(entity_id.global_uid),
            entity_type=entity_type,
            user=user,
            size=size,
            image_format=None,
        )

    if entity_type == "album":
        from crate.api.browse_album import api_cover_by_id

        return api_cover_by_id(int(entity_id.local_id or 0), size=size)

    from crate.api.browse_artist import api_artist_photo_by_id

    # The native photo endpoint reads the authenticated user from request.state.
    # The Subsonic adapter has already authenticated this request using its own
    # credential mechanism, so propagate that verified principal before reuse.
    request.state.user = user
    return api_artist_photo_by_id(request, int(entity_id.local_id or 0), size=size)


# ── Scrobble ────────────────────────────────────────────────────


@router.get(
    "/scrobble",
    response_model=SubsonicOkResponse,
    summary="Record a completed Subsonic scrobble",
)
@router.get("/scrobble.view", include_in_schema=False)
@router.post(
    "/scrobble",
    response_model=SubsonicOkResponse,
    summary="Record a completed Subsonic scrobble",
)
@router.post("/scrobble.view", include_in_schema=False)
def scrobble(
    request: Request,
    id: str = Query(""),
    submission: str = Query("true"),
    time: int | None = Query(None),
):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if submission != "true":
        return _subsonic_response({})

    entity_id = _decode_entity_id(id, "track")
    if entity_id is None:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    global_track_uid = None
    track_id = None
    content_origin = "local"
    source_node_uid = None
    if entity_id.scope == "global":
        global_track_uid = str(entity_id.global_uid)
        track = get_global_track(global_track_uid)
        if track:
            from crate.federation.playback_service import get_remembered_source

            source = get_remembered_source(int(user["id"]), global_track_uid)
            if source:
                content_origin = str(source.get("content_origin") or "local")
                source_node_uid = source.get("source_node_uid")
            else:
                from crate.federation.global_playback import (
                    resolve_global_track_playback,
                )

                selected = resolve_global_track_playback(global_track_uid)
                if selected["kind"] == "remote":
                    content_origin = "remote"
                    source_node_uid = str(selected["node_uid"])
                else:
                    from crate.playback_provenance import (
                        resolve_local_content_provenance,
                    )

                    content_origin, source_node_uid = resolve_local_content_provenance(
                        selected.get("local_track_id")
                    )
    else:
        track_id = int(entity_id.local_id or 0)
        track = get_track_full(track_id)
        if track:
            from crate.playback_provenance import resolve_local_content_provenance

            content_origin, source_node_uid = resolve_local_content_provenance(track_id)

    if track:
        from crate.db.repositories.user_library import record_play_event

        duration = float(track.get("duration") or 0)
        ended_at = (
            datetime.fromtimestamp(time / 1000, tz=timezone.utc)
            if time is not None and time > 0
            else datetime.now(timezone.utc)
        )
        started_at = ended_at - timedelta(seconds=duration)
        event_identity = f"subsonic:{user['id']}:{id}:{int(ended_at.timestamp())}"
        record_play_event(
            int(user["id"]),
            client_event_id=hashlib.sha256(event_identity.encode()).hexdigest(),
            track_id=track_id,
            global_track_uid=global_track_uid,
            title=str(track.get("title") or ""),
            artist=str(track.get("artist") or ""),
            album=str(track.get("album") or ""),
            started_at=started_at.isoformat(),
            ended_at=ended_at.isoformat(),
            played_seconds=duration,
            track_duration_seconds=duration or None,
            completion_ratio=1.0 if duration else None,
            was_completed=True,
            play_source_type="subsonic",
            play_source_id=id,
            play_source_name="Open Subsonic",
            device_type="subsonic",
            app_platform="subsonic",
            content_origin=content_origin,
            source_node_uid=source_node_uid,
        )

    return _subsonic_response({})


# ── Stubs (required by clients but not critical) ────────────────


@router.get(
    "/getPlaylists",
    response_model=SubsonicPlaylistsResponse,
    summary="List playlists for Subsonic clients",
)
@router.get("/getPlaylists.view", include_in_schema=False)
def get_playlists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"playlists": {"playlist": []}})


@router.get(
    "/getStarred2",
    response_model=SubsonicStarred2Response,
    summary="List starred artists, albums, and songs",
)
@router.get("/getStarred2.view", include_in_schema=False)
def get_starred2(request: Request):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response(
        {
            "starred2": {
                "artist": [],
                "album": [],
                "song": [
                    _global_song_payload(track)
                    for track in get_starred_global_tracks(int(user["id"]))
                ],
            }
        }
    )


@router.get(
    "/getRandomSongs",
    response_model=SubsonicRandomSongsResponse,
    summary="Fetch random songs for Subsonic clients",
)
@router.get("/getRandomSongs.view", include_in_schema=False)
def get_random_songs(
    request: Request,
    size: int = Query(10, ge=0, le=500),
    genre: str | None = Query(None),
    fromYear: int | None = Query(None),
    toYear: int | None = Query(None),
    musicFolderId: str | None = Query(None),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    if not _valid_music_folder(musicFolderId):
        return _subsonic_error(0, "Invalid musicFolderId")
    tracks = get_random_global_tracks(
        size,
        genre=genre.strip() if genre else None,
        from_year=fromYear,
        to_year=toYear,
        music_folder_id=musicFolderId,
    )

    return _subsonic_response(
        {
            "randomSongs": {
                "song": [_global_song_payload(track) for track in tracks],
            }
        }
    )


# ── Helpers ─────────────────────────────────────────────────────


def _content_type(fmt: str | None) -> str:
    m = {
        "flac": "audio/flac",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "wav": "audio/wav",
        "opus": "audio/opus",
    }
    return m.get((fmt or "mp3").lower(), "audio/mpeg")
