from __future__ import annotations

import json
import os
import shlex
import subprocess
from dataclasses import dataclass, field
from typing import Any

from crate.bandcamp.client import assert_bandcamp_url
from crate.bandcamp.models import BandcampSessionMaterial

RELATION_TYPES = ("collection", "wishlist", "following")


class BandcampCollectionSyncError(RuntimeError):
    pass


class BandcampCollectionSyncNotConfigured(BandcampCollectionSyncError):
    pass


@dataclass(frozen=True)
class BandcampSyncedItem:
    relation_type: str
    item: dict[str, Any]
    owned: bool = False
    downloadable: bool = False
    purchase_date: str | None = None
    added_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BandcampCollectionSyncResult:
    items: tuple[BandcampSyncedItem, ...]
    message: str = ""


def sync_collection_with_command(
    session: BandcampSessionMaterial,
    *,
    include: list[str] | tuple[str, ...],
) -> BandcampCollectionSyncResult:
    command = os.environ.get("CRATE_BANDCAMP_COLLECTION_SYNC_COMMAND", "").strip()
    if not command:
        return _sync_collection_with_web(session, include=include)

    return _sync_collection_with_command_backend(
        session, include=include, command=command
    )


def _sync_collection_with_web(
    session: BandcampSessionMaterial,
    *,
    include: list[str] | tuple[str, ...],
) -> BandcampCollectionSyncResult:
    backend = os.environ.get("CRATE_BANDCAMP_COLLECTION_SYNC_BACKEND", "web").strip()
    if backend and backend.lower() not in {"web", "native"}:
        raise BandcampCollectionSyncNotConfigured(
            "Bandcamp collection sync command is not configured"
        )

    from crate.bandcamp.web import BandcampWebClient, BandcampWebError

    timeout = float(os.environ.get("CRATE_BANDCAMP_COLLECTION_SYNC_TIMEOUT", "300"))
    page_size = int(os.environ.get("CRATE_BANDCAMP_COLLECTION_SYNC_PAGE_SIZE", "100"))
    max_pages = int(os.environ.get("CRATE_BANDCAMP_COLLECTION_SYNC_MAX_PAGES", "50"))
    try:
        payload = BandcampWebClient(session, timeout=timeout).sync_collection_payload(
            include=include,
            page_size=page_size,
            max_pages=max_pages,
        )
    except BandcampWebError as exc:
        raise BandcampCollectionSyncError(str(exc)) from exc
    return parse_collection_sync_payload(payload, include=include)


