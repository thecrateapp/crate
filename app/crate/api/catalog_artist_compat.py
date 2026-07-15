"""Human artist route compatibility backed by the canonical catalog."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from crate.api.auth import _require_auth
from crate.api.browse_artist import (
    _BROWSE_RESPONSES,
    _build_artist_page_payload,
    api_artist_top_tracks,
)
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.browse import ArtistPageResponse, ArtistTopTrackResponse
from crate.db.queries.global_catalog import (
    GlobalCatalogPublicRouteConflict,
    get_global_artist_page_by_public_slug,
)
from crate.db.repositories.library import get_library_artist_by_slug

router = APIRouter(tags=["catalog"])


def _hydrate_public_page(request: Request, payload: dict) -> dict:
    from crate.api.catalog import hydrate_catalog_artist_page

    artist = payload.get("artist") or {}
    global_artist_uid = artist.get("global_artist_uid") or artist.get("global_uid")
    if not global_artist_uid:
        return payload
    return hydrate_catalog_artist_page(request, str(global_artist_uid), payload)


@router.get(
    "/api/artist-slugs/{artist_slug}/page",
    response_model=ArtistPageResponse,
    responses=_BROWSE_RESPONSES,
    summary="Get a listen-optimized artist page payload by slug",
)
def api_artist_page_by_slug(
    request: Request,
    artist_slug: str,
    top_tracks_count: int = Query(12, ge=1, le=50),
    shows_limit: int = Query(12, ge=1, le=50),
    stats_window: str = Query("30d"),
    stats_limit: int = Query(12, ge=1, le=50),
):
    user = _require_auth(request)
    artist = get_library_artist_by_slug(artist_slug)
    if not artist:
        try:
            payload = get_global_artist_page_by_public_slug(artist_slug)
        except GlobalCatalogPublicRouteConflict:
            return JSONResponse(
                {"error": "Ambiguous public artist route"}, status_code=409
            )
        if not payload:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return _hydrate_public_page(request, payload)
    try:
        payload = _build_artist_page_payload(
            request,
            user_id=user["id"],
            artist_id=artist["id"],
            artist_slug=artist_slug,
            top_tracks_count=top_tracks_count,
            shows_limit=shows_limit,
            stats_window=stats_window,
            stats_limit=stats_limit,
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    if isinstance(payload, JSONResponse):
        return payload
    try:
        canonical = get_global_artist_page_by_public_slug(artist_slug)
    except GlobalCatalogPublicRouteConflict:
        return JSONResponse({"error": "Ambiguous public artist route"}, status_code=409)
    if not canonical:
        return payload
    from crate.api.catalog import _merge_global_artist_identity

    canonical_artist = canonical.get("artist") or {}
    global_artist_uid = canonical_artist.get("global_artist_uid")
    if not global_artist_uid:
        return payload
    return _merge_global_artist_identity(payload, str(global_artist_uid), canonical)


@router.get(
    "/api/artist-slugs/{artist_slug}/top-tracks",
    response_model=list[ArtistTopTrackResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="Get top tracks for an artist by slug",
)
def api_artist_top_tracks_by_slug(
    request: Request, artist_slug: str, count: int = Query(20, ge=1, le=50)
):
    artist = get_library_artist_by_slug(artist_slug)
    if artist:
        local_tracks = api_artist_top_tracks(request, artist["id"], count=count)
        try:
            canonical = get_global_artist_page_by_public_slug(
                artist_slug, top_tracks_limit=count
            )
        except GlobalCatalogPublicRouteConflict:
            return JSONResponse([], status_code=409)
        if not canonical:
            return local_tracks
        from crate.api.catalog import _merge_catalog_identity_lists

        return _merge_catalog_identity_lists(
            local_tracks,
            canonical.get("top_tracks"),
            entity_type="track",
        )

    _require_auth(request)
    try:
        payload = get_global_artist_page_by_public_slug(
            artist_slug, top_tracks_limit=count
        )
    except GlobalCatalogPublicRouteConflict:
        return JSONResponse([], status_code=409)
    if not payload:
        return JSONResponse([], status_code=200)
    return _hydrate_public_page(request, payload).get("top_tracks", [])[:count]
