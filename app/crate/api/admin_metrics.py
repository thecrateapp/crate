"""Admin-only endpoints for metrics, worker logs, and health summary."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from starlette.responses import StreamingResponse

from crate.api._deps import json_dumps
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.permissions import require_any_permission, require_permission
from crate.api.redis_sse import close_pubsub, open_pubsub
from crate.api.schemas.metrics import (
    MetricsSummaryResponse,
    MetricsDashboardResponse,
    MetricsRoutesResponse,
    MetricsTimeseriesResponse,
)
from crate.api.schemas.operations import (
    AdminGovernorSnapshotResponse,
    AdminLogsSnapshotResponse,
)
from crate.db.admin_logs_surface import (
    LOGS_SURFACE_STREAM_CHANNEL,
    get_cached_logs_surface,
)

router = APIRouter(prefix="/api/admin", tags=["admin-metrics"])

_DASHBOARD_TIMESERIES = {
    "api.latency": "api.request.latency",
    "api.requests": "api.request.count",
    "api.errors": "api.request.errors",
    "api.slow": "api.request.slow",
    "stream.requests": "stream.requests",
    "stream.transcode.duration": "stream.transcode.duration",
    "stream.transcode.completed": "stream.transcode.completed",
    "stream.transcode.failed": "stream.transcode.failed",
    "stream.cache.bytes": "stream.cache.bytes",
    "stream.cache.bytes_removed": "stream.cache.bytes_removed",
    "playback.startup.ms": "playback.startup.ms",
    "playback.stall.ms": "playback.stall.ms",
    "home.compute.ms": "home.compute.ms",
    "home.endpoint_compute.ms": "home.endpoint_compute.ms",
    "worker.queue.depth": "worker.queue.depth",
    "worker.task.duration": "worker.task.duration",
    "worker.queue.wait": "worker.queue.wait",
    "worker.resource.deferred": "worker.resource.deferred",
    "worker.resource.defer_seconds": "worker.resource.defer_seconds",
    "worker.resource.load_ratio": "worker.resource.load_ratio",
    "worker.resource.iowait_percent": "worker.resource.iowait_percent",
    "worker.resource.swap_used_percent": "worker.resource.swap_used_percent",
}

_SUMMARY_METRICS = {
    "api_latency": ("api.request.latency", 5),
    "api_requests": ("api.request.count", 5),
    "api_errors": ("api.request.count", 5, {"status_class": "5xx"}),
    "api_slow": ("api.request.count", 5, {"latency_class": "slow"}),
    "worker_queue_depth": ("worker.queue.depth", 5),
    "stream_requests": ("stream.requests", 5),
    "stream_latency": ("stream.latency", 5),
    "stream_concurrent": ("stream.concurrent", 5),
    "stream_transcode_duration": ("stream.transcode.duration", 60),
    "stream_transcode_completed": ("stream.transcode.completed", 60),
    "stream_transcode_failed": ("stream.transcode.failed", 60),
    "stream_cache_bytes": ("stream.cache.bytes", 120),
    "stream_cache_files": ("stream.cache.files", 120),
    "stream_cache_bytes_removed": ("stream.cache.bytes_removed", 120),
    "stream_cache_files_removed": ("stream.cache.files_removed", 120),
    "stream_cache_orphan_files": ("stream.cache.orphan_files", 120),
    "playback_startup_ms": ("playback.startup.ms", 15),
    "playback_stalls": ("playback.stall.count", 15),
    "playback_stall_ms": ("playback.stall.ms", 15),
    "playback_recoveries": ("playback.recovery.count", 15),
    "home_cache_hit": ("home.cache.hit", 15),
    "home_cache_miss": ("home.cache.miss", 15),
    "home_cache_waited": ("home.cache.waited", 15),
    "home_cache_coalesced": ("home.cache.coalesced", 15),
    "home_cache_stale_fallback": ("home.cache.stale_fallback", 15),
    "home_compute_ms": ("home.compute.ms", 15),
    "home_endpoint_cache_hit": ("home.endpoint_cache.hit", 15),
    "home_endpoint_cache_miss": ("home.endpoint_cache.miss", 15),
    "home_endpoint_compute_ms": ("home.endpoint_compute.ms", 15),
    "worker_resource_deferred": ("worker.resource.deferred", 60),
    "worker_resource_defer_seconds": ("worker.resource.defer_seconds", 60),
    "worker_resource_load_ratio": ("worker.resource.load_ratio", 60),
    "worker_resource_iowait_percent": ("worker.resource.iowait_percent", 60),
    "worker_resource_swap_used_percent": ("worker.resource.swap_used_percent", 60),
    "media_worker_completed": ("media_worker.package.completed", 60),
    "media_worker_failed": ("media_worker.package.failed", 60),
    "media_worker_duration": ("media_worker.package.duration", 60),
    "media_worker_bytes": ("media_worker.package.bytes", 60),
    "media_worker_admission_denied": ("media_worker.admission.denied", 60),
    "media_worker_cache_pruned": ("media_worker.cache.pruned", 60),
    "media_worker_cache_bytes_removed": ("media_worker.cache.bytes_removed", 60),
}


def _require_ops_health(request: Request) -> dict:
    return require_permission(request, "ops.health.view")


def _require_governor_view(request: Request) -> dict:
    return require_any_permission(request, ("ops.health.view", "ops.tasks.manage"))


def _require_ops_logs(request: Request) -> dict:
    return require_permission(request, "ops.logs.view")


def _require_ops_runtime(request: Request) -> dict:
    return require_permission(request, "ops.runtime.manage")


def _require_llm_status_viewer(request: Request) -> dict:
    return require_any_permission(
        request,
        (
            "library.metadata.write",
            "curation.playlists.write",
            "curation.genres.write",
            "curation.releases.write",
            "ops.health.view",
        ),
    )


def _build_metrics_summary(*, include_local: bool = True) -> dict:
    from crate.metrics import query_summaries
    from crate.db.queries.metric_minutes import get_metric_history_status

    try:
        history = get_metric_history_status()
    except Exception:
        history = {
            "source": "postgresql_v2",
            "availability": "unavailable",
            "cutover_at": None,
            "legacy_status": "unverified",
            "legacy_combined": False,
        }
    result = {
        **query_summaries(_SUMMARY_METRICS),
        "_meta": {
            "schema_version": 2,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "history": history,
        },
    }
    return _attach_local_collector(result) if include_local else result


def _attach_local_collector(summary: dict) -> dict:
    from crate.metrics import get_collection_health

    return {
        **summary,
        "_meta": {**summary["_meta"], "collector_local": get_collection_health()},
    }


def _build_metrics_system() -> dict:
    try:
        from crate.storage_health import collect_storage_health

        disk = collect_storage_health()
    except Exception:
        disk = {}

    db_pool = {}
    db_pools = {"combined": {}, "sqlalchemy": {}, "legacy": {}}
    try:
        from crate.db.engine import get_pool_runtime

        pool_runtime = get_pool_runtime()
        if pool_runtime["configured"]:
            sqlalchemy_pool = {
                "size": pool_runtime["size"],
                "checked_in": pool_runtime["checked_in"],
                "checked_out": pool_runtime["checked_out"],
                "overflow": pool_runtime["overflow"],
                "total": pool_runtime["checked_in"] + pool_runtime["checked_out"],
            }
            db_pools["sqlalchemy"] = sqlalchemy_pool
    except Exception:
        pass

    sqlalchemy_pool = db_pools.get("sqlalchemy") or {}
    legacy_state = db_pools.get("legacy") or {}
    if sqlalchemy_pool or legacy_state:
        combined = {
            "size": int(sqlalchemy_pool.get("size") or 0)
            + int(legacy_state.get("size") or 0),
            "checked_in": int(sqlalchemy_pool.get("checked_in") or 0)
            + int(legacy_state.get("checked_in") or 0),
            "checked_out": int(sqlalchemy_pool.get("checked_out") or 0)
            + int(legacy_state.get("checked_out") or 0),
            "overflow": int(sqlalchemy_pool.get("overflow") or 0)
            + int(legacy_state.get("overflow") or 0),
            "total": int(sqlalchemy_pool.get("total") or 0)
            + int(legacy_state.get("total") or 0),
        }
        db_pools["combined"] = combined
        db_pool = combined or sqlalchemy_pool or legacy_state

    analysis = {}
    try:
        from crate.analysis_daemon import get_analysis_status

        analysis = get_analysis_status()
    except Exception:
        pass

    load = {}
    try:
        load_avg = os.getloadavg()
        cpu_count = os.cpu_count() or 1
        load = {
            "load_1m": round(load_avg[0], 2),
            "load_5m": round(load_avg[1], 2),
            "load_15m": round(load_avg[2], 2),
            "cpu_count": cpu_count,
            "load_percent": round(load_avg[0] / cpu_count * 100, 1),
        }
    except Exception:
        pass

    resource_pressure = {}
    try:
        from crate.db.ops_runtime import get_ops_runtime_state

        resource_pressure = (
            get_ops_runtime_state("resource_governor", max_age_seconds=45) or {}
        )
    except Exception:
        resource_pressure = {}

    media_worker = {}
    try:
        from crate.media_worker_progress import get_media_worker_runtime

        media_worker = get_media_worker_runtime(limit=5)
    except Exception:
        media_worker = {}

    artwork_variants = {}
    try:
        from crate.health_check import artwork_variant_health_sample

        artwork_variants = artwork_variant_health_sample()
    except Exception:
        artwork_variants = {}

    return {
        "disk": disk,
        "db_pool": db_pool,
        "db_pools": db_pools,
        "analysis": analysis,
        "load": load,
        "resource_pressure": resource_pressure,
        "media_worker": media_worker,
        "artwork_variants": artwork_variants,
    }


def _list_running_tasks(limit: int = 10) -> list[dict]:
    from crate.db.queries.tasks import list_tasks

    return list_tasks(status="running", limit=limit)


def _build_playback_delivery() -> dict:
    try:
        from crate.config import load_config
        from crate.db.queries.streaming_admin import get_playback_delivery_snapshot
        from crate.worker_handlers.playback import get_stream_transcode_runtime

        payload = get_playback_delivery_snapshot(limit=5)
        payload["runtime"] = get_stream_transcode_runtime(load_config())
        return payload
    except Exception:
        return {
            "stats": {
                "tracks": 0,
                "lossless_tracks": 0,
                "hires_tracks": 0,
                "variants": 0,
                "variant_tracks": 0,
                "ready": 0,
                "pending": 0,
                "running": 0,
                "failed": 0,
                "missing": 0,
                "ready_tracks": 0,
                "cached_bytes": 0,
                "ready_source_bytes": 0,
                "estimated_saved_bytes": 0,
                "coverage_percent": 0,
                "avg_prepare_seconds": None,
            },
            "runtime": {"active": 0, "limit": 1, "slots": []},
            "recent_variants": [],
        }


def _build_metrics_dashboard(period: str, minutes: int) -> dict:
    from crate.db.cache_store import get_cache, set_cache
    from crate.metrics import query_timeseries_snapshot, query_route_latency_snapshot

    cache_key = f"admin:metrics:dashboard:v2:{period}:{minutes}"
    cached = get_cache(cache_key, max_age_seconds=10)
    if cached is not None:
        return {**cached, "summary": _attach_local_collector(cached["summary"])}

    sampled = query_timeseries_snapshot(
        list(_DASHBOARD_TIMESERIES.values()),
        period=period,
        minutes=minutes,
        persisted=True,
    )
    timeseries = {
        response_name: sampled["data"][metric_name]
        for response_name, metric_name in _DASHBOARD_TIMESERIES.items()
    }
    timeseries_status = {
        response_name: sampled["status"][metric_name]
        for response_name, metric_name in _DASHBOARD_TIMESERIES.items()
    }
    routes = query_route_latency_snapshot(minutes=min(minutes, 60), limit=20)
    payload = {
        "summary": _build_metrics_summary(include_local=False),
        "system": _build_metrics_system(),
        "tasks": _list_running_tasks(limit=10),
        "playback_delivery": _build_playback_delivery(),
        "route_latency": routes["routes"],
        "route_latency_status": {
            key: value for key, value in routes.items() if key != "routes"
        },
        "timeseries": timeseries,
        "timeseries_status": timeseries_status,
    }
    set_cache(cache_key, payload, ttl=10)
    return {**payload, "summary": _attach_local_collector(payload["summary"])}


@router.get(
    "/metrics/summary",
    response_model=MetricsSummaryResponse,
    response_model_exclude_unset=True,
    responses=AUTH_ERROR_RESPONSES,
    summary="Current metrics snapshot",
)
def metrics_summary(request: Request):
    _require_ops_health(request)
    return _build_metrics_summary()


@router.get(
    "/metrics/timeseries",
    response_model=MetricsTimeseriesResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Time-series metric data",
)
def metrics_timeseries(
    request: Request,
    name: str = Query(..., description="Metric name, e.g. api.latency"),
    period: Literal["minute", "hour", "day"] = Query(
        "hour", description="Granularity: minute, hour, day"
    ),
    start: str | None = Query(None, description="ISO start timestamp"),
    end: str | None = Query(None, description="ISO end timestamp"),
    minutes: int = Query(
        60, ge=1, le=2880, description="Minutes of recent data (for period=minute)"
    ),
):
    _require_ops_health(request)
    from crate.metrics import query_timeseries_snapshot

    metric_name = _DASHBOARD_TIMESERIES.get(name, name)

    try:
        for bound in (start, end):
            if bound is not None:
                datetime.fromisoformat(bound)
        bounds = {
            key: value
            for key, value in (("start", start), ("end", end))
            if value is not None
        }
        if period == "day" and "start" not in bounds:
            bounds["start"] = (
                (datetime.now(timezone.utc) - timedelta(days=8))
                .replace(second=0, microsecond=0)
                .isoformat()
            )
        snapshot = query_timeseries_snapshot(
            [metric_name], period=period, minutes=minutes, persisted=True, **bounds
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    canonical = next(iter(snapshot["data"]))
    return {
        "name": name,
        "period": period,
        "data": snapshot["data"][canonical],
        "status": snapshot["status"][canonical],
    }


@router.get(
    "/metrics/routes",
    response_model=MetricsRoutesResponse,
    response_model_exclude_unset=True,
    responses=AUTH_ERROR_RESPONSES,
    summary="Recent API route latency",
)
def metrics_routes(
    request: Request,
    minutes: int = Query(15, ge=1, le=240, description="Recent minutes to aggregate"),
    limit: int = Query(20, ge=1, le=100, description="Maximum routes to return"),
    target: str | None = Query(None, description="Optional target filter, e.g. api"),
):
    _require_ops_health(request)
    from crate.metrics import query_route_latency_snapshot

    return {
        "minutes": minutes,
        "limit": limit,
        "target": target,
        **query_route_latency_snapshot(minutes=minutes, limit=limit, target=target),
    }


@router.get(
    "/metrics/dashboard",
    response_model=MetricsDashboardResponse,
    response_model_exclude_unset=True,
    responses=AUTH_ERROR_RESPONSES,
    summary="Bundled system health payload",
)
def metrics_dashboard(
    request: Request,
    period: str = Query("minute", description="Granularity: minute or hour"),
    minutes: int = Query(60, ge=1, le=2880, description="Minutes of recent data"),
):
    _require_ops_health(request)
    safe_period = period if period in {"minute", "hour", "day"} else "minute"
    return _build_metrics_dashboard(safe_period, minutes)


@router.get(
    "/governor",
    response_model=AdminGovernorSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the latest worker resource governor sample",
)
def governor_snapshot(request: Request):
    _require_governor_view(request)
    from crate.db.ops_runtime import get_ops_runtime_state

    current = get_ops_runtime_state("resource_governor", max_age_seconds=45)
    stale = current is None
    sample = current or get_ops_runtime_state("resource_governor")
    if sample is None:
        return {"available": False, "stale": False}
    return {
        **sample,
        "available": True,
        "stale": stale,
        "sampled_at": sample.get("updated_at"),
    }


@router.get(
    "/llm/status", responses=AUTH_ERROR_RESPONSES, summary="Check LLM provider status"
)
def llm_status(request: Request):
    _require_llm_status_viewer(request)
    from crate.artist_bio_research import (
        configured_web_search_providers,
        web_search_provider_label,
    )
    from crate.ai.actions import ACTIONS
    from crate.ai.runtime import action_availability

    actions = {}
    for action_id, action in ACTIONS.items():
        try:
            require_permission(request, action.permission)
        except HTTPException:
            continue
        actions[action_id] = action_availability(action_id)
    return {
        "actions": actions,
        "web_research": {
            "available": True,
            "provider": web_search_provider_label(),
            "providers": configured_web_search_providers(),
        },
    }


@router.get(
    "/metrics/system",
    responses=AUTH_ERROR_RESPONSES,
    summary="System-level health stats",
)
def metrics_system(request: Request):
    """Disk usage, DB pool status, analysis progress."""
    _require_ops_health(request)
    return _build_metrics_system()


@router.get("/logs", responses=AUTH_ERROR_RESPONSES, summary="Query worker logs")
def admin_logs(
    request: Request,
    worker_id: str | None = Query(None),
    task_id: str | None = Query(None),
    level: str | None = Query(None),
    category: str | None = Query(None),
    since: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    _require_ops_logs(request)
    from crate.db.worker_logs import query_logs

    return query_logs(
        worker_id=worker_id,
        task_id=task_id,
        level=level,
        category=category,
        since=since,
        limit=limit,
    )


@router.get(
    "/logs/workers", responses=AUTH_ERROR_RESPONSES, summary="List known workers"
)
def admin_workers(request: Request):
    _require_ops_logs(request)
    from crate.db.worker_logs import list_known_workers

    return list_known_workers()


@router.get(
    "/logs-snapshot",
    response_model=AdminLogsSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin logs snapshot",
)
def admin_logs_snapshot(
    request: Request, fresh: bool = False, limit: int = Query(100, ge=1, le=200)
):
    _require_ops_logs(request)
    return get_cached_logs_surface(limit=limit, fresh=fresh)


async def _admin_logs_stream(limit: int) -> AsyncIterator[str]:
    yield f"data: {json_dumps(get_cached_logs_surface(limit=limit))}\n\n"
    pubsub = None
    try:
        pubsub = await open_pubsub(LOGS_SURFACE_STREAM_CHANNEL)
        heartbeat_counter = 0
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message and message.get("type") == "message":
                yield f"data: {json_dumps(get_cached_logs_surface(limit=limit))}\n\n"
                heartbeat_counter = 0
                continue
            heartbeat_counter += 1
            if heartbeat_counter >= 30:
                heartbeat_counter = 0
                yield ": heartbeat\n\n"
    except Exception:
        while True:
            yield f"data: {json_dumps(get_cached_logs_surface(limit=limit))}\n\n"
            await asyncio.sleep(15)
    finally:
        if pubsub is not None:
            await close_pubsub(pubsub, LOGS_SURFACE_STREAM_CHANNEL)


@router.get(
    "/logs-stream",
    responses=AUTH_ERROR_RESPONSES,
    summary="Stream admin logs snapshot updates",
)
async def admin_logs_stream(request: Request, limit: int = Query(100, ge=1, le=200)):
    _require_ops_logs(request)
    return StreamingResponse(
        _admin_logs_stream(limit),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/download-policy",
    responses=AUTH_ERROR_RESPONSES,
    summary="Download policy status and suggested limits",
)
def admin_download_policy(request: Request):
    _require_ops_runtime(request)
    from crate.db.repositories.runtime_policy import read_runtime_policy_state
    from crate.runtime_policy_contract import download_policy_status
    from crate.actors import (
        _count_active_users,
        _count_active_streams,
        get_suggested_download_limits,
    )

    state = read_runtime_policy_state()
    return {
        **download_policy_status(
            state["policy"],
            active_users=_count_active_users(),
            active_streams=_count_active_streams(),
        ),
        "suggested": get_suggested_download_limits(),
        "configured_revision": state["configured_revision"],
        "effective_revision": state["effective_revision"],
        "adoption_status": state["adoption_status"],
    }


class DownloadPolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    window_enabled: StrictBool | None = None
    window_start: str | None = Field(
        default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$"
    )
    window_end: str | None = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    window_timezone: str | None = None
    max_active_users: StrictInt | None = Field(default=None, ge=0, le=10000)
    max_active_streams: StrictInt | None = Field(default=None, ge=0, le=10000)
    expected_revision: StrictInt | None = Field(default=None, ge=0)


@router.put(
    "/download-policy",
    responses=AUTH_ERROR_RESPONSES,
    summary="Update download policy settings",
)
def update_download_policy(request: Request, body: DownloadPolicyUpdate):
    _require_ops_runtime(request)
    from crate.db.repositories.runtime_policy import (
        read_runtime_policy_state,
        update_runtime_policy,
    )
    from crate.runtime_policy_contract import PolicyRevisionConflict

    state = read_runtime_policy_state()
    window = {
        key: getattr(body, f"window_{key}")
        for key in ("enabled", "start", "end", "timezone")
        if getattr(body, f"window_{key}") is not None
    }
    downloads = {
        key: getattr(body, key)
        for key in ("max_active_users", "max_active_streams")
        if getattr(body, key) is not None
    }
    patch = {
        **({"download_window": window} if window else {}),
        **({"downloads": downloads} if downloads else {}),
    }
    try:
        state = update_runtime_policy(
            patch,
            expected_revision=state["configured_revision"]
            if body.expected_revision is None
            else body.expected_revision,
            expected_policy_hash=state["policy_hash"],
        )
    except PolicyRevisionConflict as error:
        raise HTTPException(409, str(error)) from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    return {
        "ok": True,
        "configured_revision": state["configured_revision"],
        "effective_revision": state["effective_revision"],
        "adoption_status": state["adoption_status"],
    }


@router.get(
    "/users/map",
    responses=AUTH_ERROR_RESPONSES,
    summary="Users with geolocation, online and now-playing status",
)
def users_map(request: Request):
    require_permission(request, "users.view")
    from crate.db.repositories.auth import list_users_map_rows

    return {"users": list_users_map_rows()}
