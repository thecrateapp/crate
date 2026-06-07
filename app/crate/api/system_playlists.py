import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.playlist_utils import apply_playlist_cover_payload
from crate.api.schemas.common import OkResponse
from crate.api.schemas.curation import (
    AddSystemPlaylistTracksRequest,
    ApplyPlaylistRefinementRequest,
    ApplyPlaylistRefinementResponse,
    CreateSystemPlaylistFromBlueprintRequest,
    CreateSystemPlaylistRequest,
    GeneratePlaylistDescriptionRequest,
    GeneratePlaylistDescriptionResponse,
    PreviewSystemPlaylistRequest,
    RefineSystemPlaylistResponse,
    ReorderSystemPlaylistTracksRequest,
    SystemPlaylistBlueprintResponse,
    SystemPlaylistDetailResponse,
    SystemPlaylistEditorSnapshotResponse,
    SystemPlaylistGenerateResponse,
    SystemPlaylistSummaryResponse,
    SystemPlaylistTrackSearchResponse,
    UpdateSystemPlaylistRequest,
)
from crate.playlist_covers import delete_playlist_cover
from crate.db.cache_runtime import get_redis
from crate.db.repositories.playlists import (
    add_playlist_tracks,
    create_playlist,
    delete_playlist,
    duplicate_playlist,
    execute_smart_rules,
    get_generation_history,
    get_playlist,
    get_playlist_followers_count,
    get_playlist_tracks,
    get_system_playlist_by_curation_key,
    list_system_playlists,
    remove_playlist_track,
    reorder_playlist,
    set_generation_status,
    update_playlist,
)
from crate.db.queries.browse_media_search import search_tracks
from crate.playlist_refinement import (
    apply_playlist_refinement_actions,
    build_playlist_refinement_proposal,
)
from crate.playlist_blueprints import blueprint_curation_key, find_playlist_blueprint
from crate.db.repositories.tasks import create_task

router = APIRouter(prefix="/api/admin/system-playlists", tags=["admin"])

EDITOR_STREAM_POLL_SECONDS = 10

_SYSTEM_PLAYLIST_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested system playlist could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _require_playlist_curator(request: Request) -> dict:
    return require_permission(request, "curation.playlists.write")


def _serialize_admin_playlist(playlist: dict, *, include_tracks: bool = False) -> dict:
    item = dict(playlist)
    follower_count = item.get("follower_count")
    if follower_count is None:
        follower_count = get_playlist_followers_count(item["id"])
    item["follower_count"] = int(follower_count or 0)
    if include_tracks:
        item["tracks"] = get_playlist_tracks(item["id"])
    return item


def _build_system_playlist_editor_surface(playlist_id: int) -> dict:
    playlist = _require_system_playlist(playlist_id)
    return {
        "playlist": _serialize_admin_playlist(playlist, include_tracks=True),
        "history": get_generation_history(playlist_id, limit=10),
    }


def _system_playlist_editor_signature(surface: dict) -> str:
    playlist = surface.get("playlist") or {}
    history = surface.get("history") or []
    signature = {
        "playlist": {
            "id": playlist.get("id"),
            "generation_status": playlist.get("generation_status"),
            "generation_error": playlist.get("generation_error"),
            "last_generated_at": playlist.get("last_generated_at"),
            "track_count": playlist.get("track_count"),
            "total_duration": playlist.get("total_duration"),
            "updated_at": playlist.get("updated_at"),
            "cover_data_url": playlist.get("cover_data_url"),
            "tracks": [
                {
                    "id": track.get("id"),
                    "position": track.get("position"),
                    "source": track.get("source"),
                    "locked": track.get("locked"),
                }
                for track in playlist.get("tracks", [])
            ],
        },
        "history": [
            {
                "id": entry.get("id"),
                "status": entry.get("status"),
                "completed_at": entry.get("completed_at"),
                "track_count": entry.get("track_count"),
                "error": entry.get("error"),
            }
            for entry in history
        ],
    }
    return json_dumps(signature, sort_keys=True)


async def _stream_system_playlist_editor(playlist_id: int) -> AsyncIterator[str]:
    last_signature: str | None = None
    heartbeat_counter = 0
    while True:
        surface = _build_system_playlist_editor_surface(playlist_id)
        signature = _system_playlist_editor_signature(surface)
        if signature != last_signature:
            last_signature = signature
            yield f"data: {json_dumps(surface)}\n\n"
        await asyncio.sleep(EDITOR_STREAM_POLL_SECONDS)
        heartbeat_counter += EDITOR_STREAM_POLL_SECONDS
        if heartbeat_counter >= 30:
            heartbeat_counter = 0
            yield ": heartbeat\n\n"


