"""Artwork source selection for canonical global catalog entities."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from fastapi import HTTPException, Response

from crate.db.repositories import federation as federation_repo
from crate.federation.assertions import build_outbound_user_assertion
from crate.federation.client import DEFAULT_TIMEOUT, SignedFederationClient
from crate.federation.global_source_resolver import (
    GlobalEntityNotFound,
    NoGlobalSource,
    resolve_global_source,
)

MAX_ARTWORK_BYTES = 5 * 1024 * 1024
ARTWORK_CACHE_SECONDS = 900
ALLOWED_ARTWORK_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})


class GlobalAlbumNotFound(Exception):
    """Raised when a canonical album UID does not exist."""


class GlobalArtistNotFound(Exception):
    """Raised when a canonical artist UID does not exist."""


class NoArtworkSource(Exception):
    """Raised when a canonical album has no artwork-capable source."""


class NoArtistPhotoSource(Exception):
    """Raised when a canonical artist has no photo-capable source."""


class NoArtistBackgroundSource(Exception):
    """Raised when a canonical artist has no background-capable source."""


def resolve_global_artist_background(global_artist_uid: str) -> dict[str, Any]:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_artist_uid,
            entity_type="artist",
            facet="artist_background",
        )
    except GlobalEntityNotFound:
        raise GlobalArtistNotFound(global_artist_uid) from None
    except NoGlobalSource:
        raise NoArtistBackgroundSource(global_artist_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_artist_id": selection["local_id"],
            "local_artist_entity_uid": selection["local_entity_uid"],
        }
    return {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
        "entity_type": selection["entity_type"],
        "global_entity_uid": selection["global_entity_uid"],
        "source_revision": selection["source_revision"],
        "facet": selection["facet"],
        "facet_payload": selection["facet_payload"],
    }


def resolve_global_artist_photo(global_artist_uid: str) -> dict[str, Any]:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_artist_uid,
            entity_type="artist",
            facet="artist_photo",
        )
    except GlobalEntityNotFound:
        raise GlobalArtistNotFound(global_artist_uid) from None
    except NoGlobalSource:
        raise NoArtistPhotoSource(global_artist_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_artist_id": selection["local_id"],
            "local_artist_entity_uid": selection["local_entity_uid"],
        }
    return {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
        "entity_type": selection["entity_type"],
        "global_entity_uid": selection["global_entity_uid"],
        "source_revision": selection["source_revision"],
        "facet": selection["facet"],
        "facet_payload": selection["facet_payload"],
    }


def resolve_global_album_artwork(global_album_uid: str) -> dict[str, Any]:
    try:
        selection = resolve_global_source(
            global_entity_uid=global_album_uid,
            entity_type="album",
            facet="album_artwork",
        )
    except GlobalEntityNotFound:
        raise GlobalAlbumNotFound(global_album_uid) from None
    except NoGlobalSource:
        raise NoArtworkSource(global_album_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_album_id": selection["local_id"],
            "local_album_entity_uid": selection["local_entity_uid"],
        }
    return {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
        "entity_type": selection["entity_type"],
        "global_entity_uid": selection["global_entity_uid"],
        "source_revision": selection["source_revision"],
        "facet": selection["facet"],
        "facet_payload": selection["facet_payload"],
    }


def _serve_local_artist_photo(
    artist_entity_uid: str,
    *,
    size: int | None,
    image_format: str | None,
) -> Response:
    from crate.api._deps import library_path
    from crate.api.browse_shared import ARTIST_PHOTO_NAMES
    from crate.api.image_variants import build_image_response
    from crate.db.repositories.library import get_library_artist_by_entity_uid
    from crate.storage_layout import resolve_artist_dir

    artist = get_library_artist_by_entity_uid(artist_entity_uid)
    if artist is None:
        raise HTTPException(status_code=404, detail="Artwork not found")
    artist_dir = resolve_artist_dir(
        library_path(),
        artist,
        fallback_name=str(artist.get("name") or ""),
        existing_only=True,
    )
    if artist_dir is None:
        raise HTTPException(status_code=404, detail="Artwork not found")
    for name in ARTIST_PHOTO_NAMES:
        path = artist_dir / name
        if not path.is_file():
            continue
        media_type = {
            ".png": "image/png",
            ".webp": "image/webp",
        }.get(path.suffix.lower(), "image/jpeg")
        return build_image_response(
            path.read_bytes(),
            media_type,
            size=size,
            output_format=image_format,
            headers={"Cache-Control": f"private, max-age={ARTWORK_CACHE_SECONDS}"},
        )
    raise HTTPException(status_code=404, detail="Artwork not found")


def _remote_artwork(
    selection: dict[str, Any],
    *,
    entity_type: str,
    user: dict,
    size: int | None,
    image_format: str | None,
) -> Response:
    local_node = federation_repo.get_local_node()
    peer = federation_repo.get_peer(str(selection["node_uid"]))
    if (
        local_node is None
        or peer is None
        or peer.get("trust_state") != "approved"
        or peer.get("disabled_at") is not None
    ):
        raise HTTPException(status_code=503, detail="Artwork source is unavailable")

    asset_name = "cover" if entity_type == "album" else "photo"
    query = urlencode(
        {
            key: value
            for key, value in {"size": size, "format": image_format}.items()
            if value is not None
        }
    )
    path = (
        f"/api/federation/v1/assets/{entity_type}/"
        f"{selection['remote_entity_uid']}/{asset_name}"
    )
    if query:
        path = f"{path}?{query}"

    assertion = build_outbound_user_assertion(
        local_node=local_node,
        peer=peer,
        user=user,
        purpose="artwork.read",
        capabilities=["federation.catalog.search"],
    )
    try:
        with SignedFederationClient(
            base_url=peer["api_base_url"],
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
            timeout=DEFAULT_TIMEOUT,
            max_response_bytes=MAX_ARTWORK_BYTES,
        ) as client:
            upstream = client.request("GET", path, user_assertion=assertion)
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail="Artwork response is invalid"
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail="Artwork source is unavailable"
        ) from exc

    if upstream.status_code == 404:
        raise HTTPException(status_code=404, detail="Artwork not found")
    if upstream.status_code >= 400:
        raise HTTPException(status_code=502, detail="Artwork source returned an error")

    content_type = upstream.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type not in ALLOWED_ARTWORK_TYPES:
        raise HTTPException(status_code=502, detail="Artwork response is invalid")
    if len(upstream.content) > MAX_ARTWORK_BYTES:
        raise HTTPException(status_code=502, detail="Artwork response is invalid")
    return Response(
        content=upstream.content,
        media_type=content_type,
        headers={"Cache-Control": f"private, max-age={ARTWORK_CACHE_SECONDS}"},
    )


def serve_global_artwork(
    global_entity_uid: str,
    *,
    entity_type: str,
    user: dict,
    size: int | None = None,
    image_format: str | None = None,
) -> Response:
    if entity_type == "album":
        try:
            selection = resolve_global_album_artwork(global_entity_uid)
        except (GlobalAlbumNotFound, NoArtworkSource) as exc:
            raise HTTPException(status_code=404, detail="Artwork not found") from exc
        if selection["kind"] == "local":
            from crate.api.browse_album import api_cover_by_id

            return api_cover_by_id(
                int(selection["local_album_id"]),
                size=size,
                image_format=image_format,
            )
    elif entity_type == "artist":
        try:
            selection = resolve_global_artist_photo(global_entity_uid)
        except (GlobalArtistNotFound, NoArtistPhotoSource) as exc:
            raise HTTPException(status_code=404, detail="Artwork not found") from exc
        if selection["kind"] == "local":
            return _serve_local_artist_photo(
                str(selection["local_artist_entity_uid"]),
                size=size,
                image_format=image_format,
            )
    else:
        raise HTTPException(status_code=404, detail="Artwork not found")

    return _remote_artwork(
        selection,
        entity_type=entity_type,
        user=user,
        size=size,
        image_format=image_format,
    )


__all__ = [
    "GlobalAlbumNotFound",
    "GlobalArtistNotFound",
    "NoArtistBackgroundSource",
    "NoArtworkSource",
    "NoArtistPhotoSource",
    "resolve_global_artist_background",
    "resolve_global_artist_photo",
    "resolve_global_album_artwork",
    "serve_global_artwork",
]
