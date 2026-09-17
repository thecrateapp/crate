"""Subsonic API compatible endpoints.

Allows third-party music players (Symfonium, DSub, play:Sub, Ultrasonic, etc.)
to browse, search, and stream from the Crate library.

Spec: http://www.subsonic.org/pages/api.jsp
"""

import logging
from collections import defaultdict

from fastapi import Depends, Query, Request, Response
from fastapi.responses import JSONResponse

from crate.db.queries.subsonic_global import (
    get_global_tracks_by_genre,
    get_random_global_tracks,
    list_global_albums,
)
from crate.subsonic.global_ids import (
    EntityKind,
    SubsonicEntityId,
    SubsonicIdError,
    decode_subsonic_id,
    decode_subsonic_playlist_id,
)
from crate.subsonic.params import RequestParameters
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.protocol import render_response
from crate.subsonic.routes import OpenSubsonicAPIRouter
from crate.subsonic.services import catalog
from crate.subsonic.services import discovery as discovery_service
from crate.subsonic.services import preferences
from crate.subsonic.services import playback as playback_service
from crate.subsonic.services import queues as queue_service
from crate.subsonic.services import playlists as playlist_service
from crate.subsonic.services.artwork import serve_playlist_cover
from crate.subsonic.serializers import serialize_album, serialize_song
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
    SubsonicPlaylistResponse,
    SubsonicRandomSongsResponse,
    SubsonicSongsByGenreResponse,
    SubsonicSearchResponse,
    SubsonicSearchResult2Response,
    SubsonicSearchResult3Response,
    SubsonicArtistInfoResponse,
    SubsonicAlbumInfoResponse,
    SubsonicSongResponse,
    SubsonicStarredResponse,
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


router = OpenSubsonicAPIRouter(
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
                "openSubsonic": True,
                **data,
            }
        }
    )


def _subsonic_error(code: int, message: str) -> JSONResponse:
    return _subsonic_response(
        {"error": {"code": code, "message": message}}, status="failed"
    )


def _discovery_response(
    request: Request,
    data: dict | None = None,
    error: OpenSubsonicError | None = None,
) -> Response:
    response_format = (request.query_params.get("f") or "xml").strip().lower()
    if response_format not in {"xml", "json"}:
        error = error or OpenSubsonicError(
            ErrorCode.GENERIC, "Unsupported response format"
        )
        response_format = "xml"
    return render_response(data, error=error, response_format=response_format)


def _require_subsonic_auth(request: Request) -> dict:
    user = _subsonic_auth(request)
    if not user:
        raise SubsonicAuthError()
    return user


def _require_subsonic_auth_params(params: RequestParameters) -> dict:
    from crate.subsonic.auth import authenticate

    try:
        user = authenticate(params)
    except OpenSubsonicError as error:
        raise SubsonicAuthError(error.code, error.message) from error
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
    response_model=SubsonicSongsByGenreResponse,
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
        {"songsByGenre": {"song": [_global_song_payload(track) for track in tracks]}}
    )


@router.get("/getLyrics", summary="Fetch cached lyrics by artist and title")
@router.get("/getLyrics.view", include_in_schema=False)
def get_lyrics(request: Request):
    try:
        _require_subsonic_auth(request)
        lyrics = discovery_service.get_lyrics(
            request.query_params.get("artist"), request.query_params.get("title")
        )
    except SubsonicAuthError as error:
        return _discovery_response(
            request, error=OpenSubsonicError(error.code, error.message)
        )
    except OpenSubsonicError as error:
        return _discovery_response(request, error=error)
    return _discovery_response(request, {"lyrics": lyrics})