def _require_system_playlist(playlist_id: int) -> dict:
    playlist = get_playlist(playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if playlist.get("scope") != "system":
        raise HTTPException(status_code=404, detail="System playlist not found")
    return playlist


def _validate_generation_mode(
    generation_mode: str, smart_rules: dict | None = None
) -> str:
    mode = (generation_mode or "static").strip().lower()
    if mode not in {"static", "smart"}:
        raise HTTPException(
            status_code=422, detail="generation_mode must be 'static' or 'smart'"
        )
    if mode == "smart" and not smart_rules:
        raise HTTPException(
            status_code=422,
            detail="smart_rules are required for smart system playlists",
        )
    return mode


def _positive_limit(value: int, *, default: int = 20, maximum: int = 50) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, maximum))


def _track_search_payload(track: dict) -> dict:
    return {
        "id": track.get("id") or track.get("track_id"),
        "track_id": track.get("id") or track.get("track_id"),
        "track_entity_uid": track.get("track_entity_uid") or track.get("entity_uid"),
        "track_storage_id": track.get("track_storage_id") or track.get("storage_id"),
        "track_path": track.get("track_path") or track.get("path"),
        "path": track.get("track_path") or track.get("path"),
        "title": track.get("title") or "",
        "artist": track.get("artist") or "",
        "album": track.get("album") or "",
        "duration": track.get("duration"),
        "genre": track.get("genre"),
        "format": track.get("format"),
        "year": track.get("year"),
        "artist_id": track.get("artist_id"),
        "artist_slug": track.get("artist_slug"),
        "album_id": track.get("album_id"),
        "album_slug": track.get("album_slug"),
        "source": "candidate",
        "locked": False,
    }


def _track_matches_query(track: dict, query: str) -> bool:
    needle = query.casefold()
    return any(
        needle in str(track.get(key) or "").casefold()
        for key in ("title", "artist", "album")
    )


def _search_rule_candidate_tracks(*, rules: dict, query: str, limit: int) -> list[dict]:
    rule_limit = max(limit * 10, 150)
    scoped_rules = {**rules, "limit": rule_limit}
    tracks = execute_smart_rules(scoped_rules)
    if isinstance(tracks, int):
        return []
    matches = [
        _track_search_payload(track)
        for track in tracks
        if _track_matches_query(track, query)
    ]
    return matches[:limit]


