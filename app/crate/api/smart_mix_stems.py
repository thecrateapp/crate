"""The server's stem work for the admin (Smart Mix Stems, ST2.PR4, design §3 STEM-D2).

- ``GET /api/smart-mix/tracks/{track_id}/stems``: a track's Stems tab in its Audio profile
  dialog. Every user reads the analyses, the phrase grid, the job, the stem file and the
  Smart Mix playlists they own or belong to; ``library.analysis.manage`` also reads every
  Smart Mix playlist and why a separation failed.
- ``GET /api/admin/smart-mix/playlists``: the Analysis page's Smart Mix playlists panel,
  with every user's playlists, the stem files' quota use and the stem settings.

Nothing here plays stem audio: the admin does not (Diego, 2026-11-09).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import has_capability, require_permission
from crate.api.schemas.smart_mix import (
    SmartMixPlaylistStateCounts,
    StemsLayerResponse,
)
from crate.api.schemas.smart_mix_stems import (
    SmartMixAdminPlaylistResponse,
    SmartMixAdminPlaylistsResponse,
    SmartMixStemFailureResponse,
    SmartMixStemOverviewResponse,
    SmartMixStemSettingsResponse,
    SmartMixStemStorageResponse,
    SmartMixTrackPhraseResponse,
    SmartMixTrackPlaylistResponse,
    SmartMixTrackStemAnalysisResponse,
    SmartMixTrackStemFileResponse,
    SmartMixTrackStemJobResponse,
    SmartMixTrackStemsResponse,
    SmartMixUserRef,
)
from crate.db.queries.smart_mix_stems import (
    StemStateCounts,
    TrackStemOverview,
    get_track_stem_overview,
    list_admin_smart_mix_playlists,
)
from crate.smart_mix.models import VOCAL_THRESHOLD, TrackMixProfile
from crate.smart_mix.phrase_grid import phrase_spans_ms
from crate.smart_mix.stems import (
    ESTIMATED_STEM_SECONDS_PER_TRACK,
    choose_analysis,
    stem_phrase_layer,
)

# The separation task's attempts per track (worker_handlers.smart_mix_stems, which the
# API does not import: it pulls in numpy). A test keeps both equal.
STEM_JOB_MAX_ATTEMPTS = 3
ANALYSIS_MANAGE = "library.analysis.manage"

router = APIRouter(prefix="/api/smart-mix/tracks", tags=["smart-mix"])
admin_router = APIRouter(prefix="/api/admin/smart-mix", tags=["admin"])

_TRACK_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES, {404: error_response("No local track with this ID.")}
)
_ADMIN_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {422: error_response("limit is not between 1 and 500.")},
)


@router.get(
    "/{track_id}/stems",
    response_model=SmartMixTrackStemsResponse,
    responses=_TRACK_RESPONSES,
    summary="Read a track's stem analyses, stem file, job and Smart Mix playlists",
)
def track_stems(request: Request, track_id: int) -> SmartMixTrackStemsResponse:
    user = _require_auth(request)
    manager = has_capability(user, ANALYSIS_MANAGE)
    overview = get_track_stem_overview(
        track_id, viewer_id=int(user["id"]), all_playlists=manager
    )
    if overview is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return _track_response(overview, manager=manager)


@admin_router.get(
    "/playlists",
    response_model=SmartMixAdminPlaylistsResponse,
    responses=_ADMIN_RESPONSES,
    summary="List every user's Smart Mix playlists, their stem work and the quota",
)
def admin_smart_mix_playlists(
    request: Request,
    limit: int = Query(100, ge=1, le=500, description="Playlists to list."),
) -> SmartMixAdminPlaylistsResponse:
    require_permission(request, ANALYSIS_MANAGE)
    listing = list_admin_smart_mix_playlists(limit=limit)
    per_track = _per_track(listing.seconds_per_track)
    overview = listing.overview
    return SmartMixAdminPlaylistsResponse(
        playlists=[
            SmartMixAdminPlaylistResponse(
                playlist_id=playlist.playlist_id,
                name=playlist.name,
                owner=_user_ref(playlist.owner_id, playlist.owner_username),
                enabled=playlist.enabled,
                enabled_at=playlist.enabled_at,
                disabled_at=playlist.disabled_at,
                last_used_at=playlist.last_used_at,
                total=playlist.total,
                counts=_counts(playlist.counts),
                estimated_seconds_left=_left(playlist.counts, per_track),
                failures=[
                    SmartMixStemFailureResponse(
                        track_id=failure.track_id,
                        title=failure.title,
                        artist=failure.artist,
                        attempts=failure.attempts,
                        last_error=failure.last_error,
                        finished_at=failure.finished_at,
                    )
                    for failure in playlist.failures
                ],
                file_bytes=playlist.file_bytes,
                files=playlist.files,
            )
            for playlist in listing.playlists
        ],
        overview=SmartMixStemOverviewResponse(
            playlists_on=overview.playlists_on,
            playlists_off=overview.playlists_off,
            tracks=overview.tracks,
            counts=_counts(overview.counts),
            estimated_seconds_left=_left(overview.counts, per_track),
            seconds_per_track=round(per_track),
            server_separator=overview.server_separator,
            storage=SmartMixStemStorageResponse(
                used_bytes=overview.used_bytes,
                files=overview.files,
                evictable_bytes=overview.evictable_bytes,
            ),
            settings=SmartMixStemSettingsResponse(
                max_tracks_per_playlist=overview.settings.max_tracks_per_playlist,
                max_tracks_per_user=overview.settings.max_tracks_per_user,
                quota_gib=overview.settings.quota_gib,
                uploads_enabled=overview.settings.uploads_enabled,
            ),
        ),
    )


def _track_response(
    overview: TrackStemOverview, *, manager: bool
) -> SmartMixTrackStemsResponse:
    profile = overview.profile
    revision = overview.source_revision
    analyses = [stored.analysis for stored in overview.analyses]
    chosen = (
        None
        if revision is None
        else choose_analysis(analyses, source_revision=revision)
    )
    layer = (
        None
        if chosen is None or profile is None
        else stem_phrase_layer(profile, chosen)
    )
    job = overview.job
    file = overview.file
    return SmartMixTrackStemsResponse(
        track_id=overview.track_id,
        track_entity_uid=overview.entity_uid,
        duration_ms=(
            profile.duration_ms if profile is not None else overview.library_duration_ms
        ),
        source_revision=revision,
        profile_analyzed_at=overview.profile_analyzed_at,
        source_stale_at=overview.source_stale_at,
        vocal_detector=None if profile is None else profile.vocal_detector,
        phrases=_phrases(profile),
        analyses=[
            SmartMixTrackStemAnalysisResponse(
                producer_kind=stored.producer_kind,
                producer=stored.analysis.producer,
                separator_model=stored.analysis.separator.model,
                separator_version=stored.analysis.separator.version,
                source_revision=stored.analysis.source_revision,
                hop_ms=stored.analysis.hop_ms,
                duration_ms=stored.analysis.duration_ms,
                levels=stored.analysis.levels,
                drum_beats_ms=(
                    None
                    if stored.analysis.drum_beats_ms is None
                    else list(stored.analysis.drum_beats_ms)
                ),
                current=stored.analysis.source_revision == revision,
                chosen=stored.analysis is chosen,
                created_at=stored.created_at,
                updated_at=stored.updated_at,
                contributed_by=_user_ref(
                    stored.contributed_by, stored.contributor_username
                ),
            )
            for stored in overview.analyses
        ],
        stems=None
        if layer is None
        else StemsLayerResponse.model_validate(layer.to_dict()),
        job=None
        if job is None
        else SmartMixTrackStemJobResponse(
            state=job.state,
            attempts=job.attempts,
            max_attempts=STEM_JOB_MAX_ATTEMPTS,
            requested_at=job.requested_at,
            started_at=job.started_at,
            finished_at=job.finished_at,
            last_error=job.last_error if manager else None,
            seconds_per_track=round(_per_track(overview.seconds_per_track)),
        ),
        file=None
        if file is None
        else SmartMixTrackStemFileResponse(
            size_bytes=file.bytes,
            separator_model=file.separator_model,
            separator_version=file.separator_version,
            source_revision=file.source_revision,
            current=file.source_revision == revision,
            created_at=file.created_at,
            last_used_at=file.last_used_at,
        ),
        playlists=[
            SmartMixTrackPlaylistResponse(
                playlist_id=playlist.playlist_id,
                name=playlist.name,
                owner=_user_ref(playlist.owner_id, playlist.owner_username),
                enabled=playlist.enabled,
                ready=playlist.ready,
                total=playlist.total,
            )
            for playlist in overview.playlists
        ],
    )


def _phrases(profile: TrackMixProfile | None) -> list[SmartMixTrackPhraseResponse]:
    """The profile's phrase spans, capped at its duration as the stems layer is."""
    if profile is None or not profile.phrases:
        return []
    vocals = profile.vocal_presence
    spans = phrase_spans_ms(profile.phrases, profile.beat_grid_ms)
    return [
        SmartMixTrackPhraseResponse(
            start_ms=phrase.start_ms,
            end_ms=_capped(phrase.start_ms, end_ms, profile.duration_ms),
            kind=phrase.kind,
            bars=phrase.bars,
            voiced=None if vocals is None else vocals[index] >= VOCAL_THRESHOLD,
        )
        for index, (phrase, (_start_ms, end_ms)) in enumerate(
            zip(profile.phrases, spans, strict=True)
        )
    ]


def _capped(start_ms: int, end_ms: int, duration_ms: int) -> int:
    # As stem_phrase_layer: the grid may run past the audio's end.
    end_ms = min(end_ms, duration_ms)
    return duration_ms if end_ms <= start_ms else end_ms


def _per_track(seconds: float | None) -> float:
    return float(ESTIMATED_STEM_SECONDS_PER_TRACK) if seconds is None else seconds


def _left(counts: StemStateCounts, per_track: float) -> int | None:
    waiting = counts.pending + counts.analyzing
    return round(waiting * per_track) if waiting else None


def _counts(counts: StemStateCounts) -> SmartMixPlaylistStateCounts:
    return SmartMixPlaylistStateCounts(
        pending=counts.pending,
        analyzing=counts.analyzing,
        ready=counts.ready,
        failed=counts.failed,
    )


def _user_ref(user_id: int | None, username: str | None) -> SmartMixUserRef | None:
    return None if user_id is None else SmartMixUserRef(id=user_id, username=username)


__all__ = ["STEM_JOB_MAX_ATTEMPTS", "admin_router", "router"]