@router.get("/getLyricsBySongId", summary="Fetch structured cached lyrics by song ID")
@router.get("/getLyricsBySongId.view", include_in_schema=False)
def get_lyrics_by_song_id(request: Request):
    try:
        _require_subsonic_auth(request)
        enhanced = (request.query_params.get("enhanced") or "false").strip().lower()
        if enhanced not in {"", "false", "0"}:
            if enhanced in {"true", "1"}:
                raise OpenSubsonicError(
                    ErrorCode.INCOMPATIBLE_SERVER,
                    "Enhanced lyrics are not supported",
                )
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Invalid parameter 'enhanced'"
            )
        lyrics = discovery_service.get_lyrics_by_song_id(
            request.query_params.get("id") or ""
        )
    except SubsonicAuthError as error:
        return _discovery_response(
            request, error=OpenSubsonicError(error.code, error.message)
        )
    except OpenSubsonicError as error:
        return _discovery_response(request, error=error)
    return _discovery_response(request, {"lyricsList": lyrics})


@router.get("/getTopSongs", summary="Return the best-ranked songs for an artist")
@router.get("/getTopSongs.view", include_in_schema=False)
def get_top_songs(request: Request):
    try:
        _require_subsonic_auth(request)
        songs = discovery_service.get_top_songs(
            artist=request.query_params.get("artist"),
            artist_id=request.query_params.get("id"),
            count=request.query_params.get("count"),
        )
    except SubsonicAuthError as error:
        return _discovery_response(
            request, error=OpenSubsonicError(error.code, error.message)
        )
    except OpenSubsonicError as error:
        return _discovery_response(request, error=error)
    return _discovery_response(request, {"topSongs": {"song": songs}})


@router.get("/getSimilarSongs", summary="Return tracks similar to a library item")
@router.get("/getSimilarSongs.view", include_in_schema=False)
def get_similar_songs(request: Request):
    try:
        _require_subsonic_auth(request)
        songs = discovery_service.get_similar_songs(
            request.query_params.get("id") or "",
            count=request.query_params.get("count"),
        )
    except SubsonicAuthError as error:
        return _discovery_response(
            request, error=OpenSubsonicError(error.code, error.message)
        )
    except OpenSubsonicError as error:
        return _discovery_response(request, error=error)
    return _discovery_response(request, {"similarSongs": {"song": songs}})


@router.get("/getSimilarSongs2", summary="Return ID3-organized similar library tracks")
@router.get("/getSimilarSongs2.view", include_in_schema=False)
def get_similar_songs2(request: Request):
    try:
        _require_subsonic_auth(request)
        songs = discovery_service.get_similar_songs(
            request.query_params.get("id") or "",
            count=request.query_params.get("count"),
        )
    except SubsonicAuthError as error:
        return _discovery_response(
            request, error=OpenSubsonicError(error.code, error.message)
        )
    except OpenSubsonicError as error:
        return _discovery_response(request, error=error)
    return _discovery_response(request, {"similarSongs2": {"song": songs}})


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
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    try:
        album = catalog.album_detail(id)
    except SubsonicIdError:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if not album:
        return _subsonic_error(70, "Album not found")
    album = {
        **album,
        "song": [
            preferences.with_user_rating(int(user["id"]), song)
            for song in album.get("song", [])
        ],
    }
    return _subsonic_response({"album": album})