@router.get(
    "",
    response_model=list[SystemPlaylistSummaryResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="List admin system playlists",
)
def admin_list_system_playlists(
    request: Request, curated_only: bool = False, include_inactive: bool = True
):
    _require_playlist_curator(request)
    playlists = list_system_playlists(
        only_curated=curated_only,
        only_active=not include_inactive,
    )
    return [_serialize_admin_playlist(playlist) for playlist in playlists]


@router.post(
    "",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Create a system playlist",
)
def admin_create_system_playlist(request: Request, body: CreateSystemPlaylistRequest):
    admin = _require_playlist_curator(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name is required")
    mode = _validate_generation_mode(body.generation_mode, body.smart_rules)
    playlist_id = create_playlist(
        name=body.name.strip(),
        description=body.description or "",
        user_id=None,
        is_smart=mode == "smart",
        smart_rules=body.smart_rules if mode == "smart" else None,
        scope="system",
        generation_mode=mode,
        is_curated=body.is_curated,
        is_active=body.is_active,
        managed_by_user_id=admin.get("id"),
        curation_key=body.curation_key,
        featured_rank=body.featured_rank,
        category=body.category,
    )
    # Cover via Redis staging → worker task
    if body.cover_data_url:
        try:
            r = get_redis()
            if r:
                r.set(f"cover:staging:{playlist_id}", body.cover_data_url, ex=600)
                create_task("persist_playlist_cover", {"playlist_id": playlist_id})
        except Exception:
            pass
    else:
        cover_update = apply_playlist_cover_payload(playlist_id, body.cover_data_url)
        if cover_update:
            update_playlist(playlist_id, **cover_update)

    # For smart playlists, enqueue initial generation
    if mode == "smart":
        set_generation_status(playlist_id, "queued")
        create_task(
            "generate_system_playlist",
            {"playlist_id": playlist_id, "triggered_by": "creation"},
        )

    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.post(
    "/from-blueprint",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Create or reuse a system playlist from an editorial blueprint",
)
def admin_create_system_playlist_from_blueprint(
    request: Request, body: CreateSystemPlaylistFromBlueprintRequest
):
    admin = _require_playlist_curator(request)
    target_type = body.target_type
    target_name = body.target_name.strip()
    blueprint_key = body.blueprint_key.strip()
    if not target_name:
        raise HTTPException(status_code=422, detail="target_name is required")
    if not blueprint_key:
        raise HTTPException(status_code=422, detail="blueprint_key is required")

    blueprint = find_playlist_blueprint(
        target_type=target_type,
        target_name=target_name,
        blueprint_key=blueprint_key,
    )
    if not blueprint:
        raise HTTPException(status_code=404, detail="Playlist blueprint not found")

    curation_key = blueprint_curation_key(blueprint, target_name)
    existing = get_system_playlist_by_curation_key(curation_key)
    if existing:
        return _serialize_admin_playlist(existing)

    playlist_id = create_playlist(
        name=blueprint["name"],
        description=blueprint["description"],
        user_id=None,
        is_smart=True,
        smart_rules=blueprint["smart_rules"],
        scope="system",
        generation_mode="smart",
        is_curated=body.is_curated,
        is_active=body.is_active,
        managed_by_user_id=admin.get("id"),
        curation_key=curation_key,
        featured_rank=body.featured_rank,
        category=blueprint["category"],
    )
    set_generation_status(playlist_id, "queued")
    create_task(
        "generate_system_playlist",
        {
            "playlist_id": playlist_id,
            "triggered_by": f"blueprint:{blueprint['key']}",
        },
    )
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.get(
    "/blueprints",
    response_model=list[SystemPlaylistBlueprintResponse],
    responses=AUTH_ERROR_RESPONSES,
    summary="Preview virtual editorial playlist blueprints",
)
def admin_system_playlist_blueprints(
    request: Request,
    artist_name: str | None = Query(None),
    genre_name: str | None = Query(None),
):
    _require_playlist_curator(request)
    from crate.playlist_blueprints import build_playlist_blueprints

    return build_playlist_blueprints(artist_name=artist_name, genre_name=genre_name)


@router.get(
    "/{playlist_id}",
    response_model=SystemPlaylistDetailResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Get a system playlist with tracks",
)
def admin_get_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist, include_tracks=True)


@router.get(
    "/{playlist_id}/editor-snapshot",
    response_model=SystemPlaylistEditorSnapshotResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Get the canonical editor snapshot for a system playlist",
)
def admin_get_system_playlist_editor_snapshot(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    return _build_system_playlist_editor_surface(playlist_id)


@router.get(
    "/{playlist_id}/stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream system playlist editor updates",
)
async def admin_stream_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    return StreamingResponse(
        _stream_system_playlist_editor(playlist_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/{playlist_id}/track-search",
    response_model=SystemPlaylistTrackSearchResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Search candidate tracks for a system playlist",
)
def admin_search_system_playlist_tracks(
    request: Request,
    playlist_id: int,
    q: str = "",
    scope: str = Query("rules", pattern="^(rules|library)$"),
    limit: int = Query(20, ge=1, le=50),
):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    query = q.strip()
    capped_limit = _positive_limit(limit)
    if len(query) < 2:
        return {"tracks": [], "scope": scope}

    if scope == "rules" and playlist.get("smart_rules"):
        tracks = _search_rule_candidate_tracks(
            rules=playlist["smart_rules"],
            query=query,
            limit=capped_limit,
        )
    else:
        tracks = [
            _track_search_payload(track) for track in search_tracks(query, capped_limit)
        ]
        scope = "library"
    return {"tracks": tracks, "scope": scope}


@router.post(
    "/{playlist_id}/tracks",
    response_model=SystemPlaylistDetailResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Add manual curator tracks to a system playlist",
)
def admin_add_system_playlist_tracks(
    request: Request, playlist_id: int, body: AddSystemPlaylistTracksRequest
):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    tracks = [track.model_dump(exclude_none=True) for track in body.tracks]
    if not tracks:
        raise HTTPException(status_code=422, detail="No tracks provided")
    add_playlist_tracks(
        playlist_id,
        [{**track, "source": "manual", "locked": True} for track in tracks],
    )
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist, include_tracks=True)


@router.delete(
    "/{playlist_id}/tracks/{position}",
    response_model=SystemPlaylistDetailResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Remove a system playlist track by position",
)
def admin_remove_system_playlist_track(
    request: Request, playlist_id: int, position: int
):
    admin = _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    remove_playlist_track(
        playlist_id,
        position,
        record_exclusion=True,
        excluded_by_user_id=admin.get("id"),
    )
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist, include_tracks=True)


@router.post(
    "/{playlist_id}/tracks/reorder",
    response_model=SystemPlaylistDetailResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Reorder system playlist tracks",
)
def admin_reorder_system_playlist_tracks(
    request: Request, playlist_id: int, body: ReorderSystemPlaylistTracksRequest
):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    if not body.track_ids:
        raise HTTPException(status_code=422, detail="No track ids provided")
    reorder_playlist(playlist_id, body.track_ids, lock_tracks=True)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist, include_tracks=True)


