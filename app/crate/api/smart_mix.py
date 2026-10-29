from __future__ import annotations

import hashlib
import json
from urllib.parse import quote
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, Query, Request

from crate.api.auth import (
    _require_auth,
    _require_continuation_token,
    _require_transition_plan_access,
    _require_vdj_scope,
)
from crate.api.radio import continuation_radio_tracks
from crate.config import android_bass_handoff_enabled
from crate.api.openapi_responses import COMMON_ERROR_RESPONSES
from crate.api.schemas.smart_mix import (
    CompatibilityScoreResponse,
    CompatibleTrackResponse,
    CompatibleTracksResponse,
    MixProfileResponse,
    TransitionContextRequest,
    TransitionEdgeRequest,
    ContinuationTrackResponse,
    PlaybackContinuationRequest,
    PlaybackContinuationResponse,
    PlaybackContinuationTokenRequest,
    PlaybackContinuationTokenResponse,
    TransitionPlanBatchRequest,
    TransitionPlanBatchResponse,
    TransitionPlanResponse,
)
from crate.db.cache_store import (
    get_smart_mix_plan_caches,
    set_smart_mix_plan_caches,
)
from crate.db.queries.smart_mix_compatible import get_compatible_track_inputs
from crate.db.repositories.access_tokens import (
    get_continuation_descriptor,
    issue_playback_continuation_token,
)
from crate.db.repositories.smart_mix import (
    get_track_mix_profile_by_entity_uid,
    get_track_mix_profiles_by_entity_uids,
)
from crate.smart_mix.compatible import rank_compatible_tracks
from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfile,
    TransitionContext,
)
from crate.smart_mix.planner import plan_transition
from crate.smart_mix.policy import PLANNER_POLICY
from crate.smart_mix.versions import PLANNER_IDENTIFIER


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
    _require_vdj_scope(request, "vdj.smart_mix.read")
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
    planner_version: Literal["smart-mix-v2"] = Query(default="smart-mix-v2"),
) -> CompatibleTracksResponse:
    _require_vdj_scope(request, "vdj.smart_mix.read")
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
    "/playback/continuation-token",
    response_model=PlaybackContinuationTokenResponse,
    responses=COMMON_ERROR_RESPONSES,
    summary="Issue a session-bound token for native background planning",
)
def playback_continuation_token(
    request: Request,
    payload: PlaybackContinuationTokenRequest | None = Body(None),
) -> PlaybackContinuationTokenResponse:
    user = _require_auth(request)
    session_id = user.get("session_id")
    if user.get("auth_type") == "access_token" or not session_id:
        raise HTTPException(
            status_code=403,
            detail="An interactive session is required",
        )
    descriptor = (
        payload.descriptor.model_dump(by_alias=True, exclude_none=True)
        if payload and payload.descriptor
        else None
    )
    issued = issue_playback_continuation_token(
        user_id=user["id"],
        session_id=str(session_id),
        descriptor=descriptor,
    )
    return PlaybackContinuationTokenResponse(
        token=issued["token"],
        expiresAt=issued["expires_at"],
    )


@router.post(
    "/playback/continuation",
    response_model=PlaybackContinuationResponse,
    response_model_exclude_none=True,
    responses=COMMON_ERROR_RESPONSES,
    summary="Continue a radio or infinite queue for native background playback",
)
def playback_continuation(
    request: Request,
    payload: PlaybackContinuationRequest = Body(...),
) -> PlaybackContinuationResponse:
    user = _require_continuation_token(request)
    descriptor = get_continuation_descriptor(int(user["access_token_id"]))
    if not descriptor:
        return PlaybackContinuationResponse(
            tracks=[], plans=[], exhausted=True, status="exhausted"
        )
    known = {str(uid) for uid in payload.recent_entity_uids}
    if payload.after_track_entity_uid:
        known.add(str(payload.after_track_entity_uid))
    batch = None
    if payload.batch_index is not None and descriptor.get("sessionId"):
        from crate.api.radio import indexed_continuation_batch

        batch = indexed_continuation_batch(
            descriptor,
            user=user,
            limit=payload.limit,
            buffer_refs=[
                *(
                    str(uid)
                    for uid in reversed(payload.recent_entity_uids)
                    if uid != payload.after_track_entity_uid
                ),
                *(
                    [str(payload.after_track_entity_uid)]
                    if payload.after_track_entity_uid
                    else []
                ),
            ],
            batch_index=payload.batch_index,
            revision=payload.revision,
        )
        rows, exhausted = batch["tracks"], batch["exhausted"]
    else:
        from crate.radio_continuation import RadioLeaseLost

        try:
            rows, exhausted = continuation_radio_tracks(
                descriptor,
                user=user,
                limit=payload.limit,
                exclude_entity_uids=known,
            )
        except RadioLeaseLost as exc:
            raise HTTPException(
                status_code=409,
                detail="Radio session is busy; retry the request",
                headers={"Retry-After": "1"},
            ) from exc
    tracks = [
        track
        for track in (_continuation_track(row, payload.delivery) for row in rows)
        if track is not None
    ]
    chain = (
        [str(payload.after_track_entity_uid)] if payload.after_track_entity_uid else []
    )
    chain.extend(str(track.entity_uid) for track in tracks)
    edges = [
        TransitionEdgeRequest(
            outgoingTrackEntityUid=UUID(outgoing),
            incomingTrackEntityUid=UUID(incoming),
            context=payload.context,
        )
        for outgoing, incoming in zip(chain, chain[1:])
    ][:32]
    return PlaybackContinuationResponse(
        tracks=tracks,
        plans=_plan_transition_edges(edges) if edges else [],
        exhausted=exhausted,
        status=(
            batch["status"]
            if batch
            else "ok"
            if tracks
            else "exhausted"
            if exhausted
            else "retryable_empty"
        ),
        sessionId=batch["session_id"] if batch else None,
        batchIndex=batch.get("batch_index") if batch else None,
        revision=batch["revision"] if batch else 1,
    )