@router.get(
    "/getSong",
    response_model=SubsonicSongResponse,
    summary="Fetch a single Subsonic song",
)
@router.get("/getSong.view", include_in_schema=False)
def get_song(request: Request, id: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    try:
        song = catalog.song_detail(id)
    except SubsonicIdError:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if not song:
        return _subsonic_error(70, "Song not found")
    return _subsonic_response(
        {"song": preferences.with_user_rating(int(user["id"]), song)}
    )


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


# ── Search & metadata ────────────────────────────────────────────


def _validate_search_numbers(**values: int | None) -> JSONResponse | None:
    for name, value in values.items():
        if value is not None and value < 0:
            return _subsonic_error(0, f"{name} must be non-negative")
    return None


@router.get(
    "/search",
    response_model=SubsonicSearchResponse,
    summary="Search the catalog using legacy parameters",
)
@router.get("/search.view", include_in_schema=False)
def search(
    request: Request,
    artist: str | None = Query(None),
    album: str | None = Query(None),
    title: str | None = Query(None),
    any: str | None = Query(None),
    count: int = Query(20),
    offset: int = Query(0),
    newerThan: int | None = Query(None),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    invalid = _validate_search_numbers(count=count, offset=offset, newerThan=newerThan)
    if invalid:
        return invalid
    try:
        result = catalog.search_catalog(
            None,
            artist_count=0,
            album_count=0,
            song_count=min(count, 200),
            song_offset=min(offset, 1_000_000),
            artist_query=artist,
            album_query=album,
            song_query=title,
            any_query=any,
            newer_than_ms=newerThan,
            version=1,
        )
    except ValueError as error:
        return _subsonic_error(0, str(error))
    return _subsonic_response({"searchResult": result})


def _search_v2_or_v3(
    request: Request,
    *,
    query: str | None,
    artistCount: int,
    artistOffset: int,
    albumCount: int,
    albumOffset: int,
    songCount: int,
    songOffset: int,
    musicFolderId: str | None,
    version: int,
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    if query is None:
        return _subsonic_error(10, "Required parameter 'query' is missing")
    invalid = _validate_search_numbers(
        artistCount=artistCount,
        artistOffset=artistOffset,
        albumCount=albumCount,
        albumOffset=albumOffset,
        songCount=songCount,
        songOffset=songOffset,
    )
    if invalid:
        return invalid
    try:
        result = catalog.search_catalog(
            query,
            artist_count=artistCount,
            artist_offset=artistOffset,
            album_count=albumCount,
            album_offset=albumOffset,
            song_count=songCount,
            song_offset=songOffset,
            music_folder_id=musicFolderId,
            version=version,
        )
    except ValueError as error:
        return _subsonic_error(0, str(error))
    response_key = "searchResult2" if version == 2 else "searchResult3"
    return _subsonic_response({response_key: result})


@router.get(
    "/search2",
    response_model=SubsonicSearchResult2Response,
    summary="Search artists, albums, and songs",
)
@router.get("/search2.view", include_in_schema=False)
def search2(
    request: Request,
    query: str | None = Query(None),
    artistCount: int = Query(20),
    artistOffset: int = Query(0),
    albumCount: int = Query(20),
    albumOffset: int = Query(0),
    songCount: int = Query(20),
    songOffset: int = Query(0),
    musicFolderId: str | None = Query(None),
):
    return _search_v2_or_v3(
        request,
        query=query,
        artistCount=artistCount,
        artistOffset=artistOffset,
        albumCount=albumCount,
        albumOffset=albumOffset,
        songCount=songCount,
        songOffset=songOffset,
        musicFolderId=musicFolderId,
        version=2,
    )


@router.get(
    "/search3",
    response_model=SubsonicSearchResult3Response,
    summary="Search artists, albums, and songs using ID3 tags",
)
@router.get("/search3.view", include_in_schema=False)
def search3(
    request: Request,
    query: str | None = Query(None),
    artistCount: int = Query(20),
    artistOffset: int = Query(0),
    albumCount: int = Query(20),
    albumOffset: int = Query(0),
    songCount: int = Query(20),
    songOffset: int = Query(0),
    musicFolderId: str | None = Query(None),
):
    return _search_v2_or_v3(
        request,
        query=query,
        artistCount=artistCount,
        artistOffset=artistOffset,
        albumCount=albumCount,
        albumOffset=albumOffset,
        songCount=songCount,
        songOffset=songOffset,
        musicFolderId=musicFolderId,
        version=3,
    )


@router.get(
    "/getArtistInfo",
    response_model=SubsonicArtistInfoResponse,
    summary="Get artist biography, artwork, and similar artists",
)
@router.get("/getArtistInfo.view", include_in_schema=False)
def get_artist_info(
    request: Request,
    id: str | None = Query(None),
    count: int = Query(20),
    includeNotPresent: bool = Query(False),
):
    return _get_artist_info(request, id, count, includeNotPresent, version=1)


@router.get(
    "/getArtistInfo2",
    response_model=SubsonicArtistInfoResponse,
    summary="Get artist metadata using ID3 tags",
)
@router.get("/getArtistInfo2.view", include_in_schema=False)
def get_artist_info2(
    request: Request,
    id: str | None = Query(None),
    count: int = Query(20),
    includeNotPresent: bool = Query(False),
):
    return _get_artist_info(request, id, count, includeNotPresent, version=2)


def _get_artist_info(
    request: Request,
    identifier: str | None,
    count: int,
    include_not_present: bool,
    *,
    version: int,
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    if not identifier:
        return _subsonic_error(10, "Required parameter 'id' is missing")
    invalid = _validate_search_numbers(count=count)
    if invalid:
        return invalid
    try:
        metadata = catalog.artist_metadata(
            identifier,
            request=request,
            count=min(count, 100),
            include_not_present=include_not_present,
        )
    except ValueError as error:
        return _subsonic_error(0, str(error))
    if metadata is None:
        return _subsonic_error(70, "Artist not found")
    return _subsonic_response(
        {"artistInfo" if version == 1 else "artistInfo2": metadata}
    )


@router.get(
    "/getAlbumInfo",
    response_model=SubsonicAlbumInfoResponse,
    summary="Get album notes, artwork, and external metadata",
)
@router.get("/getAlbumInfo.view", include_in_schema=False)
def get_album_info(request: Request, id: str | None = Query(None)):
    return _get_album_info(request, id)


@router.get(
    "/getAlbumInfo2",
    response_model=SubsonicAlbumInfoResponse,
    summary="Get album metadata using ID3 tags",
)
@router.get("/getAlbumInfo2.view", include_in_schema=False)
def get_album_info2(request: Request, id: str | None = Query(None)):
    return _get_album_info(request, id)


def _get_album_info(request: Request, identifier: str | None):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    if not identifier:
        return _subsonic_error(10, "Required parameter 'id' is missing")
    try:
        metadata = catalog.album_metadata(identifier, request=request)
    except ValueError as error:
        return _subsonic_error(0, str(error))
    if metadata is None:
        return _subsonic_error(70, "Album not found")
    return _subsonic_response({"albumInfo": metadata})


# ── Stream & Cover Art ──────────────────────────────────────────


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


@router.get("/scrobble", response_model=SubsonicOkResponse, summary="Record playback")
@router.get("/scrobble.view", include_in_schema=False)
@router.post("/scrobble", response_model=SubsonicOkResponse, summary="Record playback")
@router.post("/scrobble.view", include_in_schema=False)
async def scrobble(request: Request):
    from crate.subsonic.params import collect_parameters

    params = await collect_parameters(request)
    try:
        user = _require_subsonic_auth_params(params)
        playback_service.scrobble(params, user)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    return _subsonic_response({})


@router.get("/getNowPlaying", summary="Return tracks currently playing by users")
@router.get("/getNowPlaying.view", include_in_schema=False)
@router.post("/getNowPlaying", summary="Return tracks currently playing by users")
@router.post("/getNowPlaying.view", include_in_schema=False)
async def get_now_playing(request: Request):
    from crate.subsonic.params import collect_parameters

    params = await collect_parameters(request)
    try:
        _require_subsonic_auth_params(params)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response(
        {"nowPlaying": {"entry": playback_service.get_now_playing_entries()}}
    )


@router.get("/getPlayQueue", summary="Return the authenticated user's play queue")
@router.get("/getPlayQueue.view", include_in_schema=False)
async def get_play_queue(request: Request):
    from crate.subsonic.params import collect_parameters

    params = await collect_parameters(request)
    try:
        user = _require_subsonic_auth_params(params)
        queue = queue_service.get_play_queue(user, by_index=False)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    return _subsonic_response({"playQueue": queue})


@router.get(
    "/getPlayQueueByIndex",
    summary="Return the authenticated user's play queue by index",
)
@router.get("/getPlayQueueByIndex.view", include_in_schema=False)
async def get_play_queue_by_index(request: Request):
    from crate.subsonic.params import collect_parameters

    params = await collect_parameters(request)
    try:
        user = _require_subsonic_auth_params(params)
        queue = queue_service.get_play_queue(user, by_index=True)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    return _subsonic_response({"playQueue": queue})


@router.get("/savePlayQueue", response_model=SubsonicOkResponse)
@router.get("/savePlayQueue.view", include_in_schema=False)
async def save_play_queue(request: Request):
    from crate.subsonic.params import collect_parameters

    params = await collect_parameters(request)
    try:
        user = _require_subsonic_auth_params(params)
        queue_service.save_play_queue(params, user, by_index=False)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    return _subsonic_response({})


@router.get("/savePlayQueueByIndex", response_model=SubsonicOkResponse)
@router.get("/savePlayQueueByIndex.view", include_in_schema=False)
async def save_play_queue_by_index(request: Request):
    from crate.subsonic.params import collect_parameters

    params = await collect_parameters(request)
    try:
        user = _require_subsonic_auth_params(params)
        queue_service.save_play_queue(params, user, by_index=True)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    return _subsonic_response({})


# ── Playlists ───────────────────────────────────────────────────


@router.get(
    "/getPlaylists",
    response_model=SubsonicPlaylistsResponse,
    summary="List playlists for Subsonic clients",
)
@router.get("/getPlaylists.view", include_in_schema=False)
def get_playlists(request: Request, username: str | None = Query(None)):
    try:
        user = _require_subsonic_auth(request)
        playlists = playlist_service.list_playlists(user, username=username)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"playlists": {"playlist": playlists}})


@router.get(
    "/getPlaylist",
    response_model=SubsonicPlaylistResponse,
    summary="Return a saved playlist and its songs",
)
@router.get("/getPlaylist.view", include_in_schema=False)
def get_playlist(request: Request, id: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
        if not id:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Required parameter 'id' is missing"
            )
        playlist = playlist_service.get_playlist(user, id)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"playlist": playlist})