@router.post(
    "/{playlist_id}/refine",
    response_model=RefineSystemPlaylistResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Build a reviewable AI-assisted refinement proposal",
)
def admin_refine_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    return build_playlist_refinement_proposal(
        playlist=playlist,
        tracks=get_playlist_tracks(playlist_id),
        smart_rules=playlist.get("smart_rules"),
    )


@router.post(
    "/{playlist_id}/refine/apply",
    response_model=ApplyPlaylistRefinementResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Apply selected system playlist refinement actions",
)
def admin_apply_system_playlist_refinement(
    request: Request, playlist_id: int, body: ApplyPlaylistRefinementRequest
):
    admin = _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    selected = set(body.action_ids) if body.action_ids else None
    applied_count = apply_playlist_refinement_actions(
        playlist_id=playlist_id,
        actions=[action.model_dump() for action in body.actions],
        selected_action_ids=selected,
        user_id=admin.get("id"),
    )
    return {"ok": True, "applied_count": applied_count}


@router.put(
    "/{playlist_id}",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Update a system playlist",
)
def admin_update_system_playlist(
    request: Request, playlist_id: int, body: UpdateSystemPlaylistRequest
):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)

    next_mode = body.generation_mode or playlist.get("generation_mode") or "static"
    next_rules = (
        body.smart_rules
        if body.smart_rules is not None
        else playlist.get("smart_rules")
    )
    mode = _validate_generation_mode(
        next_mode, next_rules if next_mode == "smart" else None
    )

    kwargs: dict = {
        "generation_mode": mode,
        "is_smart": mode == "smart",
    }
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=422, detail="Name is required")
        kwargs["name"] = body.name.strip()
    if body.description is not None:
        kwargs["description"] = body.description
    if body.cover_data_url is not None:
        if body.cover_data_url:
            try:
                r = get_redis()
                if r:
                    r.set(f"cover:staging:{playlist_id}", body.cover_data_url, ex=600)
                    create_task("persist_playlist_cover", {"playlist_id": playlist_id})
            except Exception:
                kwargs.update(
                    apply_playlist_cover_payload(
                        playlist_id, body.cover_data_url, playlist.get("cover_path")
                    )
                    or {}
                )
        else:
            # Removing cover
            kwargs.update(
                apply_playlist_cover_payload(
                    playlist_id, None, playlist.get("cover_path")
                )
                or {}
            )
    if body.smart_rules is not None or mode == "static":
        kwargs["smart_rules"] = next_rules if mode == "smart" else None
    if body.auto_refresh_enabled is not None:
        kwargs["auto_refresh_enabled"] = body.auto_refresh_enabled
    if body.is_curated is not None:
        kwargs["is_curated"] = body.is_curated
    if body.is_active is not None:
        kwargs["is_active"] = body.is_active
    if body.curation_key is not None:
        kwargs["curation_key"] = body.curation_key
    if body.featured_rank is not None:
        kwargs["featured_rank"] = body.featured_rank
    if body.category is not None:
        kwargs["category"] = body.category

    update_playlist(playlist_id, **kwargs)

    # Auto-regenerate if smart rules changed
    rules_changed = body.smart_rules is not None and body.smart_rules != playlist.get(
        "smart_rules"
    )
    if rules_changed and mode == "smart":
        set_generation_status(playlist_id, "queued")
        create_task(
            "generate_system_playlist",
            {"playlist_id": playlist_id, "triggered_by": "rule_change"},
        )

    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.delete(
    "/{playlist_id}",
    response_model=OkResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Delete a system playlist",
)
def admin_delete_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    delete_playlist_cover(playlist.get("cover_path"))
    delete_playlist(playlist_id)
    return {"ok": True}


@router.post(
    "/{playlist_id}/activate",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Activate a system playlist",
)
def admin_activate_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    update_playlist(playlist_id, is_active=True)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.post(
    "/{playlist_id}/deactivate",
    response_model=SystemPlaylistSummaryResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Deactivate a system playlist",
)
def admin_deactivate_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    update_playlist(playlist_id, is_active=False)
    playlist = _require_system_playlist(playlist_id)
    return _serialize_admin_playlist(playlist)