def _continuation_track(row: dict, delivery: str) -> ContinuationTrackResponse | None:
    entity_uid = row.get("track_entity_uid") or row.get("entity_uid")
    if not entity_uid:
        return None
    path = row.get("track_path") or row.get("path")
    track_id = row.get("track_id")
    playable_id = (
        row.get("global_track_uid")
        or entity_uid
        or path
        or (str(track_id) if track_id is not None else None)
    )
    duration = row.get("duration")
    return ContinuationTrackResponse(
        id=str(playable_id),
        entityUid=entity_uid,
        url=(
            f"/api/tracks/by-entity/{quote(str(entity_uid), safe='')}/stream"
            f"?delivery={quote(delivery, safe='')}"
        ),
        title=row.get("title") or "Unknown",
        artist=row.get("artist") or "",
        album=row.get("album") or None,
        durationMs=round(float(duration) * 1000) if duration else None,
        source=row,
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
    _require_transition_plan_access(request)
    return TransitionPlanBatchResponse.model_validate(
        {
            "plannerVersion": payload.planner_version,
            "plans": _plan_transition_edges(payload.edges),
        }
    )


def _plan_transition_edges(
    edges: list[TransitionEdgeRequest],
) -> list[TransitionPlanResponse]:
    unique_edges = _deduplicate_edges(edges)
    entity_uids = _ordered_entity_uids(unique_edges)
    profiles = get_track_mix_profiles_by_entity_uids(entity_uids)
    profiles_by_uid = dict(zip(entity_uids, profiles, strict=True))
    edge_profiles = [
        (
            edge,
            profiles_by_uid.get(str(edge.outgoing_track_entity_uid)),
            profiles_by_uid.get(str(edge.incoming_track_entity_uid)),
        )
        for edge in unique_edges
    ]
    cache_keys = [
        _plan_cache_key(edge, outgoing, incoming)
        for edge, outgoing, incoming in edge_profiles
    ]
    cached = get_smart_mix_plan_caches(cache_keys)
    computed: dict[str, dict] = {}
    plans = []
    for cache_key, (edge, outgoing, incoming) in zip(
        cache_keys, edge_profiles, strict=True
    ):
        serialized = cached.get(cache_key)
        if serialized is None:
            serialized = _plan_edge(edge, outgoing=outgoing, incoming=incoming)
            computed[cache_key] = serialized
        plans.append(TransitionPlanResponse.model_validate(serialized))
    set_smart_mix_plan_caches(computed)
    return plans


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
) -> dict:
    return plan_transition(
        outgoing,
        incoming,
        _transition_context(edge.context),
        outgoing_track_entity_uid=str(edge.outgoing_track_entity_uid),
        incoming_track_entity_uid=str(edge.incoming_track_entity_uid),
    ).to_dict()


def _transition_context(payload: TransitionContextRequest) -> TransitionContext:
    return TransitionContext(
        source=payload.source,
        automatic=payload.automatic,
        offline=payload.offline,
        preferred_duration_ms=payload.preferred_duration_ms,
        user_cue_profile=payload.user_cue_profile,
        allow_beatmatch=payload.allow_beatmatch,
        allow_tempo_adjustment=payload.allow_tempo_adjustment,
        allow_bass_handoff=_bass_handoff_allowed(payload),
        allow_long_beatmatch=payload.allow_long_beatmatch,
    )


def _bass_handoff_allowed(payload: TransitionContextRequest) -> bool:
    return payload.allow_bass_handoff and android_bass_handoff_enabled()


def _cache_context(payload: TransitionContextRequest) -> dict:
    context = payload.model_dump(mode="json", by_alias=True)
    if _bass_handoff_allowed(payload):
        context["allowBassHandoff"] = True
    else:
        context.pop("allowBassHandoff", None)
    if not payload.allow_long_beatmatch:
        context.pop("allowLongBeatmatch", None)
    return context


def _plan_cache_key(
    edge: TransitionEdgeRequest,
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
) -> str:
    cache_identity = {
        "plannerVersion": PLANNER_IDENTIFIER,
        "plannerRules": PLANNER_POLICY.rules_revision,
        "outgoingTrackEntityUid": str(edge.outgoing_track_entity_uid),
        "outgoingProfileRevision": (
            outgoing.profile_revision if outgoing is not None else "missing"
        ),
        "incomingTrackEntityUid": str(edge.incoming_track_entity_uid),
        "incomingProfileRevision": (
            incoming.profile_revision if incoming is not None else "missing"
        ),
        "context": _cache_context(edge.context),
    }
    canonical = json.dumps(
        cache_identity,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


__all__ = ["router"]