@router.get(
    "/createPlaylist",
    response_model=SubsonicPlaylistResponse,
    summary="Create or replace a saved playlist",
)
@router.get("/createPlaylist.view", include_in_schema=False)
def create_playlist(
    request: Request,
    name: str | None = Query(None),
    playlist_id: str | None = Query(None, alias="playlistId"),
    song_id: list[str] | None = Query(None, alias="songId"),
):
    try:
        user = _require_subsonic_auth(request)
        if playlist_id == "":
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Invalid parameter 'playlistId'"
            )
        playlist = playlist_service.create_playlist(
            user, name=name, playlist_id=playlist_id, song_ids=song_id
        )
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({"playlist": playlist})


@router.get(
    "/updatePlaylist",
    response_model=SubsonicOkResponse,
    summary="Update a saved playlist",
)
@router.get("/updatePlaylist.view", include_in_schema=False)
def update_playlist(
    request: Request,
    playlist_id: str = Query("", alias="playlistId"),
    name: str | None = Query(None),
    comment: str | None = Query(None),
    public: str | None = Query(None),
    song_id_to_add: list[str] | None = Query(None, alias="songIdToAdd"),
    song_index_to_remove: list[str] | None = Query(None, alias="songIndexToRemove"),
):
    try:
        user = _require_subsonic_auth(request)
        if not playlist_id:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER,
                "Required parameter 'playlistId' is missing",
            )
        parsed_public = _parse_playlist_public(public)
        parsed_indexes = _parse_playlist_indexes(song_index_to_remove)
        playlist_service.update_playlist(
            user,
            playlist_id,
            name=name,
            comment=comment,
            public=parsed_public,
            song_ids_to_add=song_id_to_add,
            song_indexes_to_remove=parsed_indexes,
        )
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({})