@router.post(
    "/{playlist_id}/generate",
    response_model=SystemPlaylistGenerateResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Enqueue regeneration of a smart system playlist",
)
def admin_generate_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    if playlist.get("generation_mode") != "smart" or not playlist.get("smart_rules"):
        raise HTTPException(status_code=400, detail="Not a smart system playlist")

    set_generation_status(playlist_id, "queued")
    task_id = create_task(
        "generate_system_playlist",
        {
            "playlist_id": playlist_id,
            "triggered_by": "manual",
        },
    )
    return {"ok": True, "task_id": task_id, "generation_status": "queued"}


@router.post(
    "/{playlist_id}/preview",
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Preview smart playlist results without persisting",
)
def admin_preview_system_playlist(
    request: Request,
    playlist_id: int,
    body: PreviewSystemPlaylistRequest | None = None,
):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    rules = (
        body.smart_rules
        if body and body.smart_rules is not None
        else playlist.get("smart_rules")
    )
    if not rules:
        raise HTTPException(status_code=400, detail="No smart rules configured")

    total_matching = execute_smart_rules(rules, count_only=True)
    tracks = execute_smart_rules(rules)

    genre_dist: dict[str, int] = {}
    artist_dist: dict[str, int] = {}
    format_dist: dict[str, int] = {}
    years: list[int] = []
    total_duration = 0

    for t in tracks:
        if t.get("genre"):
            for g in str(t["genre"]).split(","):
                g = g.strip()
                if g:
                    genre_dist[g] = genre_dist.get(g, 0) + 1
        if t.get("artist"):
            artist_dist[t["artist"]] = artist_dist.get(t["artist"], 0) + 1
        if t.get("format"):
            format_dist[t["format"]] = format_dist.get(t["format"], 0) + 1
        if t.get("duration"):
            total_duration += int(t["duration"])
        try:
            y = int(t.get("year") or 0)
            if 1900 < y < 2100:
                years.append(y)
        except (ValueError, TypeError):
            pass

    return {
        "total_matching": total_matching,
        "tracks": tracks[:20],
        "genre_distribution": dict(
            sorted(genre_dist.items(), key=lambda x: -x[1])[:15]
        ),
        "artist_distribution": dict(
            sorted(artist_dist.items(), key=lambda x: -x[1])[:15]
        ),
        "format_distribution": format_dist,
        "duration_total_sec": total_duration,
        "avg_year": int(sum(years) / len(years)) if years else None,
        "year_range": [min(years), max(years)] if years else None,
    }


@router.post(
    "/{playlist_id}/ai-description",
    response_model=GeneratePlaylistDescriptionResponse,
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Generate an editorial playlist description with the configured LLM",
)
def admin_generate_playlist_description(
    request: Request,
    playlist_id: int,
    body: GeneratePlaylistDescriptionRequest | None = None,
):
    _require_playlist_curator(request)
    playlist = _require_system_playlist(playlist_id)
    rules = (
        body.smart_rules
        if body and body.smart_rules is not None
        else playlist.get("smart_rules")
    )
    try:
        from crate.llm.prompts.playlist_description import (
            generate_playlist_description,
        )

        response = generate_playlist_description(
            name=playlist.get("name") or "Untitled playlist",
            category=playlist.get("category"),
            smart_rules=rules,
            tracks=get_playlist_tracks(playlist_id)[:60],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"LLM description generation failed: {exc}",
        ) from exc

    applied = bool(body and body.apply)
    if applied:
        update_playlist(playlist_id, description=response.description)
    return {"description": response.description, "applied": applied}


@router.post(
    "/{playlist_id}/duplicate",
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Duplicate a system playlist",
)
def admin_duplicate_system_playlist(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    new_playlist = duplicate_playlist(playlist_id)
    if not new_playlist:
        raise HTTPException(status_code=500, detail="Failed to duplicate playlist")

    # For smart playlists, enqueue initial generation
    if new_playlist.get("generation_mode") == "smart" and new_playlist.get(
        "smart_rules"
    ):
        set_generation_status(new_playlist["id"], "queued")
        create_task(
            "generate_system_playlist",
            {
                "playlist_id": new_playlist["id"],
                "triggered_by": "creation",
            },
        )

    return _serialize_admin_playlist(new_playlist)


@router.get(
    "/{playlist_id}/generation-history",
    responses=_SYSTEM_PLAYLIST_RESPONSES,
    summary="Get generation history for a playlist",
)
def admin_generation_history(request: Request, playlist_id: int):
    _require_playlist_curator(request)
    _require_system_playlist(playlist_id)
    return get_generation_history(playlist_id, limit=10)
