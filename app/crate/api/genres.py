import re
from datetime import date

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from crate.api.auth import _require_auth
from crate.api.image_variants import build_image_response
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.genres import (
    EqPresetUpdateResponse,
    GenreDeleteResponse,
    GenreDetailResponse,
    GenreGraphResponse,
    GenreSummaryResponse,
    GenreTaxonomyAliasesUpdateRequest,
    GenreTaxonomyAliasesUpdateResponse,
    GenreTaxonomyCoverUpdateResponse,
    GenreTaxonomyNodeProposalApplyRequest,
    GenreTaxonomyNodeProposalApplyResponse,
    GenreTaxonomyNodeProposalResponse,
    GenreTaxonomyNodeUpdateRequest,
    GenreTaxonomyNodeUpdateResponse,
    GenreTaxonomyRebuildProposalRequest,
    GenreTaxonomyRelationsUpdateRequest,
    GenreTaxonomyRelationsUpdateResponse,
    GenreTaxonomyInvalidStatusResponse,
    GenreTaxonomyTreeResponse,
    SoundIntelligenceHealthResponse,
)
from crate.api.schemas.common import TaskEnqueueResponse
from crate.db.genres import (
    get_all_genres,
    get_genre_detail,
    get_genre_graph,
    get_genre_taxonomy_cover_path,
    get_genre_taxonomy_node_id,
    get_unmapped_genres,
    list_invalid_genre_taxonomy_nodes,
    set_genre_eq_gains,
)
from crate.db.queries.genres_library_detail import get_genre_upcoming_shows
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.auth import get_user_by_id
from crate.db.repositories.tasks import create_task
from crate.db.queries.sound_intelligence import get_sound_intelligence_health
from crate.db.repositories.genres_taxonomy_edges import (
    VALID_RELATION_TYPES,
    replace_genre_taxonomy_edges,
)
from crate.db.repositories.genres_taxonomy_metadata import (
    update_genre_taxonomy_node_metadata,
)
from crate.db.repositories.genres_taxonomy_nodes import upsert_genre_taxonomy_node
from crate.db.repositories.genres_delete import (
    delete_library_genre,
    delete_taxonomy_genre,
)
from crate.genre_covers import (
    genre_cover_abspath,
    genre_cover_media_type,
    genre_cover_public_url,
    persist_genre_cover_upload,
)
from crate.db.jobs.genre_taxonomy import assign_genre_alias_value
from crate.genre_taxonomy import (
    invalidate_runtime_taxonomy_cache,
    resolve_genre_eq_preset,
)
from crate.genre_taxonomy_proposals import build_genre_taxonomy_node_proposal

router = APIRouter(prefix="/api/genres", tags=["genres"])

_GENRE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        404: error_response("The requested genre could not be found."),
    },
)

_GENRE_ADMIN_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request payload could not be processed."),
        404: error_response("The requested genre could not be found."),
        422: error_response("The request payload failed validation."),
    },
)

_GENRE_IMAGE_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        200: {
            "description": "Binary image response.",
            "content": {
                "image/jpeg": {},
                "image/png": {},
                "image/webp": {},
            },
        },
        404: error_response("The requested genre cover could not be found."),
    },
)


def _require_genre_curator(request: Request) -> dict:
    return require_permission(request, "curation.genres.write")


def _broadcast_genre_taxonomy_changed(*scopes: str) -> None:
    try:
        from crate.api.cache_events import broadcast_invalidation

        broadcast_invalidation("library", "home", "curation", *scopes)
    except Exception:
        pass