@router.get(
    "/deletePlaylist",
    response_model=SubsonicOkResponse,
    summary="Delete a saved playlist",
)
@router.get("/deletePlaylist.view", include_in_schema=False)
def delete_playlist(request: Request, id: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
        if not id:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Required parameter 'id' is missing"
            )
        playlist_service.delete_playlist(user, id)
    except OpenSubsonicError as error:
        return _subsonic_error(error.code, error.message)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    return _subsonic_response({})


def _parse_playlist_public(value: str | None) -> bool | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    raise OpenSubsonicError(ErrorCode.MISSING_PARAMETER, "Invalid public value")


def _parse_playlist_indexes(values: list[str] | None) -> list[int] | None:
    if values is None:
        return None
    try:
        return [int(value) for value in values]
    except ValueError as error:
        raise OpenSubsonicError(
            ErrorCode.MISSING_PARAMETER, "Invalid songIndexToRemove value"
        ) from error


# ── Other stubs (required by clients but not critical) ──────────


@router.get(
    "/getStarred",
    response_model=SubsonicStarredResponse,
    summary="List starred artists, albums, and songs",
)
@router.get("/getStarred.view", include_in_schema=False)
def get_starred(request: Request):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)

    starred = preferences.get_starred(int(user["id"]))
    legacy_albums = []
    for album in starred["album"]:
        name = str(album.get("name") or "")
        child = {
            "id": album["id"],
            "isDir": True,
            "title": name,
            "name": name,
            "album": name,
        }
        if album.get("artistId"):
            child["parent"] = album["artistId"]
        for field in (
            "artist",
            "artistId",
            "year",
            "coverArt",
            "songCount",
            "duration",
            "created",
        ):
            if album.get(field) is not None:
                child[field] = album[field]
        legacy_albums.append(child)

    return _subsonic_response(
        {
            "starred": {
                "artist": starred["artist"],
                "album": legacy_albums,
                "song": starred["song"],
            }
        }
    )


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
    return _subsonic_response({"starred2": preferences.get_starred(int(user["id"]))})


