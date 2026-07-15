"""Subsonic API compatible endpoints.

Allows third-party music players (Symfonium, DSub, play:Sub, Ultrasonic, etc.)
to browse, search, and stream from the Crate library.

Spec: http://www.subsonic.org/pages/api.jsp
"""

import hashlib
import hmac
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse

from crate.db.repositories.auth import get_user_by_email
from crate.db.queries.subsonic import (
    get_user_by_username,
    get_artist_by_id,
    get_albums_by_artist_name,
    get_album_with_artist,
    get_tracks_by_album_id,
    get_track_full,
    get_track_path_and_format,
)
from crate.db.queries.subsonic_global import (
    get_global_album,
    get_global_artist,
    get_global_track,
    get_random_global_tracks,
    get_starred_global_tracks,
    list_global_album_tracks,
    list_global_albums,
    list_global_artist_albums,
    list_global_artists,
    search_global_catalog,
)
from crate.subsonic.global_ids import (
    EntityKind,
    SubsonicEntityId,
    SubsonicIdError,
    decode_subsonic_id,
    global_subsonic_id,
)
from crate.auth import verify_password
from crate.api._deps import library_path
from crate.api.schemas.subsonic import (
    SubsonicAlbumList2Response,
    SubsonicAlbumResponse,
    SubsonicArtistResponse,
    SubsonicArtistsResponse,
    SubsonicLicenseResponse,
    SubsonicMusicFoldersResponse,
    SubsonicOkResponse,
    SubsonicPlaylistsResponse,
    SubsonicRandomSongsResponse,
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
    """Authenticate via Subsonic token auth (md5(password + salt)) or plain password."""
    params = request.query_params
    username = params.get("u", "")
    token = params.get("t", "")
    salt = params.get("s", "")
    password = params.get("p", "")

    if not username:
        return None

    user = get_user_by_email(username)
    if not user:
        # Try username field too
        user = get_user_by_username(username)

    if not user:
        return None

    if token and salt:
        # Token auth: client sends md5(password + salt)
        # We need to check against stored password — but we only have bcrypt hash.
        # Subsonic token auth is incompatible with bcrypt. Fall back to checking
        # if the user has a plain-text compatible token stored, or reject.
        # For now: store a subsonic_token on the user for compatibility.
        stored_token = user.get("subsonic_token")
        if stored_token:
            expected = hashlib.md5((stored_token + salt).encode()).hexdigest()
            if hmac.compare_digest(token, expected):
                return user
        return None
    elif password:
        # Plain password (deprecated but simpler)
        pw = password
        if pw.startswith("enc:"):
            try:
                pw = bytes.fromhex(pw[4:]).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                return None
        password_hash = user.get("password_hash")
        if password_hash and verify_password(pw, password_hash):
            return user

    return None


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
    pass


def _decode_entity_id(value: str, kind: EntityKind) -> SubsonicEntityId | None:
    try:
        return decode_subsonic_id(value, expected_kind=kind)
    except SubsonicIdError:
        return None


def _global_album_payload(album: dict) -> dict:
    album_id = global_subsonic_id("album", album["global_album_uid"])
    return {
        "id": album_id,
        "name": album["name"],
        "artist": album["artist"],
        "artistId": global_subsonic_id("artist", album["global_artist_uid"]),
        "year": int(album["year"]) if str(album.get("year") or "").isdigit() else None,
        "songCount": album.get("track_count") or 0,
        "duration": album.get("duration") or 0,
        "coverArt": album_id if album.get("has_cover") else None,
    }


def _global_song_payload(track: dict) -> dict:
    album_uid = track.get("global_album_uid")
    album_id = global_subsonic_id("album", album_uid) if album_uid else None
    return {
        "id": global_subsonic_id("track", track["global_track_uid"]),
        "title": track["title"],
        "artist": track["artist"],
        "album": track.get("album") or "",
        "albumId": album_id,
        "artistId": global_subsonic_id("artist", track["global_artist_uid"]),
        "track": track.get("track_number") or 0,
        "discNumber": track.get("disc_number") or 1,
        "year": int(track["year"]) if str(track.get("year") or "").isdigit() else None,
        "duration": track.get("duration") or 0,
        "bitRate": track.get("bitrate") or 0,
        "suffix": (track.get("format") or "mp3").lower(),
        "contentType": _content_type(track.get("format")),
        "path": "/".join(
            part.strip("/")
            for part in (
                str(track.get("artist") or ""),
                str(track.get("album") or ""),
                str(track.get("title") or ""),
            )
            if part
        ),
        "coverArt": album_id if album_id and track.get("has_cover") else None,
        "type": "music",
        **({"starred": str(track["starred"])} if track.get("starred") else {}),
    }


# ── System ──────────────────────────────────────────────────────


@router.get("/ping", response_model=SubsonicOkResponse, summary="Ping the Subsonic API")
@router.get("/ping.view", include_in_schema=False)
def ping(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response(
        {"musicFolders": {"musicFolder": [{"id": 1, "name": "Music"}]}}
    )


@router.get(
    "/getUser",
    response_model=SubsonicUserResponse,
    summary="Fetch a Subsonic user profile",
)
@router.get("/getUser.view", include_in_schema=False)
def get_user(request: Request, username: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
    return _subsonic_response(
        {
            "user": {
                "username": user.get("username") or user["email"],
                "email": user["email"],
                "adminRole": user["role"] == "admin",
                "scrobblingEnabled": True,
                "settingsRole": True,
                "downloadRole": True,
                "uploadRole": False,
                "playlistRole": True,
                "coverArtRole": True,
                "commentRole": False,
                "podcastRole": False,
                "streamRole": True,
                "jukeboxRole": False,
                "shareRole": True,
            }
        }
    )


# ── Browse ──────────────────────────────────────────────────────


@router.get(
    "/getArtists",
    response_model=SubsonicArtistsResponse,
    summary="Browse artists grouped by index letter",
)
@router.get("/getArtists.view", include_in_schema=False)
def get_artists(request: Request):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    rows = list_global_artists()

    # Group by first letter
    index_map: dict[str, list] = {}
    for row in rows:
        letter = (row["name"][0] or "?").upper()
        if not letter.isalpha():
            letter = "#"
        index_map.setdefault(letter, []).append(
            {
                "id": global_subsonic_id("artist", row["global_artist_uid"]),
                "name": row["name"],
                "albumCount": row["album_count"] or 0,
            }
        )

    indexes = [
        {"name": letter, "artist": artists}
        for letter, artists in sorted(index_map.items())
    ]

    return _subsonic_response(
        {"artists": {"ignoredArticles": "The El La Los Las", "index": indexes}}
    )


@router.get(
    "/getArtist",
    response_model=SubsonicArtistResponse,
    summary="Fetch a Subsonic artist with albums",
)
@router.get("/getArtist.view", include_in_schema=False)
def get_artist(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    entity_id = _decode_entity_id(id, "artist")
    if entity_id is None:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if entity_id.scope == "global":
        artist = get_global_artist(str(entity_id.global_uid))
        albums = list_global_artist_albums(str(entity_id.global_uid)) if artist else []
        if not artist:
            return _subsonic_error(70, "Artist not found")
        artist_id = global_subsonic_id("artist", artist["global_artist_uid"])
        return _subsonic_response(
            {
                "artist": {
                    "id": artist_id,
                    "name": artist["name"],
                    "albumCount": len(albums),
                    "album": [_global_album_payload(album) for album in albums],
                }
            }
        )

    artist_id = int(entity_id.local_id or 0)
    artist = get_artist_by_id(artist_id)
    if not artist:
        return _subsonic_error(70, "Artist not found")

    albums = get_albums_by_artist_name(artist["name"])

    return _subsonic_response(
        {
            "artist": {
                "id": f"ar-{artist['id']}",
                "name": artist["name"],
                "albumCount": len(albums),
                "album": [
                    {
                        "id": f"al-{a['id']}",
                        "name": a["name"],
                        "artist": artist["name"],
                        "artistId": f"ar-{artist['id']}",
                        "year": int(a["year"]) if a["year"] else None,
                        "songCount": a["track_count"] or 0,
                        "duration": a["duration"],
                        "coverArt": f"al-{a['id']}" if a["has_cover"] else None,
                    }
                    for a in albums
                ],
            }
        }
    )


@router.get(
    "/getAlbum",
    response_model=SubsonicAlbumResponse,
    summary="Fetch a Subsonic album with songs",
)
@router.get("/getAlbum.view", include_in_schema=False)
def get_album(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    entity_id = _decode_entity_id(id, "album")
    if entity_id is None:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if entity_id.scope == "global":
        album = get_global_album(str(entity_id.global_uid))
        tracks = list_global_album_tracks(str(entity_id.global_uid)) if album else []
        if not album:
            return _subsonic_error(70, "Album not found")
        return _subsonic_response(
            {
                "album": {
                    **_global_album_payload(album),
                    "songCount": len(tracks),
                    "song": [_global_song_payload(track) for track in tracks],
                }
            }
        )

    album_id = int(entity_id.local_id or 0)
    album = get_album_with_artist(album_id)
    if not album:
        return _subsonic_error(70, "Album not found")

    tracks = get_tracks_by_album_id(album_id)

    return _subsonic_response(
        {
            "album": {
                "id": f"al-{album['id']}",
                "name": album["name"],
                "artist": album["artist"],
                "artistId": f"ar-{album['artist_id']}" if album["artist_id"] else None,
                "year": int(album["year"]) if album["year"] else None,
                "songCount": len(tracks),
                "duration": album["duration"],
                "coverArt": f"al-{album['id']}" if album["has_cover"] else None,
                "song": [
                    {
                        "id": str(t["id"]),
                        "title": t["title"],
                        "artist": t["artist"],
                        "album": t["album"],
                        "albumId": f"al-{album['id']}",
                        "artistId": f"ar-{album['artist_id']}"
                        if album["artist_id"]
                        else None,
                        "track": t["track"],
                        "discNumber": t["disc"],
                        "year": int(album["year"]) if album["year"] else None,
                        "duration": t["duration"] or 0,
                        "bitRate": t["bitrate"] or 0,
                        "suffix": (t["format"] or "mp3").lower(),
                        "contentType": _content_type(t["format"]),
                        "path": t["path"],
                        "coverArt": f"al-{album['id']}" if album["has_cover"] else None,
                        "type": "music",
                    }
                    for t in tracks
                ],
            }
        }
    )


@router.get(
    "/getSong",
    response_model=SubsonicSongResponse,
    summary="Fetch a single Subsonic song",
)
@router.get("/getSong.view", include_in_schema=False)
def get_song(request: Request, id: str = Query("")):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    entity_id = _decode_entity_id(id, "track")
    if entity_id is None:
        return _subsonic_error(70, "Invalid Subsonic entity ID")
    if entity_id.scope == "global":
        track = get_global_track(str(entity_id.global_uid))
        if not track:
            return _subsonic_error(70, "Song not found")
        return _subsonic_response({"song": _global_song_payload(track)})

    track_id = int(entity_id.local_id or 0)
    t = get_track_full(track_id)
    if not t:
        return _subsonic_error(70, "Song not found")

    return _subsonic_response(
        {
            "song": {
                "id": str(t["id"]),
                "title": t["title"],
                "artist": t["artist"],
                "album": t["album"],
                "albumId": f"al-{t['album_id']}" if t["album_id"] else None,
                "artistId": f"ar-{t['artist_id']}" if t["artist_id"] else None,
                "track": t["track_number"] or 0,
                "discNumber": t["disc_number"] or 1,
                "year": int(t["year"]) if t["year"] else None,
                "duration": t["duration"] or 0,
                "bitRate": t["bitrate"] or 0,
                "suffix": (t["format"] or "mp3").lower(),
                "contentType": _content_type(t["format"]),
                "path": t["path"],
                "coverArt": f"al-{t['album_id']}"
                if t["album_id"] and t["has_cover"]
                else None,
                "type": "music",
            }
        }
    )


# ── Album Lists ─────────────────────────────────────────────────


@router.get(
    "/getAlbumList2",
    response_model=SubsonicAlbumList2Response,
    summary="List albums using a Subsonic album-list strategy",
)
@router.get("/getAlbumList2.view", include_in_schema=False)
def get_album_list2(
    request: Request,
    type: str = Query("alphabeticalByName"),
    size: int = Query(10, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    albums = list_global_albums(type, size=size, offset=offset)

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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

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
    summary="Fetch album or artist artwork via the Subsonic API",
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
def get_cover_art(request: Request, id: str = Query("")):
    try:
        user = _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

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
            size=None,
            image_format=None,
        )

    if entity_type == "album":
        from crate.api.browse_album import api_cover_by_id

        return api_cover_by_id(int(entity_id.local_id or 0))

    from crate.api.browse_artist import api_artist_photo_by_id

    return api_artist_photo_by_id(request, int(entity_id.local_id or 0))


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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
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
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")
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
def get_random_songs(request: Request, size: int = Query(10, ge=1, le=500)):
    try:
        _require_subsonic_auth(request)
    except SubsonicAuthError:
        return _subsonic_error(40, "Wrong username or password")

    tracks = get_random_global_tracks(size)

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
