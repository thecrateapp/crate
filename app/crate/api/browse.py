import logging

from fastapi import APIRouter, Request

from crate.api.auth import _require_auth
from crate.api.browse_album import router as album_router
from crate.api.browse_artist import api_browse_filters, router as artist_router
from crate.api.browse_media import api_browse_moods, router as media_router
from crate.api.curation import curated_playlists
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas import BrowseExplorePageResponse
from crate.db.cache_store import get_cache, set_cache
from crate.db.queries.global_catalog import list_global_catalog_genres
from crate.db.repositories.global_catalog_state import (
    catalog_serves_global,
    get_catalog_state,
)
from crate.db.ui_snapshot_reads import get_ui_snapshot
from crate.db.ui_snapshot_shared import decorate_snapshot

router = APIRouter()
router.include_router(artist_router)
router.include_router(album_router)
router.include_router(media_router)

_EXPLORE_PAGE_CACHE_TTL_SECONDS = 600
_GLOBAL_GENRES_SNAPSHOT_MAX_AGE_SECONDS = 86_400
log = logging.getLogger(__name__)


def _global_genres_snapshot_items() -> list[dict] | None:
    try:
        snapshot = get_ui_snapshot(
            "global-catalog-genres",
            "crate-core",
            max_age_seconds=_GLOBAL_GENRES_SNAPSHOT_MAX_AGE_SECONDS,
        )
    except Exception:
        log.debug("Global genre snapshot unavailable", exc_info=True)
        return None
    if not snapshot:
        return None
    items = decorate_snapshot(snapshot).get("items")
    return list(items) if isinstance(items, list) else None


def _explore_genres(local_genres: list[dict]) -> list[dict]:
    try:
        if not catalog_serves_global(get_catalog_state()):
            return local_genres
        global_genres = _global_genres_snapshot_items()
        if global_genres is None:
            global_genres = list_global_catalog_genres()
    except Exception:
        log.warning(
            "Global genre summaries unavailable; using local Explore genres",
            exc_info=True,
        )
        return local_genres

    payloads = [
        {
            "name": genre["canonical_name"],
            "slug": genre["canonical_slug"],
            "cnt": int(genre.get("artist_count") or 0),
            "count": int(genre.get("artist_count") or 0),
            "description": genre.get("description"),
            "top_artists": list(genre.get("top_artists") or []),
            "cover_url": genre.get("cover_url"),
        }
        for genre in global_genres
        if int(genre.get("artist_count") or 0) > 0
    ]
    return payloads or local_genres


@router.get(
    "/api/browse/explore-page",
    response_model=BrowseExplorePageResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the bundled Explore page payload",
)
def api_browse_explore_page(request: Request):
    user = _require_auth(request)
    cache_key = f"listen:explore_page:v1:{user['id']}"
    cached = get_cache(cache_key, max_age_seconds=_EXPLORE_PAGE_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    filters = dict(api_browse_filters(request))
    filters["genres"] = _explore_genres(list(filters.get("genres") or []))
    payload = {
        "filters": filters,
        "playlists": curated_playlists(request)[:8],
        "moods": api_browse_moods(request),
    }
    set_cache(cache_key, payload, ttl=_EXPLORE_PAGE_CACHE_TTL_SECONDS)
    return payload