def _star_request_items(request: Request) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for value in request.query_params.getlist("artistId"):
        items.append(("artist", value))
    for value in request.query_params.getlist("albumId"):
        items.append(("album", value))
    for value in request.query_params.getlist("id"):
        item_type = (
            "artist"
            if value.startswith(("ga-", "ar-"))
            else "album"
            if value.startswith(("gal-", "al-"))
            else "song"
        )
        items.append((item_type, value))
    return items


@router.get("/star", response_model=SubsonicOkResponse, summary="Star media")
@router.get("/star.view", include_in_schema=False)
def star(request: Request):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    items = _star_request_items(request)
    if not items:
        return _subsonic_error(
            ErrorCode.MISSING_PARAMETER, "id, albumId or artistId is required"
        )
    try:
        for item_type, item_id in items:
            preferences.star(int(user["id"]), item_type, item_id)
    except ValueError as error:
        return _subsonic_error(ErrorCode.NOT_FOUND, str(error))
    return _subsonic_response({})


@router.get("/unstar", response_model=SubsonicOkResponse, summary="Unstar media")
@router.get("/unstar.view", include_in_schema=False)
def unstar(request: Request):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    items = _star_request_items(request)
    if not items:
        return _subsonic_error(
            ErrorCode.MISSING_PARAMETER, "id, albumId or artistId is required"
        )
    try:
        for item_type, item_id in items:
            preferences.unstar(int(user["id"]), item_type, item_id)
    except ValueError as error:
        return _subsonic_error(ErrorCode.NOT_FOUND, str(error))
    return _subsonic_response({})


@router.get(
    "/setRating", response_model=SubsonicOkResponse, summary="Set a media rating"
)
@router.get("/setRating.view", include_in_schema=False)
def set_rating(request: Request):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError as error:
        return _subsonic_auth_error_response(error)
    item_id = request.query_params.get("id")
    raw_rating = request.query_params.get("rating")
    if not item_id or raw_rating is None:
        return _subsonic_error(
            ErrorCode.MISSING_PARAMETER, "id and rating are required"
        )
    try:
        rating = int(raw_rating)
    except ValueError:
        return _subsonic_error(ErrorCode.MISSING_PARAMETER, "Invalid rating")
    if rating < 0 or rating > 5:
        return _subsonic_error(
            ErrorCode.MISSING_PARAMETER, "Rating must be between 0 and 5"
        )
    try:
        updated = preferences.set_rating(int(user["id"]), item_id, rating)
    except ValueError as error:
        return _subsonic_error(ErrorCode.NOT_FOUND, str(error))
    if not updated:
        return _subsonic_error(ErrorCode.NOT_FOUND, "Track not found")
    return _subsonic_response({})


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