def _normalize_taxonomy_slug(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")


def _coerce_api_date(value) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")


def _genre_show_location(
    request: Request, user_id: int
) -> tuple[float, float, int] | None:
    full_user = get_user_by_id(user_id) or {}
    user_lat, user_lon = None, None
    location_mode = full_user.get("show_location_mode") or "fixed"
    if location_mode == "near_me":
        from crate.geolocation import detect_location_from_ip, get_client_ip

        geo = detect_location_from_ip(get_client_ip(request))
        if geo:
            user_lat, user_lon = geo["latitude"], geo["longitude"]
    else:
        user_lat = full_user.get("latitude")
        user_lon = full_user.get("longitude")

    if user_lat is None or user_lon is None:
        return None
    return float(user_lat), float(user_lon), int(full_user.get("show_radius_km") or 60)


def _genre_show_payload(show: dict) -> dict:
    city = show.get("city") or ""
    country = show.get("country") or ""
    return {
        "id": show.get("id"),
        "type": "show",
        "date": _coerce_api_date(show.get("date")),
        "time": show.get("local_time"),
        "artist": show.get("artist_name") or "",
        "artist_id": show.get("artist_id"),
        "artist_slug": show.get("artist_slug"),
        "title": show.get("venue") or "",
        "subtitle": ", ".join(part for part in [city, country] if part),
        "cover_url": show.get("image_url"),
        "status": show.get("status") or "onsale",
        "is_upcoming": True,
        "url": show.get("tickets_url") or show.get("url") or show.get("lastfm_url"),
        "venue": show.get("venue"),
        "address_line1": show.get("address_line1"),
        "city": show.get("city"),
        "region": show.get("region"),
        "postal_code": show.get("postal_code"),
        "country": show.get("country"),
        "country_code": show.get("country_code"),
        "latitude": show.get("latitude"),
        "longitude": show.get("longitude"),
        "lineup": show.get("lineup"),
        "genres": list(show.get("artist_genres") or [])[:3],
        "source": show.get("source"),
        "lastfm_attendance": show.get("lastfm_attendance"),
        "lastfm_url": show.get("lastfm_url"),
        "tickets_url": show.get("tickets_url"),
        "distance_km": show.get("distance_km"),
    }


def _genre_show_items(request: Request, user_id: int, slug: str) -> list[dict]:
    location = _genre_show_location(request, user_id)
    if not location:
        return []
    latitude, longitude, radius_km = location
    shows = get_genre_upcoming_shows(
        slug,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
        limit=5,
    )
    return [_genre_show_payload(show) for show in shows]


def _proposal_alias_candidates(
    raw_slug: str,
    body: GenreTaxonomyNodeProposalApplyRequest,
) -> list[str]:
    aliases = [
        raw_slug,
        raw_slug.replace("-", " "),
        body.name or "",
        *(body.aliases or []),
    ]
    result: list[str] = []
    seen: set[str] = set()
    for alias in aliases:
        value = (alias or "").strip()
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _get_or_create_task(task_type: str, params: dict, max_limit: int = 500) -> dict:
    """Dedup: return existing pending/running task or create a new one."""
    for status in ("running", "pending"):
        existing = list_tasks(status=status, task_type=task_type, limit=1)
        if existing:
            return {
                "task_id": existing[0]["id"],
                "status": existing[0]["status"],
                "deduplicated": True,
            }
    task_id = create_task(task_type, params)
    return {"task_id": task_id, "status": "queued", "deduplicated": False}


class InferTaxonomyBody(BaseModel):
    limit: int = Field(200, ge=1, le=500)
    focus_slug: str | None = None
    include_external: bool = True
    aggressive: bool = True


class EnrichDescriptionsBody(BaseModel):
    limit: int = Field(120, ge=1, le=500)
    focus_slug: str | None = None
    force: bool = False


class MusicBrainzSyncBody(BaseModel):
    limit: int = Field(80, ge=1, le=300)
    focus_slug: str | None = None
    force: bool = False


# 10-band EQ contract, matches the frontend EQ_BANDS + EQ_GAIN_MIN/MAX.
_EQ_BAND_COUNT = 10
_EQ_GAIN_MIN = -12.0
_EQ_GAIN_MAX = 12.0


class EqPresetBody(BaseModel):
    # None = clear the preset (the node will inherit from its first
    # ancestor that has one). Array must be exactly 10 floats.
    gains: list[float] | None = Field(default=None)


@router.get(
    "",
    response_model=list[GenreSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List genres in the library",
)
def list_genres(request: Request):
    _require_auth(request)
    return get_all_genres()


@router.get(
    "/unmapped",
    response_model=list[GenreSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List unmapped raw library genres",
)
def list_unmapped_genres(request: Request, limit: int = Query(24, ge=1, le=200)):
    _require_auth(request)
    return get_unmapped_genres(limit=limit)


@router.get(
    "/taxonomy/invalid",
    response_model=GenreTaxonomyInvalidStatusResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Inspect invalid genre taxonomy nodes",
)
def get_invalid_taxonomy_nodes(request: Request, limit: int = Query(8, ge=1, le=50)):
    _require_genre_curator(request)
    items = list_invalid_genre_taxonomy_nodes()
    return {
        "invalid_count": len(items),
        "alias_count": sum(int(item.get("alias_count") or 0) for item in items),
        "edge_count": sum(int(item.get("edge_count") or 0) for item in items),
        "items": items[:limit],
    }


@router.get(
    "/sound-intelligence/health",
    response_model=SoundIntelligenceHealthResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Inspect EQ coverage and genre taxonomy health",
)
def get_sound_intelligence_health_snapshot(request: Request):
    _require_genre_curator(request)
    return get_sound_intelligence_health()


@router.post(
    "/taxonomy/rebuild-proposal",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue a review-only full genre taxonomy rebuild proposal",
)
def rebuild_taxonomy_proposal(
    request: Request,
    body: GenreTaxonomyRebuildProposalRequest | None = None,
):
    _require_genre_curator(request)
    body = body or GenreTaxonomyRebuildProposalRequest.model_validate({})
    return _get_or_create_task(
        "rebuild_genre_taxonomy_proposals",
        {
            "alias_limit": body.alias_limit,
            "node_limit": body.node_limit,
            "include_external": body.include_external,
            "aggressive": body.aggressive,
        },
    )


@router.get(
    "/taxonomy/tree",
    response_model=GenreTaxonomyTreeResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Full taxonomy tree with parent/children refs, EQ preset status, and counts",
)
def taxonomy_tree(request: Request):
    _require_auth(request)
    from crate.genre_taxonomy import get_genre_catalog, resolve_genre_eq_preset
    from crate.db.genres import get_all_genres

    catalog = get_genre_catalog()
    genre_list = get_all_genres()
    counts: dict[str, dict[str, int]] = {}
    mbids: dict[str, str | None] = {}
    wikidata_urls: dict[str, str | None] = {}
    for g in genre_list:
        cs = g.get("canonical_slug")
        if cs:
            existing = counts.get(cs, {"artist_count": 0, "album_count": 0})
            existing["artist_count"] += g.get("artist_count") or 0
            existing["album_count"] += g.get("album_count") or 0
            counts[cs] = existing
            if g.get("musicbrainz_mbid"):
                mbids[cs] = g["musicbrainz_mbid"]
            if g.get("wikidata_url"):
                wikidata_urls[cs] = g["wikidata_url"]

    nodes = []
    top_level_slugs = []
    for slug, meta in catalog.items():
        preset = resolve_genre_eq_preset(slug)
        c = counts.get(slug, {"artist_count": 0, "album_count": 0})
        children = sorted(s for s, m in catalog.items() if slug in m.get("parents", []))
        influences = sorted(
            s for s, m in catalog.items() if slug in m.get("influenced_by", [])
        )
        fusion_genres = sorted(
            s for s, m in catalog.items() if slug in m.get("fusion_of", [])
        )
        node = {
            "slug": slug,
            "name": meta["name"],
            "description": meta.get("description") or None,
            "musicbrainz_mbid": mbids.get(slug),
            "wikidata_url": wikidata_urls.get(slug),
            "top_level": meta.get("top_level", False),
            "parent_slugs": meta.get("parents", []),
            "children_slugs": children,
            "related_slugs": meta.get("related", []),
            "influenced_by_slugs": meta.get("influenced_by", []),
            "influences_slugs": influences,
            "fusion_of_slugs": meta.get("fusion_of", []),
            "fusion_genre_slugs": fusion_genres,
            "alias_names": meta.get("aliases", []),
            "artist_count": c["artist_count"],
            "album_count": c["album_count"],
            "eq_gains": list(preset["gains"]) if preset else None,
            "eq_preset_source": preset["source"] if preset else None,
            "eq_preset_inherited_from": preset.get("slug")
            if preset and preset["source"] == "inherited"
            else None,
        }
        nodes.append(node)
        if meta.get("top_level", False):
            top_level_slugs.append(slug)

    return {"nodes": nodes, "top_level_slugs": sorted(top_level_slugs)}


@router.patch(
    "/taxonomy/{slug}",
    response_model=GenreTaxonomyNodeUpdateResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Update editable taxonomy node metadata",
)
def update_taxonomy_node(
    request: Request,
    slug: str,
    body: GenreTaxonomyNodeUpdateRequest,
):
    _require_genre_curator(request)
    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not get_genre_taxonomy_node_id(canonical_slug):
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")
    updated = update_genre_taxonomy_node_metadata(
        canonical_slug,
        name=body.name,
        description=body.description,
        top_level=body.top_level,
    )
    if not updated:
        raise HTTPException(status_code=400, detail="No taxonomy metadata changed")
    invalidate_runtime_taxonomy_cache(broadcast=True)
    _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")
    return {"ok": True, "slug": canonical_slug}


@router.post(
    "/taxonomy/{slug}/cover",
    response_model=GenreTaxonomyCoverUpdateResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Upload a curated cover image for a taxonomy genre",
)
async def upload_taxonomy_cover(
    request: Request,
    slug: str,
    file: UploadFile = File(...),
):
    _require_genre_curator(request)
    canonical_slug = _normalize_taxonomy_slug(slug)
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not get_genre_taxonomy_node_id(canonical_slug):
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")

    payload = await file.read()
    try:
        cover_path = persist_genre_cover_upload(
            canonical_slug,
            filename=file.filename or "",
            content_type=file.content_type,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    updated = update_genre_taxonomy_node_metadata(canonical_slug, cover_path=cover_path)
    if not updated:
        raise HTTPException(status_code=400, detail="No taxonomy cover changed")

    invalidate_runtime_taxonomy_cache(broadcast=True)
    _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")
    return {
        "ok": True,
        "slug": canonical_slug,
        "cover_url": genre_cover_public_url(canonical_slug),
    }


@router.delete(
    "/taxonomy/{slug}",
    response_model=GenreDeleteResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Delete a canonical taxonomy node and its mapped raw genre assignments",
)
def delete_taxonomy_node(request: Request, slug: str):
    _require_genre_curator(request)
    canonical_slug = _normalize_taxonomy_slug(slug)
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    result = delete_taxonomy_genre(canonical_slug)
    if not result:
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")
    _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")
    return {"ok": True, **result}


@router.post(
    "/taxonomy/{slug}/proposal",
    response_model=GenreTaxonomyNodeProposalResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Generate a reviewable AI proposal for one taxonomy node",
)
def infer_taxonomy_node_proposal(
    request: Request,
    slug: str,
):
    _require_genre_curator(request)
    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    proposal = build_genre_taxonomy_node_proposal(canonical_slug)
    if not proposal.get("ok"):
        raise HTTPException(status_code=404, detail="Genre not found")
    return proposal


@router.post(
    "/taxonomy/{slug}/proposal/apply",
    response_model=GenreTaxonomyNodeProposalApplyResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Apply a reviewed AI taxonomy proposal",
)
def apply_taxonomy_node_proposal(
    request: Request,
    slug: str,
    body: GenreTaxonomyNodeProposalApplyRequest,
):
    user = _require_genre_curator(request)
    raw_slug = _normalize_taxonomy_slug(slug)
    if not raw_slug:
        raise HTTPException(status_code=400, detail="Slug is required")

    action = (body.recommended_action or "").strip().lower()
    if action not in {
        "create_node",
        "alias_existing",
        "delete_marginal",
        "needs_review",
    }:
        raise HTTPException(status_code=400, detail="Unsupported proposal action")
    if action == "needs_review":
        raise HTTPException(
            status_code=400,
            detail="This proposal still needs curator review before applying",
        )

    applied_aliases: list[str] = []
    skipped_aliases: list[str] = []
    relation_results: list[dict] = []

    if action in {"alias_existing", "delete_marginal"}:
        target_slug = _normalize_taxonomy_slug(body.recommended_target_slug)
        if not target_slug:
            raise HTTPException(status_code=400, detail="Target slug is required")
        if not get_genre_taxonomy_node_id(target_slug):
            raise HTTPException(status_code=404, detail="Target genre not found")

        for alias in _proposal_alias_candidates(raw_slug, body):
            if assign_genre_alias_value(alias, target_slug):
                applied_aliases.append(alias)
            else:
                skipped_aliases.append(alias)

        invalidate_runtime_taxonomy_cache(broadcast=True)
        _broadcast_genre_taxonomy_changed(f"genre:{raw_slug}", f"genre:{target_slug}")
        return {
            "ok": True,
            "slug": raw_slug,
            "action": action,
            "target_slug": target_slug,
            "applied_aliases": applied_aliases,
            "skipped_aliases": skipped_aliases,
            "relation_results": [],
        }

    node = upsert_genre_taxonomy_node(
        raw_slug,
        name=body.name or raw_slug.replace("-", " ").title(),
        description=body.description,
        is_top_level=False,
    )
    if not node:
        raise HTTPException(status_code=400, detail="Could not create taxonomy node")
    node_slug = str(node["slug"])

    for alias in _proposal_alias_candidates(node_slug, body):
        if assign_genre_alias_value(alias, node_slug):
            applied_aliases.append(alias)
        else:
            skipped_aliases.append(alias)

    for relation in body.relations:
        relation_type = (relation.relation_type or "").strip().lower()
        if relation_type not in VALID_RELATION_TYPES:
            continue
        result = replace_genre_taxonomy_edges(
            node_slug,
            relation_type=relation_type,
            target_slugs=relation.target_slugs,
            created_by=int(user["id"]),
            source="ai_proposal",
        )
        relation_results.append(
            {
                "ok": bool(result.get("updated")),
                "slug": node_slug,
                "relation_type": relation_type,
                "added": result.get("added") or [],
                "missing": result.get("missing") or [],
            }
        )

    invalidate_runtime_taxonomy_cache(broadcast=True)
    _broadcast_genre_taxonomy_changed(f"genre:{raw_slug}", f"genre:{node_slug}")
    return {
        "ok": True,
        "slug": raw_slug,
        "action": action,
        "target_slug": node_slug,
        "applied_aliases": applied_aliases,
        "skipped_aliases": skipped_aliases,
        "relation_results": relation_results,
    }


@router.put(
    "/taxonomy/{slug}/relations",
    response_model=GenreTaxonomyRelationsUpdateResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Replace one editable relation set for a taxonomy node",
)
def update_taxonomy_relations(
    request: Request,
    slug: str,
    body: GenreTaxonomyRelationsUpdateRequest,
):
    user = _require_genre_curator(request)
    canonical_slug = (slug or "").strip().lower()
    relation_type = (body.relation_type or "").strip().lower()
    if relation_type not in VALID_RELATION_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported relation_type")
    if not get_genre_taxonomy_node_id(canonical_slug):
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")
    result = replace_genre_taxonomy_edges(
        canonical_slug,
        relation_type=relation_type,
        target_slugs=body.target_slugs,
        created_by=int(user["id"]),
        source="manual",
    )
    invalidate_runtime_taxonomy_cache(broadcast=True)
    _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")
    return {
        "ok": bool(result.get("updated")),
        "slug": canonical_slug,
        "relation_type": relation_type,
        "added": result.get("added") or [],
        "missing": result.get("missing") or [],
    }


@router.put(
    "/taxonomy/{slug}/aliases",
    response_model=GenreTaxonomyAliasesUpdateResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Assign proposed raw aliases to a taxonomy node",
)
def update_taxonomy_aliases(
    request: Request,
    slug: str,
    body: GenreTaxonomyAliasesUpdateRequest,
):
    _require_genre_curator(request)
    canonical_slug = (slug or "").strip().lower()
    if not get_genre_taxonomy_node_id(canonical_slug):
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")

    applied: list[str] = []
    skipped: list[str] = []
    for alias in body.alias_names:
        alias_name = (alias or "").strip()
        if not alias_name:
            continue
        if assign_genre_alias_value(alias_name, canonical_slug):
            applied.append(alias_name)
        else:
            skipped.append(alias_name)

    if applied:
        invalidate_runtime_taxonomy_cache(broadcast=True)
        _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")
    return {
        "ok": True,
        "slug": canonical_slug,
        "applied": applied,
        "skipped": skipped,
    }


@router.delete(
    "/{slug}",
    response_model=GenreDeleteResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Delete a raw library genre and remove it from artists/albums",
)
def delete_genre(request: Request, slug: str):
    _require_genre_curator(request)
    genre_slug = _normalize_taxonomy_slug(slug)
    if not genre_slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    result = delete_library_genre(genre_slug)
    if not result:
        raise HTTPException(status_code=404, detail="Genre not found")
    _broadcast_genre_taxonomy_changed(f"genre:{genre_slug}")
    return {"ok": True, **result}


@router.get(
    "/{slug}/cover",
    responses=_GENRE_IMAGE_RESPONSES,
    summary="Get a curated genre cover image",
)
def genre_cover(
    request: Request,
    slug: str,
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    _require_auth(request)
    canonical_slug = _normalize_taxonomy_slug(slug)
    if not canonical_slug:
        return Response(status_code=404)
    cover_path = get_genre_taxonomy_cover_path(canonical_slug)
    absolute = genre_cover_abspath(cover_path)
    if not absolute or not absolute.exists():
        return Response(status_code=404)
    return build_image_response(
        absolute.read_bytes(),
        genre_cover_media_type(absolute),
        size=size,
        output_format=image_format,
        headers={
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
        },
    )


@router.get(
    "/{slug}/graph",
    response_model=GenreGraphResponse,
    responses=_GENRE_RESPONSES,
    summary="Get the genre taxonomy graph for a genre",
)
def genre_graph(request: Request, slug: str):
    _require_auth(request)
    graph = get_genre_graph(slug)
    if not graph:
        raise HTTPException(status_code=404, detail="Genre not found")
    return graph


@router.get(
    "/{slug}",
    response_model=GenreDetailResponse,
    responses=_GENRE_RESPONSES,
    summary="Get detailed genre information",
)
def genre_detail(request: Request, slug: str):
    user = _require_auth(request)
    genre = get_genre_detail(slug)
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    genre["shows"] = _genre_show_items(request, int(user["id"]), slug)
    return genre


@router.post(
    "/index",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue a full genre index rebuild",
)
def reindex_genres(request: Request):
    _require_genre_curator(request)
    task_id = create_task("index_genres")
    return {"task_id": task_id}


@router.post(
    "/infer",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue genre taxonomy inference",
)
def infer_genre_taxonomy(request: Request, body: InferTaxonomyBody | None = None):
    _require_genre_curator(request)
    body = body or InferTaxonomyBody.model_validate({})
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task(
        "infer_genre_taxonomy",
        {
            "limit": body.limit,
            "focus_slug": slug,
            "include_external": body.include_external,
            "aggressive": body.aggressive,
        },
    )


@router.post(
    "/descriptions/enrich",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue genre description enrichment",
)
def enrich_genre_descriptions(
    request: Request, body: EnrichDescriptionsBody | None = None
):
    _require_genre_curator(request)
    body = body or EnrichDescriptionsBody.model_validate({})
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task(
        "enrich_genre_descriptions",
        {
            "limit": body.limit,
            "focus_slug": slug,
            "force": body.force,
        },
    )


@router.post(
    "/musicbrainz/sync",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue MusicBrainz genre graph sync",
)
def sync_musicbrainz_genre_graph(
    request: Request, body: MusicBrainzSyncBody | None = None
):
    _require_genre_curator(request)
    body = body or MusicBrainzSyncBody.model_validate({})
    slug = (body.focus_slug or "").strip().lower() or None
    return _get_or_create_task(
        "sync_musicbrainz_genre_graph",
        {
            "limit": body.limit,
            "focus_slug": slug,
            "force": body.force,
        },
    )


@router.post(
    "/taxonomy/cleanup-invalid",
    response_model=TaskEnqueueResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Queue cleanup of invalid genre taxonomy nodes",
)
def cleanup_invalid_taxonomy_nodes(request: Request):
    _require_genre_curator(request)
    return _get_or_create_task("cleanup_invalid_genre_taxonomy", {})


@router.patch(
    "/{slug}/eq-preset",
    response_model=EqPresetUpdateResponse,
    responses=_GENRE_ADMIN_RESPONSES,
    summary="Update the EQ preset for a canonical genre",
)
def update_genre_eq_preset(request: Request, slug: str, body: EqPresetBody):
    """Set or clear the EQ preset for a canonical genre.

    Passing ``gains: null`` drops the row's eq_gains back to NULL, making
    it inherit from its first ancestor that has a preset. Otherwise the
    array must have exactly 10 floats; values are clamped to
    [EQ_GAIN_MIN, EQ_GAIN_MAX].
    """
    _require_genre_curator(request)

    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")

    gains_param: list[float] | None = None
    if body.gains is not None:
        if len(body.gains) != _EQ_BAND_COUNT:
            raise HTTPException(
                status_code=400,
                detail=f"gains must have exactly {_EQ_BAND_COUNT} entries",
            )
        clamped: list[float] = []
        for value in body.gains:
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="gains must be numeric")
            if numeric != numeric:  # NaN guard
                raise HTTPException(status_code=400, detail="gains must be finite")
            clamped.append(max(_EQ_GAIN_MIN, min(_EQ_GAIN_MAX, numeric)))
        gains_param = clamped

    node_id = get_genre_taxonomy_node_id(canonical_slug)
    if not node_id:
        raise HTTPException(status_code=404, detail="Canonical genre not found")
    set_genre_eq_gains(canonical_slug, gains_param)

    # Drop the cached graph so the next resolver call picks up the new
    # gains (or NULL → inheritance).
    invalidate_runtime_taxonomy_cache(broadcast=True)
    _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")

    resolved = resolve_genre_eq_preset(canonical_slug)
    return {
        "slug": canonical_slug,
        "eq_gains": gains_param,
        "eq_preset_resolved": resolved,
    }


@router.post(
    "/{slug}/generate-eq",
    responses=_GENRE_RESPONSES,
    summary="Generate an EQ preset for a genre using AI",
)
def generate_genre_eq(
    request: Request,
    slug: str,
    apply: bool = Query(False, description="Auto-apply the generated preset"),
):
    """Use the configured LLM to generate a 10-band EQ preset for a genre."""
    _require_genre_curator(request)

    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        raise HTTPException(status_code=400, detail="Slug is required")

    node_id = get_genre_taxonomy_node_id(canonical_slug)
    if not node_id:
        raise HTTPException(status_code=404, detail="Genre not found in taxonomy")

    # Get genre detail for context
    detail = get_genre_detail(canonical_slug)
    description = detail.get("description") if detail else None
    parent_slugs = detail.get("parent_slugs", []) if detail else []

    try:
        from crate.llm.prompts.eq_preset import generate_eq_preset

        result = generate_eq_preset(
            genre_name=canonical_slug.replace("-", " ").title(),
            description=description,
            parent_genres=[s.replace("-", " ").title() for s in parent_slugs[:3]],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    gains = [max(-12.0, min(12.0, round(g, 1))) for g in result.gains]

    if apply:
        set_genre_eq_gains(canonical_slug, gains, reasoning=result.reasoning)
        invalidate_runtime_taxonomy_cache(broadcast=True)
        _broadcast_genre_taxonomy_changed(f"genre:{canonical_slug}")

    return {
        "slug": canonical_slug,
        "gains": gains,
        "reasoning": result.reasoning,
        "applied": apply,
    }
