"""Device browse, search and queue API (AA3) for the native media service.

Android Auto and other media browsers bind to the Listen media service while the
WebView is frozen or not running; this compact API is what that native code
browses and plays from. Every route accepts an interactive session or a native
device token (`device.native`, AA2) and only reads the caller's own library.

- Home, recently played and radio come from the warmed home snapshot and never
  build it in the request (`get_home_discovery_snapshot`).
- Saved albums, followed artists, playlists, playlist tracks, liked tracks and
  album tracks page in SQL with keyset cursors.
- Artist pages are bounded (top tracks plus at most 200 albums).
- `POST /queue` turns a container or explicit track ids into at most 500
  native-ready tracks, resolved with one batched track query.
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from crate.api.auth import _native_device_token_user, _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    OpenApiResponses,
    error_response,
    merge_responses,
)
from crate.api.schemas.device_library import (
    DEVICE_QUEUE_LIMIT,
    DeviceBrowsePageResponse,
    DeviceQueueRequest,
    DeviceQueueResponse,
    DeviceQueueTrackResponse,
)
from crate.api.schemas.smart_mix import ContinuationDescriptor
from crate.api.smart_mix import native_track_fields
from crate.db.home_discovery_surface import get_home_discovery_snapshot
from crate.db.queries.decks_library import (
    ME_CONTAINER_ID,
    coerce_after,
    get_decks_container_tracks,
)
from crate.db.queries.device_library import (
    ALBUM_TRACK_KEYS,
    FOLLOWED_ARTIST_KEYS,
    PLAYLIST_KEYS,
    SAVED_ALBUM_KEYS,
    coerce_keyset,
    get_device_album_page,
    get_device_artist,
    get_device_followed_artists_page,
    get_device_playlist_header,
    get_device_playlists_page,
    get_device_saved_albums_page,
    get_device_tracks_by_entity_uids,
)

router = APIRouter(prefix="/api/me/device", tags=["me"])

_ARTWORK_SIZE = 512
_HOME_GROUP_LIMIT = 8
_ARTIST_TOP_TRACKS = 12
_RADIO_QUEUE_LENGTH = 50
_MIX_QUEUE_LENGTH = 40

_NOT_MODIFIED: OpenApiResponses = {
    304: {"description": "Not modified: the If-None-Match ETag still matches."}
}
_BROWSE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    _NOT_MODIFIED,
    {
        400: error_response("The cursor is not valid for this node."),
        404: error_response(
            "Unknown node, or a container that does not exist or is not the "
            "caller's to play."
        ),
        422: error_response("The request parameters failed validation."),
    },
)
_SEARCH_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    _NOT_MODIFIED,
    {422: error_response("The query is shorter than two characters.")},
)
_QUEUE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response(
            "The container does not exist, is not the caller's, or has no "
            "playable tracks yet."
        ),
        409: error_response("The radio session is busy; retry the request."),
        422: error_response(
            "Neither or both of node and item_ids, a node that is not playable, "
            "an item id that is not a track, or more than 500 item ids."
        ),
    },
)


# ── Auth ─────────────────────────────────────────────────────────


def _require_device_user(request: Request) -> dict:
    """An interactive session or a native device token with an account."""
    user = _native_device_token_user(request) or _require_auth(request)
    if (
        user.get("auth_type") == "access_token"
        and user.get("token_type") != "native_device"
    ):
        raise HTTPException(
            status_code=403,
            detail="The device API needs a session or a native device token",
        )
    if user.get("id") is None:
        raise HTTPException(
            status_code=403, detail="The device API needs a Crate account"
        )
    return user


# ── Node and item ids ────────────────────────────────────────────

_FIXED_NODES = {
    "root": "Crate",
    "home": "Home",
    "library": "Library",
    "recent": "Recently played",
    "playlists": "Playlists",
    "liked": "Liked songs",
    "albums": "Albums",
    "artists": "Artists",
    "radio": "Radio",
}
_MIX_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,95}$")
_PLAYLIST_ID = re.compile(r"^[0-9]{1,9}$")
_STATION_ID = re.compile(r"^(artist|album):([0-9]{1,18})$")


@dataclass(frozen=True, slots=True)
class _Ref:
    kind: str
    value: str = ""

    @property
    def id(self) -> str:
        return f"{self.kind}:{self.value}" if self.value else self.kind


def _canonical_uuid(value: str) -> str | None:
    if len(value) != 36:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _parse_ref(raw: str) -> _Ref | None:
    """A node or item id, canonicalized, or None when it is not one."""
    if raw in _FIXED_NODES:
        return _Ref(raw)
    kind, sep, value = raw.partition(":")
    if not sep:
        return None
    if kind in {"album", "artist", "track"}:
        uid = _canonical_uuid(value)
        return _Ref(kind, uid) if uid else None
    if kind == "playlist" and _PLAYLIST_ID.fullmatch(value):
        return _Ref(kind, str(int(value)))
    if kind == "mix" and _MIX_ID.fullmatch(value):
        return _Ref(kind, value)
    if kind == "station":
        match = _STATION_ID.fullmatch(value)
        if match:
            return _Ref(kind, f"{match.group(1)}:{int(match.group(2))}")
    return None


# ── Items ────────────────────────────────────────────────────────


def _album_artwork(album_entity_uid: Any) -> str | None:
    uid = _canonical_uuid(str(album_entity_uid or ""))
    return f"/api/albums/by-entity/{uid}/cover?size={_ARTWORK_SIZE}" if uid else None


def _artist_artwork(artist_entity_uid: Any) -> str | None:
    uid = _canonical_uuid(str(artist_entity_uid or ""))
    return f"/api/artists/by-entity/{uid}/photo?size={_ARTWORK_SIZE}" if uid else None


def _item(
    item_id: str,
    kind: str,
    title: Any,
    *,
    subtitle: Any = None,
    artwork_url: str | None = None,
    playable: bool,
    browsable: bool,
    duration_ms: int | None = None,
    group: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": item_id,
        "kind": kind,
        "title": str(title or "Unknown"),
        "subtitle": str(subtitle) if subtitle else None,
        "artwork_url": artwork_url,
        "playable": playable,
        "browsable": browsable,
    }
    if duration_ms is not None:
        item["duration_ms"] = duration_ms
    if group is not None:
        item["group"] = group
    return item


def _folder(node: str) -> dict[str, Any]:
    return _item(node, "folder", _FIXED_NODES[node], playable=False, browsable=True)


def _duration_ms(seconds: Any) -> int | None:
    try:
        value = float(seconds)
    except (TypeError, ValueError):
        return None
    return round(value * 1000) if value > 0 else None


def _track_item(
    row: dict, *, artwork_url: str | None, group: str | None = None
) -> dict[str, Any] | None:
    uid = _canonical_uuid(
        str(row.get("entity_uid") or row.get("track_entity_uid") or "")
    )
    if uid is None:
        return None
    duration_ms = row.get("duration_ms")
    if duration_ms is None:
        duration_ms = _duration_ms(row.get("duration"))
    return _item(
        f"track:{uid}",
        "track",
        row.get("title"),
        subtitle=row.get("artist"),
        artwork_url=artwork_url,
        playable=True,
        browsable=False,
        duration_ms=int(duration_ms) if duration_ms is not None else None,
        group=group,
    )


def _decks_track_item(row: dict) -> dict[str, Any] | None:
    album_id = row.get("album_id")
    artwork = (
        f"/api/albums/{int(album_id)}/cover?size={_ARTWORK_SIZE}"
        if album_id is not None and row.get("cover_url")
        else None
    )
    return _track_item(row, artwork_url=artwork)


def _album_item(row: dict, *, group: str | None = None) -> dict[str, Any] | None:
    uid = _canonical_uuid(str(row.get("entity_uid") or ""))
    if uid is None:
        return None
    return _item(
        f"album:{uid}",
        "album",
        row.get("name"),
        subtitle=row.get("artist"),
        artwork_url=_album_artwork(uid) if row.get("has_cover", True) else None,
        playable=True,
        browsable=True,
        group=group,
    )


def _artist_item(row: dict, *, group: str | None = None) -> dict[str, Any] | None:
    uid = _canonical_uuid(str(row.get("entity_uid") or ""))
    if uid is None:
        return None
    return _item(
        f"artist:{uid}",
        "artist",
        row.get("name"),
        artwork_url=_artist_artwork(uid) if row.get("has_photo", True) else None,
        playable=True,
        browsable=True,
        group=group,
    )


def _first_album_artwork(refs: Any) -> str | None:
    for ref in refs if isinstance(refs, list) else []:
        if isinstance(ref, dict):
            artwork = _album_artwork(ref.get("album_entity_uid"))
            if artwork:
                return artwork
    return None


def _recent_item(row: Any, *, group: str | None = None) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    kind = row.get("type")
    if kind == "album":
        return _album_item(
            {
                "entity_uid": row.get("album_entity_uid"),
                "name": row.get("album_name"),
                "artist": row.get("artist_name"),
            },
            group=group,
        )
    if kind == "artist":
        return _artist_item(
            {
                "entity_uid": row.get("artist_entity_uid"),
                "name": row.get("artist_name"),
            },
            group=group,
        )
    if kind == "playlist":
        playlist_id = row.get("playlist_id")
        if not isinstance(playlist_id, int) or isinstance(playlist_id, bool):
            return None
        return _item(
            f"playlist:{playlist_id}",
            "playlist",
            row.get("playlist_name"),
            artwork_url=_first_album_artwork(row.get("playlist_tracks")),
            playable=True,
            browsable=True,
            group=group,
        )
    return None


def _mix_item(row: Any, *, group: str | None = None) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    mix_id = str(row.get("id") or "")
    if not _MIX_ID.fullmatch(mix_id):
        return None
    return _item(
        f"mix:{mix_id}",
        "mix",
        row.get("name") or row.get("title"),
        subtitle=row.get("description") or row.get("subtitle"),
        artwork_url=_first_album_artwork(row.get("artwork_tracks")),
        playable=True,
        browsable=False,
        group=group,
    )


def _station_item(row: Any, *, group: str | None = None) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    seed_type = row.get("seed_type") or row.get("type")
    seed_value = str(row.get("seed_value") or "")
    ref = _parse_ref(f"station:{seed_type}:{seed_value}")
    if ref is None:
        # Global-only seeds have no local radio for the device to start.
        return None
    if seed_type == "artist":
        artwork = _artist_artwork(row.get("artist_entity_uid"))
        subtitle = None
    else:
        artwork = _album_artwork(row.get("album_entity_uid"))
        subtitle = row.get("artist_name")
    return _item(
        ref.id,
        "station",
        row.get("title") or row.get("seed_label"),
        subtitle=subtitle,
        artwork_url=artwork,
        playable=True,
        browsable=False,
        group=group,
    )


def _compact(items: Sequence[dict[str, Any] | None]) -> list[dict[str, Any]]:
    return [item for item in items if item is not None]


# ── Cursors and ETags ────────────────────────────────────────────


def _encode_cursor(node: str, after: list[Any]) -> str:
    raw = json.dumps([node, after], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None, node: str) -> list[Any] | None:
    if cursor is None:
        return None
    invalid = HTTPException(status_code=400, detail="Invalid cursor for this node")
    try:
        raw = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
        )
        decoded = json.loads(raw)
    except ValueError as exc:
        raise invalid from exc
    if (
        not isinstance(decoded, list)
        or len(decoded) != 2
        or decoded[0] != node
        or not isinstance(decoded[1], list)
        or not decoded[1]
    ):
        raise invalid
    return decoded[1]


def _coerce(after: list[Any] | None, coerce: Callable[[list[Any]], list[Any]]):
    if after is None:
        return None
    try:
        return coerce(after)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Invalid cursor for this node"
        ) from exc


def _offset(after: list[Any] | None) -> int:
    if after is None:
        return 0
    value = after[0] if len(after) == 1 else None
    if not isinstance(value, int) or isinstance(value, bool) or not 0 < value < 10_000:
        raise HTTPException(status_code=400, detail="Invalid cursor for this node")
    return value


def _offset_page(
    items: list[dict[str, Any]], after: list[Any] | None, limit: int
) -> tuple[list[dict[str, Any]], list[Any] | None]:
    start = _offset(after)
    page = items[start : start + limit]
    return page, [start + limit] if start + limit < len(items) else None


def _conditional_json(request: Request, payload: dict) -> Response:
    """Serve `payload` with a strong ETag, or 304 when If-None-Match matches."""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    etag = f'"{hashlib.sha256(body).hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    for candidate in request.headers.get("if-none-match", "").split(","):
        candidate = candidate.strip().removeprefix("W/")
        if candidate in {"*", etag}:
            return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


# ── Browse ───────────────────────────────────────────────────────

_Page = tuple[str, list[dict[str, Any]], list[Any] | None]


def _snapshot_list(user_id: int, key: str) -> list[Any]:
    rows = get_home_discovery_snapshot(user_id).get(key)
    return rows if isinstance(rows, list) else []


def _browse_root(user: dict, ref: _Ref, after, limit: int) -> _Page:
    items = [_folder("home"), _folder("library"), _folder("radio")]
    page, next_after = _offset_page(items, after, limit)
    return _FIXED_NODES["root"], page, next_after


def _browse_library(user: dict, ref: _Ref, after, limit: int) -> _Page:
    items = [
        _folder(node) for node in ("recent", "playlists", "liked", "albums", "artists")
    ]
    page, next_after = _offset_page(items, after, limit)
    return _FIXED_NODES["library"], page, next_after


def _browse_home(user: dict, ref: _Ref, after, limit: int) -> _Page:
    # D8: mixes, recently played and radio; no essentials or suggestions.
    payload = get_home_discovery_snapshot(int(user["id"]))

    def rows(key: str) -> list[Any]:
        value = payload.get(key)
        return value[:_HOME_GROUP_LIMIT] if isinstance(value, list) else []

    items = _compact(
        [
            *(_mix_item(row, group="Mixes") for row in rows("custom_mixes")),
            *(
                _recent_item(row, group="Recently played")
                for row in rows("recently_played")
            ),
            *(_station_item(row, group="Radio") for row in rows("radio_stations")),
        ]
    )
    page, next_after = _offset_page(items, after, limit)
    return _FIXED_NODES["home"], page, next_after


def _browse_recent(user: dict, ref: _Ref, after, limit: int) -> _Page:
    items = _compact(
        [
            _recent_item(row)
            for row in _snapshot_list(int(user["id"]), "recently_played")
        ]
    )
    page, next_after = _offset_page(items, after, limit)
    return _FIXED_NODES["recent"], page, next_after


def _browse_radio(user: dict, ref: _Ref, after, limit: int) -> _Page:
    items = _compact(
        [
            _station_item(row)
            for row in _snapshot_list(int(user["id"]), "radio_stations")
        ]
    )
    page, next_after = _offset_page(items, after, limit)
    return _FIXED_NODES["radio"], page, next_after


def _browse_playlists(user: dict, ref: _Ref, after, limit: int) -> _Page:
    keys = _coerce(after, lambda value: coerce_keyset(value, PLAYLIST_KEYS))
    page = get_device_playlists_page(int(user["id"]), after=keys, limit=limit)
    items = [
        _item(
            f"playlist:{row['id']}",
            "playlist",
            row["name"],
            artwork_url=_album_artwork(row.get("album_entity_uid")),
            playable=True,
            browsable=True,
        )
        for row in page["items"]
    ]
    return _FIXED_NODES["playlists"], items, page["next_after"]


def _decks_page(kind: str, container_id: str, user: dict, after, limit: int):
    keys = _coerce(after, lambda value: coerce_after(kind, value))
    return get_decks_container_tracks(
        kind, container_id, user_id=int(user["id"]), after=keys, limit=limit
    )


def _browse_liked(user: dict, ref: _Ref, after, limit: int) -> _Page:
    page = _decks_page("likes", ME_CONTAINER_ID, user, after, limit) or {
        "tracks": [],
        "next_after": None,
    }
    items = _compact([_decks_track_item(row) for row in page["tracks"]])
    return _FIXED_NODES["liked"], items, page["next_after"]


def _playable_playlist(user: dict, playlist_id: str) -> dict:
    header = get_device_playlist_header(int(playlist_id), user_id=int(user["id"]))
    if not header or not header["allowed"]:
        # Another user's private playlist is indistinguishable from a missing one.
        raise HTTPException(status_code=404, detail="Playlist not found")
    return header


def _browse_playlist(user: dict, ref: _Ref, after, limit: int) -> _Page:
    header = _playable_playlist(user, ref.value)
    page = _decks_page("playlist", ref.value, user, after, limit)
    if not page or not page["allowed"]:
        raise HTTPException(status_code=404, detail="Playlist not found")
    items = _compact([_decks_track_item(row) for row in page["tracks"]])
    return str(header["name"]), items, page["next_after"]


def _browse_albums(user: dict, ref: _Ref, after, limit: int) -> _Page:
    keys = _coerce(after, lambda value: coerce_keyset(value, SAVED_ALBUM_KEYS))
    page = get_device_saved_albums_page(int(user["id"]), after=keys, limit=limit)
    return (
        _FIXED_NODES["albums"],
        _compact([_album_item(row) for row in page["items"]]),
        page["next_after"],
    )


def _browse_album(user: dict, ref: _Ref, after, limit: int) -> _Page:
    keys = _coerce(after, lambda value: coerce_keyset(value, ALBUM_TRACK_KEYS))
    page = get_device_album_page(ref.value, after=keys, limit=limit)
    if page is None:
        raise HTTPException(status_code=404, detail="Album not found")
    album = page["album"]
    artwork = _album_artwork(album["entity_uid"]) if album["has_cover"] else None
    items = _compact([_track_item(row, artwork_url=artwork) for row in page["tracks"]])
    return str(album["name"]), items, page["next_after"]


def _browse_artists(user: dict, ref: _Ref, after, limit: int) -> _Page:
    keys = _coerce(after, lambda value: coerce_keyset(value, FOLLOWED_ARTIST_KEYS))
    page = get_device_followed_artists_page(int(user["id"]), after=keys, limit=limit)
    return (
        _FIXED_NODES["artists"],
        _compact([_artist_item(row) for row in page["items"]]),
        page["next_after"],
    )


def _artist_top_tracks(artist_name: str) -> list[dict]:
    # The artist page's top tracks: Redis-cached for five minutes and built
    # from the artist's own tracks and cached Last.fm ranks, never fetched.
    from crate.api.browse_artist import _get_artist_top_tracks_payload

    return _get_artist_top_tracks_payload(artist_name, count=_ARTIST_TOP_TRACKS)


def _browse_artist(user: dict, ref: _Ref, after, limit: int) -> _Page:
    page = get_device_artist(ref.value)
    if page is None:
        raise HTTPException(status_code=404, detail="Artist not found")
    artist = page["artist"]
    items = _compact(
        [
            *(
                _track_item(
                    row,
                    artwork_url=_album_artwork(row.get("album_entity_uid")),
                    group="Top tracks",
                )
                for row in _artist_top_tracks(str(artist["name"]))
            ),
            *(_album_item(row, group="Albums") for row in page["albums"]),
        ]
    )
    sliced, next_after = _offset_page(items, after, limit)
    return str(artist["name"]), sliced, next_after


_BROWSERS: dict[str, Callable[[dict, _Ref, Any, int], _Page]] = {
    "root": _browse_root,
    "home": _browse_home,
    "library": _browse_library,
    "recent": _browse_recent,
    "playlists": _browse_playlists,
    "liked": _browse_liked,
    "albums": _browse_albums,
    "artists": _browse_artists,
    "radio": _browse_radio,
    "playlist": _browse_playlist,
    "album": _browse_album,
    "artist": _browse_artist,
}


@router.get(
    "/browse/{node}",
    response_model=DeviceBrowsePageResponse,
    responses=_BROWSE_RESPONSES,
    summary="Browse a device library node",
)
def device_browse(
    request: Request,
    node: str = Path(max_length=160),
    limit: int = Query(50, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=1024),
) -> Response:
    """One page of a node for native media browsers (Android Auto).

    Nodes: `root`, `home`, `library`, `recent`, `playlists`, `liked`, `albums`,
    `artists`, `radio`, `playlist:<id>`, `album:<uid>`, `artist:<uid>`.
    Supports If-None-Match.
    """
    user = _require_device_user(request)
    ref = _parse_ref(node)
    browse = _BROWSERS.get(ref.kind) if ref else None
    if ref is None or browse is None:
        raise HTTPException(status_code=404, detail="Node not found")
    title, items, next_after = browse(user, ref, _decode_cursor(cursor, ref.id), limit)
    payload = DeviceBrowsePageResponse.model_validate(
        {
            "node": ref.id,
            "title": title,
            "items": items,
            "next_cursor": _encode_cursor(ref.id, next_after) if next_after else None,
        }
    ).model_dump(mode="json")
    for item in payload["items"]:
        for optional in ("duration_ms", "group"):
            if item[optional] is None:
                del item[optional]
    return _conditional_json(request, payload)


# ── Search ───────────────────────────────────────────────────────


@router.get(
    "/search",
    response_model=DeviceBrowsePageResponse,
    responses=_SEARCH_RESPONSES,
    summary="Search the local catalogue for a native media browser",
)
def device_search(
    request: Request,
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(20, ge=1, le=50),
) -> Response:
    """Local artists, albums and tracks in the browse item shape.

    `limit` applies to each kind. Supports If-None-Match.
    """
    from crate.local_search import search_local_library

    _require_device_user(request)
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="The query needs two characters")
    results = search_local_library(query, limit)
    items = _compact(
        [
            *(_artist_item(row, group="Artists") for row in results.get("artists", [])),
            *(_album_item(row, group="Albums") for row in results.get("albums", [])),
            *(
                _track_item(
                    row,
                    artwork_url=(
                        _album_artwork(row.get("album_entity_uid"))
                        if row.get("has_cover", True)
                        else None
                    ),
                    group="Tracks",
                )
                for row in results.get("tracks", [])
            ),
        ]
    )
    payload = DeviceBrowsePageResponse.model_validate(
        {"node": "search", "title": query, "items": items, "next_cursor": None}
    ).model_dump(mode="json")
    for item in payload["items"]:
        if item["duration_ms"] is None:
            del item["duration_ms"]
    return _conditional_json(request, payload)


# ── Queue ────────────────────────────────────────────────────────


def _uids(rows: Sequence[dict]) -> list[str]:
    uids = []
    for row in rows:
        uid = _canonical_uuid(
            str(row.get("entity_uid") or row.get("track_entity_uid") or "")
        )
        if uid:
            uids.append(uid)
    return uids


def _mix_tracks(user: dict, mix_id: str) -> list[dict]:
    # The bound: the same Redis entry and limit as Listen's mix page, so a cold
    # mix is built at most once per user and mix every five minutes, on an
    # explicit play, never while browsing.
    from crate.api.me import (
        _get_cached_home_endpoint_response,
        _listen_global_cache_mode,
    )
    from crate.db.home import get_home_playlist

    user_id = int(user["id"])
    mix = _get_cached_home_endpoint_response(
        cache_key=(
            f"home_mix:v3:{_listen_global_cache_mode()}:{user_id}:{mix_id}"
            f":{_MIX_QUEUE_LENGTH}"
        ),
        max_age_seconds=300,
        ttl=300,
        compute=lambda: get_home_playlist(user_id, mix_id, limit=_MIX_QUEUE_LENGTH),
    )
    if not mix:
        raise HTTPException(status_code=404, detail="Mix not found")
    tracks = mix.get("tracks") if isinstance(mix, dict) else None
    return tracks if isinstance(tracks, list) else []


def _station_tracks(user: dict, descriptor: dict) -> list[dict]:
    from crate.api.radio import continuation_radio_tracks
    from crate.radio_continuation import RadioLeaseLost

    try:
        rows, _ = continuation_radio_tracks(
            descriptor,
            user=user,
            limit=_RADIO_QUEUE_LENGTH,
            exclude_entity_uids=set(),
        )
    except RadioLeaseLost as exc:
        raise HTTPException(
            status_code=409,
            detail="Radio session is busy; retry the request",
            headers={"Retry-After": "1"},
        ) from exc
    return rows


def _container_tracks(
    user: dict, ref: _Ref
) -> tuple[list[str], ContinuationDescriptor | None]:
    if ref.kind == "album":
        page = get_device_album_page(ref.value, after=None, limit=DEVICE_QUEUE_LIMIT)
        if page is None:
            raise HTTPException(status_code=404, detail="Album not found")
        return _uids(page["tracks"]), None
    if ref.kind == "playlist":
        _playable_playlist(user, ref.value)
        page = _decks_page("playlist", ref.value, user, None, DEVICE_QUEUE_LIMIT)
        if not page or not page["allowed"]:
            raise HTTPException(status_code=404, detail="Playlist not found")
        return _uids(page["tracks"]), None
    if ref.kind == "liked":
        page = _decks_page("likes", ME_CONTAINER_ID, user, None, DEVICE_QUEUE_LIMIT)
        return _uids(page["tracks"] if page else []), None
    if ref.kind == "artist":
        artist = get_device_artist(ref.value)
        if artist is None:
            raise HTTPException(status_code=404, detail="Artist not found")
        return _uids(_artist_top_tracks(str(artist["artist"]["name"]))), None
    if ref.kind == "mix":
        descriptor = ContinuationDescriptor(
            kind="seeded_radio", seedType="home_playlist", seedId=ref.value
        )
        return _uids(_mix_tracks(user, ref.value)), descriptor
    if ref.kind == "station":
        seed_kind, seed_id = ref.value.split(":", 1)
        seed_type: Literal["artist", "album"] = (
            "artist" if seed_kind == "artist" else "album"
        )
        descriptor = ContinuationDescriptor(
            kind="seeded_radio", seedType=seed_type, seedId=seed_id
        )
        rows = _station_tracks(user, descriptor.model_dump(by_alias=True))
        if not rows:
            raise HTTPException(status_code=404, detail="No radio data available yet")
        return _uids(rows), descriptor
    raise HTTPException(status_code=422, detail="This node is not playable")


def _explicit_tracks(item_ids: list[str]) -> list[str]:
    uids = []
    for item_id in item_ids:
        ref = _parse_ref(item_id)
        if ref is None or ref.kind != "track":
            raise HTTPException(
                status_code=422, detail=f"Not a track item id: {item_id[:80]}"
            )
        uids.append(ref.value)
    return uids


def _queue_track(row: dict, delivery: str) -> DeviceQueueTrackResponse | None:
    stream_delivery = "original" if delivery == "auto" else delivery
    fields = native_track_fields(
        row, stream_delivery, delivery_in_url_when_original=False
    )
    if fields is None:
        return None
    artwork = _album_artwork(row.get("album_entity_uid")) if row["has_cover"] else None
    return DeviceQueueTrackResponse(**fields, artwork=artwork)


@router.post(
    "/queue",
    response_model=DeviceQueueResponse,
    responses=_QUEUE_RESPONSES,
    summary="Resolve a container or track ids into a native-ready queue",
)
def device_queue(request: Request, body: DeviceQueueRequest) -> DeviceQueueResponse:
    """At most 500 tracks in order, with stream URLs for the device.

    Radios and mixes also return a `seeded_radio` continuation descriptor.
    """
    user = _require_device_user(request)
    if body.item_ids is not None:
        uids, continuation = _explicit_tracks(body.item_ids), None
    else:
        ref = _parse_ref(body.node or "")
        if ref is None:
            raise HTTPException(status_code=404, detail="Node not found")
        uids, continuation = _container_tracks(user, ref)
    ordered = list(dict.fromkeys(uids))[:DEVICE_QUEUE_LIMIT]
    rows = get_device_tracks_by_entity_uids(ordered)
    tracks = [
        track
        for track in (
            _queue_track(rows[uid], body.delivery) for uid in ordered if uid in rows
        )
        if track is not None
    ]
    start_ref = _parse_ref(body.start_item_id) if body.start_item_id else None
    start_uid = start_ref.value if start_ref and start_ref.kind == "track" else None
    found = next(
        (index for index, track in enumerate(tracks) if track.entity_uid == start_uid),
        None,
    )
    start_index = found or 0
    if body.shuffle and len(tracks) > 1:
        # The chosen track plays first; the rest follow in random order.
        first = tracks.pop(found) if found is not None else None
        random.shuffle(tracks)
        if first is not None:
            tracks.insert(0, first)
        start_index = 0
    return DeviceQueueResponse(
        tracks=tracks, start_index=start_index, continuation=continuation
    )


__all__ = ["router"]
