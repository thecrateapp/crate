from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import COMMON_ERROR_RESPONSES
from crate.api.schemas.smart_mix import (
    CompatibilityScoreResponse,
    CompatibleTrackResponse,
    CompatibleTracksResponse,
)
from crate.db.queries.smart_mix_compatible import get_compatible_track_inputs
from crate.smart_mix.compatible import rank_compatible_tracks
from crate.smart_mix.models import MixProfileQuality


router = APIRouter(prefix="/api", tags=["smart-mix"])


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


__all__ = ["router"]
