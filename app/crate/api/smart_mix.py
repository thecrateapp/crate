from __future__ import annotations

import hashlib
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import COMMON_ERROR_RESPONSES
from crate.api.schemas.smart_mix import (
    CompatibilityScoreResponse,
    CompatibleTrackResponse,
    CompatibleTracksResponse,
    MixProfileResponse,
    TransitionContextRequest,
    TransitionEdgeRequest,
    TransitionPlanBatchRequest,
    TransitionPlanBatchResponse,
    TransitionPlanResponse,
)
from crate.db.cache_store import (
    get_smart_mix_plan_cache,
    set_smart_mix_plan_cache,
)
from crate.db.queries.smart_mix_compatible import get_compatible_track_inputs
from crate.db.repositories.smart_mix import (
    get_track_mix_profile_by_entity_uid,
    get_track_mix_profiles_by_entity_uids,
)
from crate.smart_mix.compatible import rank_compatible_tracks
from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfile,
    TransitionContext,
    TransitionPlan,
)
from crate.smart_mix.planner import plan_transition


router = APIRouter(prefix="/api", tags=["smart-mix"])


@router.get(
    "/tracks/by-entity/{entity_uid}/mix-profile",
    response_model=MixProfileResponse,
    response_model_exclude_none=True,
    responses=COMMON_ERROR_RESPONSES,
    summary="Read a versioned Smart Mix profile by track entity UID",
)
def track_mix_profile(
    request: Request,
    entity_uid: UUID,
    detail: Literal["summary", "full"] = Query(default="summary"),
) -> MixProfileResponse:
    _require_auth(request)
    include_beat_grid = detail == "full"
    profile = get_track_mix_profile_by_entity_uid(
        str(entity_uid),
        include_beat_grid=include_beat_grid,
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Smart Mix profile not found")
    payload = profile.to_full_dict() if include_beat_grid else profile.to_summary_dict()
    return MixProfileResponse.model_validate(payload)


@router.get(
    "/tracks/by-entity/{entity_uid}/compatible",
    response_model=CompatibleTracksResponse,
    response_model_exclude_none=True,
    responses=COMMON_ERROR_RESPONSES,
    summary="Rank locally playable tracks compatible with a Smart Mix profile",
)
def compatible_tracks(
    request: Request,
    entity_uid: UUID,
    scope: Literal["local"] = Query(default="local"),
    limit: int = Query(default=20, ge=1, le=100),
    planner_version: Literal["smart-mix-v1"] = Query(default="smart-mix-v1"),
) -> CompatibleTracksResponse:
    _require_auth(request)
    seed, candidates = get_compatible_track_inputs(
        str(entity_uid),
        max_candidates=500,
    )
    if seed is None or seed.profile.quality is MixProfileQuality.UNAVAILABLE:
        raise HTTPException(
            status_code=404,
            detail="Track or Smart Mix profile not found",
        )
    ranked = rank_compatible_tracks(seed, candidates, limit=limit)
    return CompatibleTracksResponse(
        seed_track_entity_uid=seed.track_entity_uid,
        scope=scope,
        planner_version=planner_version,
        items=[
            CompatibleTrackResponse(
                track_id=item.track_id,
                track_entity_uid=item.track_entity_uid,
                title=item.title,
                artist=item.artist,
                album=item.album,
                score=item.score,
                confidence=item.confidence,
                score_breakdown=CompatibilityScoreResponse(
                    planner_version=item.score_breakdown.planner_version,
                    overall=item.score_breakdown.overall,
                    signal_confidence=item.score_breakdown.signal_confidence,
                    tempo=item.score_breakdown.tempo,
                    harmonic=item.score_breakdown.harmonic,
                    harmonic_relationship=(item.score_breakdown.harmonic_relationship),
                    energy=item.score_breakdown.energy,
                    danceability=item.score_breakdown.danceability,
                    valence=item.score_breakdown.valence,
                    bliss=item.score_breakdown.bliss,
                    genre=item.score_breakdown.genre,
                ),
                fallback_reasons=list(item.fallback_reasons),
            )
            for item in ranked
        ],
    )


@router.post(
    "/playback/transition-plans",
    response_model=TransitionPlanBatchResponse,
    response_model_exclude_none=True,
    responses=COMMON_ERROR_RESPONSES,
    summary="Plan a bounded batch of Smart Mix queue transitions",
)
def transition_plans(
    request: Request,
    payload: TransitionPlanBatchRequest = Body(...),
) -> TransitionPlanBatchResponse:
    _require_auth(request)
    unique_edges = _deduplicate_edges(payload.edges)
    entity_uids = _ordered_entity_uids(unique_edges)
    profiles = get_track_mix_profiles_by_entity_uids(
        entity_uids,
        include_beat_grid=True,
    )
    profiles_by_uid = dict(zip(entity_uids, profiles, strict=True))

    plans = [
        _plan_edge(
            edge,
            outgoing=profiles_by_uid.get(str(edge.outgoing_track_entity_uid)),
            incoming=profiles_by_uid.get(str(edge.incoming_track_entity_uid)),
        )
        for edge in unique_edges
    ]
    return TransitionPlanBatchResponse.model_validate(
        {
            "plannerVersion": payload.planner_version,
            "plans": plans,
        }
    )


def _deduplicate_edges(
    edges: list[TransitionEdgeRequest],
) -> list[TransitionEdgeRequest]:
    unique: list[TransitionEdgeRequest] = []
    seen: set[str] = set()
    for edge in edges:
        key = _edge_identity(edge)
        if key in seen:
            continue
        seen.add(key)
        unique.append(edge)
    return unique


def _edge_identity(edge: TransitionEdgeRequest) -> str:
    return json.dumps(
        edge.model_dump(mode="json", by_alias=True),
        sort_keys=True,
        separators=(",", ":"),
    )


def _ordered_entity_uids(edges: list[TransitionEdgeRequest]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for edge in edges:
        for entity_uid in (
            str(edge.outgoing_track_entity_uid),
            str(edge.incoming_track_entity_uid),
        ):
            if entity_uid in seen:
                continue
            seen.add(entity_uid)
            result.append(entity_uid)
    return result


def _plan_edge(
    edge: TransitionEdgeRequest,
    *,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> TransitionPlanResponse:
    context = _transition_context(edge.context)
    cache_key = _plan_cache_key(edge, outgoing, incoming)
    cached = get_smart_mix_plan_cache(cache_key)
    if cached is not None:
        return TransitionPlanResponse.model_validate(cached)

    plan = plan_transition(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=str(edge.outgoing_track_entity_uid),
        incoming_track_entity_uid=str(edge.incoming_track_entity_uid),
    )
    serialized = plan.to_dict()
    set_smart_mix_plan_cache(cache_key, serialized)
    return _plan_response(plan)


def _transition_context(payload: TransitionContextRequest) -> TransitionContext:
    return TransitionContext(
        source=payload.source,
        automatic=payload.automatic,
        offline=payload.offline,
        preferred_duration_ms=payload.preferred_duration_ms,
        user_cue_profile=payload.user_cue_profile,
        allow_beatmatch=payload.allow_beatmatch,
        allow_tempo_adjustment=payload.allow_tempo_adjustment,
    )


def _plan_cache_key(
    edge: TransitionEdgeRequest,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> str:
    cache_identity = {
        "plannerVersion": "smart-mix-v1",
        "outgoingTrackEntityUid": str(edge.outgoing_track_entity_uid),
        "outgoingProfileRevision": (
            outgoing.profile_revision if outgoing is not None else "missing"
        ),
        "incomingTrackEntityUid": str(edge.incoming_track_entity_uid),
        "incomingProfileRevision": (
            incoming.profile_revision if incoming is not None else "missing"
        ),
        "context": edge.context.model_dump(mode="json", by_alias=True),
    }
    canonical = json.dumps(
        cache_identity,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _plan_response(plan: TransitionPlan) -> TransitionPlanResponse:
    return TransitionPlanResponse.model_validate(plan.to_dict())


__all__ = ["router"]