def _sync_collection_with_command_backend(
    session: BandcampSessionMaterial,
    *,
    include: list[str] | tuple[str, ...],
    command: str,
) -> BandcampCollectionSyncResult:
    timeout = float(os.environ.get("CRATE_BANDCAMP_COLLECTION_SYNC_TIMEOUT", "300"))
    payload = json.dumps(
        {
            "session": {
                "cookies": session.cookies,
                "profile": {
                    "username": session.profile.username,
                    "fan_id": session.profile.fan_id,
                    "display_name": session.profile.display_name,
                    "image_url": session.profile.image_url,
                },
            },
            "include": _normalize_include(include),
        }
    ).encode("utf-8")

    try:
        completed = subprocess.run(
            shlex.split(command),
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BandcampCollectionSyncError("Bandcamp collection sync timed out") from exc

    if completed.returncode != 0:
        raise BandcampCollectionSyncError("Bandcamp collection sync command failed")

    try:
        result = json.loads(completed.stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise BandcampCollectionSyncError(
            "Bandcamp collection sync returned invalid JSON"
        ) from exc

    if not isinstance(result, dict):
        raise BandcampCollectionSyncError(
            "Bandcamp collection sync must return an object"
        )
    return parse_collection_sync_payload(result, include=include)


def parse_collection_sync_payload(
    payload: dict[str, Any],
    *,
    include: list[str] | tuple[str, ...],
) -> BandcampCollectionSyncResult:
    include_order = _normalize_include(include)
    include_set = set(include_order)
    synced: list[BandcampSyncedItem] = []

    for relation_type in include_order:
        entries = payload.get(relation_type) or []
        if not isinstance(entries, list):
            raise BandcampCollectionSyncError(
                f"Bandcamp {relation_type} payload must be a list"
            )
        synced.extend(_normalize_entry(entry, relation_type) for entry in entries)

    flat_entries = payload.get("items") or []
    if flat_entries:
        if not isinstance(flat_entries, list):
            raise BandcampCollectionSyncError("Bandcamp items payload must be a list")
        for entry in flat_entries:
            relation_type = str(_mapping(entry).get("relation_type") or "").strip()
            if relation_type in include_set:
                synced.append(_normalize_entry(entry, relation_type))

    return BandcampCollectionSyncResult(
        items=tuple(synced),
        message=str(payload.get("message") or ""),
    )


def _normalize_entry(entry: Any, relation_type: str) -> BandcampSyncedItem:
    relation_payload = _mapping(entry)
    item_payload = _mapping(relation_payload.get("item") or relation_payload)
    item_url = _string(
        item_payload.get("item_url")
        or item_payload.get("url")
        or item_payload.get("itemUrl")
    )
    if not item_url:
        raise BandcampCollectionSyncError("Bandcamp item URL is required")
    assert_bandcamp_url(item_url)

    artist_name = _string(
        item_payload.get("artist_name")
        or item_payload.get("artist")
        or item_payload.get("band_name")
        or item_payload.get("name")
    )
    album_title = _string(
        item_payload.get("album_title")
        or item_payload.get("album")
        or item_payload.get("title")
    )
    track_title = _string(item_payload.get("track_title") or item_payload.get("track"))
    item_type = _string(
        item_payload.get("bandcamp_item_type")
        or item_payload.get("item_type")
        or item_payload.get("type")
    )
    if item_type not in {"album", "track", "artist", "fan"}:
        item_type = "track" if track_title and not album_title else "album"

    item = {
        "bandcamp_item_id": _int_or_none(
            item_payload.get("bandcamp_item_id") or item_payload.get("item_id")
        ),
        "bandcamp_item_type": item_type,
        "band_id": _int_or_none(item_payload.get("band_id")),
        "album_id": _int_or_none(item_payload.get("album_id")),
        "track_id": _int_or_none(item_payload.get("track_id")),
        "art_id": _int_or_none(item_payload.get("art_id")),
        "artist_name": artist_name,
        "album_title": album_title,
        "track_title": track_title,
        "label_name": _string(
            item_payload.get("label_name") or item_payload.get("label")
        ),
        "item_url": item_url,
        "artist_url": _optional_bandcamp_url(item_payload.get("artist_url")),
        "album_url": _optional_bandcamp_url(item_payload.get("album_url")),
        "cover_url": _string(
            item_payload.get("cover_url") or item_payload.get("image_url")
        ),
        "release_date": _string(item_payload.get("release_date")),
        "tags": _string_list(item_payload.get("tags")),
        "raw": _mapping(item_payload.get("raw") or item_payload),
    }
    default_owned = relation_type == "collection"
    return BandcampSyncedItem(
        relation_type=relation_type,
        item=item,
        owned=_bool(relation_payload.get("owned"), default_owned),
        downloadable=_bool(relation_payload.get("downloadable"), default_owned),
        purchase_date=_string(
            relation_payload.get("purchase_date") or item_payload.get("purchase_date")
        )
        or None,
        added_at=_string(
            relation_payload.get("added_at") or item_payload.get("added_at")
        )
        or None,
        raw=relation_payload,
    )


def _normalize_include(include: list[str] | tuple[str, ...]) -> list[str]:
    values = [str(value).strip() for value in include if str(value).strip()]
    normalized = [value for value in values if value in RELATION_TYPES]
    return normalized or ["collection"]


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _int_or_none(value: Any) -> int | None:
    if value in {None, ""}:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_string(item) for item in value if _string(item)]


def _optional_bandcamp_url(value: Any) -> str:
    url = _string(value)
    if not url:
        return ""
    assert_bandcamp_url(url)
    return url
