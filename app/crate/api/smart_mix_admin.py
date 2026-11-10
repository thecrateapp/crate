from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.permissions import require_permission
from crate.api.schemas.smart_mix_admin import (
    SmartMixActivityResponse,
    SmartMixAdminStatusResponse,
    SmartMixBackfillRequest,
    SmartMixBackfillResponse,
    SmartMixReanalyzeResponse,
    SmartMixTrackListResponse,
    SmartMixTrackStructureResponse,
)
from crate.db.jobs.analysis_storage import resolve_smart_mix_track
from crate.db.jobs.smart_mix_backfill import (
    campaign_targets_current,
    queue_next_smart_mix_batch,
    set_smart_mix_campaign_status,
    smart_mix_awaits_model_beats,
    smart_mix_profile_dedup_key,
    start_smart_mix_campaign,
)
from crate.db.queries.smart_mix_admin import (
    get_smart_mix_admin_status,
    get_smart_mix_campaign_status,
)
from crate.db.queries.smart_mix_admin_activity import get_smart_mix_activity
from crate.db.queries.smart_mix_admin_tracks import list_smart_mix_tracks
from crate.db.queries.tasks import list_tasks
from crate.db.repositories.smart_mix import get_track_mix_profile
from crate.db.repositories.tasks import create_task_dedup
from crate.smart_mix.models import VOCAL_THRESHOLD, TrackMixProfile
from crate.smart_mix.phrase_grid import downbeats_from_anchor, phrase_spans_ms
from crate.smart_mix.backfill_window import (
    backfill_window_limit,
    backfill_window_settings,
)


router = APIRouter(prefix="/api/admin/smart-mix", tags=["admin"])
BACKFILL_TASK_TYPE = "backfill_smart_mix_profiles"
COVERAGE_TASK_TYPE = "refresh_smart_mix_coverage"
COVERAGE_DEDUP_KEY = "smart-mix:coverage"
COVERAGE_MAX_AGE_SECONDS = 600
PROFILE_TASK_TYPE = "compute_smart_mix_profile"
TRACK_PAGE_SIZE = 50
DEFAULT_BATCH_SIZE = 25
DEFAULT_MAX_ATTEMPTS = 3
TrackStatusFilter = Literal[
    "all", "current", "outdated", "source_changed", "unavailable", "missing", "failed"
]
_ACTIVE_TASK_STATUSES = {"pending", "running", "delegated", "completing"}


def _require_manage(request: Request) -> dict:
    return require_permission(request, "library.analysis.manage")


def _backfill_tasks() -> list[dict]:
    return list_tasks(task_type=BACKFILL_TASK_TYPE, limit=10)


def _active_backfill_task(tasks: list[dict] | None = None) -> dict | None:
    return next(
        (
            task
            for task in (tasks if tasks is not None else _backfill_tasks())
            if str(task.get("status") or "") in _ACTIVE_TASK_STATUSES
        ),
        None,
    )


def _control_state(campaign: dict | None) -> Literal["idle", "running", "paused"]:
    # A campaign of another analyzer or schema claims nothing: offer a new start.
    if not campaign_targets_current(campaign):
        return "idle"
    status = (campaign or {}).get("status")
    if status == "running":
        return "running"
    if status == "paused":
        return "paused"
    return "idle"


def _now() -> datetime:
    return datetime.now(UTC)


def _backfill_settings(campaign: dict | None) -> dict:
    """Settings of the stored campaign, or the ones a new campaign would use."""
    stored = campaign or {}
    return {
        "batch_size": stored.get("batch_size") or DEFAULT_BATCH_SIZE,
        "max_attempts": stored.get("max_attempts") or DEFAULT_MAX_ATTEMPTS,
        **backfill_window_settings(campaign),
    }


def _coverage_is_stale(refreshed_at: datetime | str | None) -> bool:
    if refreshed_at is None:
        return True
    if isinstance(refreshed_at, str):
        refreshed_at = datetime.fromisoformat(refreshed_at)
    if refreshed_at.tzinfo is None:
        refreshed_at = refreshed_at.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - refreshed_at).total_seconds()
    return age > COVERAGE_MAX_AGE_SECONDS


@router.get("/status", response_model=SmartMixAdminStatusResponse)
def smart_mix_status(request: Request) -> SmartMixAdminStatusResponse:
    _require_manage(request)
    campaign = get_smart_mix_campaign_status()
    coverage = get_smart_mix_admin_status()
    if _coverage_is_stale(coverage.get("refreshed_at")):
        create_task_dedup(COVERAGE_TASK_TYPE, {}, dedup_key=COVERAGE_DEDUP_KEY)
    settings = _backfill_settings(campaign)
    limit = backfill_window_limit(campaign, now=_now())
    return SmartMixAdminStatusResponse.model_validate(
        {
            **coverage,
            "controlState": _control_state(campaign),
            "campaign": {**campaign, **settings} if campaign else None,
            "activeTask": _active_backfill_task(),
            "backfillSettings": settings,
            "backfillLimit": {"window": limit.window, "limit": limit.limit},
        }
    )


@router.get("/activity", response_model=SmartMixActivityResponse)
def smart_mix_activity(request: Request) -> SmartMixActivityResponse:
    _require_manage(request)
    return SmartMixActivityResponse.model_validate(get_smart_mix_activity())


