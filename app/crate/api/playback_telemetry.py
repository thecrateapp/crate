"""Best-effort, privacy-safe playback quality telemetry."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, Response, status

from crate.api.auth import _require_auth
from crate.api.openapi_responses import AUTH_ERROR_RESPONSES
from crate.api.schemas.playback_telemetry import PlaybackQoeBatchRequest
from crate.db.cache_runtime import get_redis
from crate.metrics import record_later

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/playback", tags=["playback"])

_QOE_RATE_LIMIT_WINDOW_SECONDS = 60
_QOE_RATE_LIMIT_MAX_EVENTS = 120


def _allow_qoe_events(user_id: int, event_count: int) -> bool:
    """Rate-limit short-lived telemetry counters without retaining user history."""
    redis = get_redis()
    if redis is None:
        return True
    key = f"crate:playback-qoe:{user_id}"
    try:
        total = int(redis.incrby(key, event_count) or 0)
        if total == event_count:
            redis.expire(key, _QOE_RATE_LIMIT_WINDOW_SECONDS)
        return total <= _QOE_RATE_LIMIT_MAX_EVENTS
    except Exception:
        log.debug("Playback QoE rate limiter unavailable", exc_info=True)
        return False


def _metric_tags(event) -> dict[str, str]:
    tags = {
        "origin": event.origin,
        "requested_policy": event.requested_policy,
        "effective_policy": event.effective_policy,
    }
    if event.runtime is not None:
        tags["runtime"] = event.runtime
    if event.engine is not None:
        tags["engine"] = event.engine
    return tags


def _record_qoe_event(event) -> None:
    tags = _metric_tags(event)
    if event.event == "startup" and event.duration_ms is not None:
        record_later("playback.startup.ms", float(event.duration_ms), tags)
    elif event.event == "stall_start":
        record_later("playback.stall.count", 1.0, tags)
    elif event.event == "stall_end" and event.duration_ms is not None:
        record_later("playback.stall.ms", float(event.duration_ms), tags)
    elif event.event == "recovery":
        record_later("playback.recovery.count", 1.0, tags)


@router.post(
    "/qoe",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=AUTH_ERROR_RESPONSES,
    summary="Record privacy-safe playback quality events",
)
def post_playback_qoe(request: Request, body: PlaybackQoeBatchRequest) -> Response:
    user = _require_auth(request)
    user_id = user.get("id")
    if not isinstance(user_id, int):
        raise HTTPException(status_code=401, detail="A persisted user is required")
    if not _allow_qoe_events(user_id, len(body.events)):
        raise HTTPException(
            status_code=429, detail="Playback telemetry rate limit exceeded"
        )

    for event in body.events:
        _record_qoe_event(event)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