@router.get("/tracks", response_model=SmartMixTrackListResponse)
def smart_mix_tracks(
    request: Request,
    status: TrackStatusFilter = "all",
    version: str | None = Query(default=None, max_length=64),
    q: str | None = Query(default=None, min_length=3, max_length=100),
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=TRACK_PAGE_SIZE, ge=1, le=100),
) -> SmartMixTrackListResponse:
    _require_manage(request)
    rows = list_smart_mix_tracks(
        status=status,
        analyzer_version=version,
        search=q.strip() if q else None,
        before_track_id=before,
        limit=limit + 1,
        awaits_model_beats=smart_mix_awaits_model_beats(),
    )
    page = rows[:limit]
    return SmartMixTrackListResponse.model_validate(
        {
            "tracks": page,
            "nextBefore": page[-1]["track_id"] if len(rows) > limit else None,
        }
    )


@router.get(
    "/tracks/{track_id}/structure",
    response_model=SmartMixTrackStructureResponse,
)
def smart_mix_track_structure(
    track_id: int, request: Request
) -> SmartMixTrackStructureResponse:
    _require_manage(request)
    profile = get_track_mix_profile(
        track_id, include_beat_grid=True, include_structure=True
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Smart Mix profile not found")
    return SmartMixTrackStructureResponse.model_validate(
        _structure_payload(track_id, profile)
    )


def _structure_payload(track_id: int, profile: TrackMixProfile) -> dict:
    phrases = profile.phrases
    curve = profile.energy_curve
    vocals = profile.vocal_presence
    spans = phrase_spans_ms(phrases or (), profile.beat_grid_ms)
    return {
        "trackId": track_id,
        "trackEntityUid": profile.track_entity_uid,
        "analyzerVersion": profile.analyzer_version,
        "profileVersion": profile.profile_version,
        "durationMs": profile.duration_ms,
        "structureConfidence": profile.structure_confidence,
        "vocalDetector": profile.vocal_detector,
        "phrases": None
        if phrases is None
        else [
            {
                "startBeat": phrase.start_beat,
                "startMs": phrase.start_ms,
                "endMs": end_ms,
                "bars": phrase.bars,
                "energy": phrase.energy,
                "deltaEnergy": phrase.delta_energy,
                "kind": phrase.kind,
                "vocalPresence": None if vocals is None else vocals[index],
                "voiced": None if vocals is None else vocals[index] >= VOCAL_THRESHOLD,
            }
            for index, (phrase, (_start_ms, end_ms)) in enumerate(
                zip(phrases, spans, strict=True)
            )
        ],
        "energyCurve": None if curve is None else list(curve),
        # The curve holds one byte per bar from the first downbeat of the grid.
        "barStartsMs": None
        if curve is None
        else list(
            downbeats_from_anchor(profile.beat_grid_ms, profile.downbeat_anchor_ms)[
                : len(curve)
            ]
        ),
    }


@router.post(
    "/tracks/{track_id}/reanalyze",
    response_model=SmartMixReanalyzeResponse,
    status_code=202,
)
def reanalyze_smart_mix_track(
    track_id: int, request: Request
) -> SmartMixReanalyzeResponse:
    _require_manage(request)
    track = resolve_smart_mix_track(track_id=track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    task_id = create_task_dedup(
        PROFILE_TASK_TYPE,
        {"track_id": int(track["id"]), "track_entity_uid": track["entity_uid"]},
        dedup_key=smart_mix_profile_dedup_key(int(track["id"])),
    )
    return SmartMixReanalyzeResponse(
        taskId=task_id, status="queued" if task_id else "already_queued"
    )


@router.post("/backfill", response_model=SmartMixBackfillResponse)
def start_smart_mix_backfill(
    body: SmartMixBackfillRequest,
    request: Request,
) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _queue_backfill(body, response_status="queued")


@router.post("/backfill/resume", response_model=SmartMixBackfillResponse)
def resume_smart_mix_backfill(
    body: SmartMixBackfillRequest,
    request: Request,
) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _queue_backfill(body, response_status="resumed")


@router.post("/backfill/pause", response_model=SmartMixBackfillResponse)
def pause_smart_mix_backfill(request: Request) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _stop_backfill("paused", allowed_from={"running"})


@router.post("/backfill/cancel", response_model=SmartMixBackfillResponse)
def cancel_smart_mix_backfill(request: Request) -> SmartMixBackfillResponse:
    _require_manage(request)
    return _stop_backfill("cancelled", allowed_from={"running", "paused"})


def _queue_backfill(
    body: SmartMixBackfillRequest,
    *,
    response_status: Literal["queued", "resumed"],
) -> SmartMixBackfillResponse:
    active = _active_backfill_task()
    start_smart_mix_campaign(
        batch_size=body.batch_size,
        max_attempts=body.max_attempts,
        night_window=body.night_window.model_dump() if body.night_window else None,
        night_concurrency=body.night_concurrency,
        day_concurrency=body.day_concurrency,
    )
    if active is not None:
        return SmartMixBackfillResponse.model_validate(
            {
                "taskId": str(active["id"]) if active.get("id") else None,
                "status": "already_running",
                "deduplicated": True,
            }
        )
    task_id = queue_next_smart_mix_batch()
    return SmartMixBackfillResponse.model_validate(
        {
            "taskId": task_id,
            "status": response_status,
            "deduplicated": task_id is None,
        }
    )


def _stop_backfill(
    control: Literal["paused", "cancelled"],
    *,
    allowed_from: set[str],
) -> SmartMixBackfillResponse:
    if set_smart_mix_campaign_status(control, allowed_from=allowed_from) is None:
        raise HTTPException(status_code=409, detail="No active Smart Mix backfill")
    active = _active_backfill_task()
    return SmartMixBackfillResponse.model_validate(
        {
            "taskId": str(active["id"]) if active and active.get("id") else None,
            "status": control,
        }
    )


__all__ = ["router"]
