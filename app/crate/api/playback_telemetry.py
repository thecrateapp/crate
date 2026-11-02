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
_QOE_SESSION_MAX_EVENTS = 120
_QOE_USER_MAX_EVENTS = 600
_QOE_DEDUP_SECONDS = 24 * 60 * 60


def _allow_qoe_events(
    user_id: int, session_id: str | None, event_count: int
) -> bool | None:
    """Per client session, with a higher ceiling per user; None when unverifiable."""
    redis = get_redis()
    if redis is None:
        return None
    limits = [(f"crate:playback-qoe:user:{user_id}", _QOE_USER_MAX_EVENTS)]
    if session_id:
        limits.append(
            (f"crate:playback-qoe:session:{session_id}", _QOE_SESSION_MAX_EVENTS)
        )
    try:
        pipeline = redis.pipeline()
        for key, _limit in limits:
            pipeline.incrby(key, event_count)
            pipeline.expire(key, _QOE_RATE_LIMIT_WINDOW_SECONDS, nx=True)
        totals = pipeline.execute()[::2]
    except Exception:
        log.debug("Playback QoE rate limiter unavailable", exc_info=True)
        return None
    return all(int(total or 0) <= limit for total, (_key, limit) in zip(totals, limits))


def _fresh_events(events) -> tuple[list, int, bool]:
    """Drop events already accepted within a day; events without an id pass."""
    identified = [event for event in events if event.event_id]
    if not identified:
        return list(events), 0, True
    redis = get_redis()
    if redis is None:
        return list(events), 0, False
    try:
        pipeline = redis.pipeline()
        for event in identified:
            pipeline.set(
                f"crate:playback-qoe:event:{event.event_id}",
                "1",
                nx=True,
                ex=_QOE_DEDUP_SECONDS,
            )
        claimed = pipeline.execute()
    except Exception:
        log.debug("Playback QoE deduplication unavailable", exc_info=True)
        return list(events), 0, False
    duplicates = {
        event.event_id for event, fresh in zip(identified, claimed) if not fresh
    }
    fresh = [event for event in events if event.event_id not in duplicates]
    return fresh, len(events) - len(fresh), True


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


def _runtime_tags(event, *names: str) -> dict[str, str]:
    tags = {"origin": event.origin}
    for name in names:
        value = getattr(event, name)
        if value is not None:
            tags[name] = value
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
    elif event.event == "intent":
        record_later(
            "playback.intent.count", 1.0, _runtime_tags(event, "runtime", "engine")
        )
    elif event.event == "result":
        result_tags = {**_runtime_tags(event, "runtime"), "outcome": event.outcome}
        if event.cause is not None:
            result_tags["cause"] = event.cause
        record_later("playback.result.count", 1.0, result_tags)
    elif event.event == "active" and event.duration_ms is not None:
        record_later(
            "playback.active.ms",
            float(event.duration_ms),
            _runtime_tags(event, "runtime", "engine"),
        )


def _record_delivery(body: PlaybackQoeBatchRequest) -> None:
    version = "v2" if body.schema_version == 2 else "v1"
    record_later("playback.telemetry.payload", 1.0, {"version": version})
    if body.delivery is None:
        return
    for reason in ("dropped", "expired", "send_failed"):
        count = getattr(body.delivery, reason)
        if count:
            record_later(
                "playback.telemetry.client_loss", float(count), {"reason": reason}
            )


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
    session_id = user.get("session_id")
    allowed = _allow_qoe_events(
        user_id, str(session_id) if session_id else None, len(body.events)
    )
    if allowed is False:
        record_later(
            "playback.telemetry.events",
            float(len(body.events)),
            {"outcome": "rate_limited"},
        )
        raise HTTPException(
            status_code=429,
            detail="Playback telemetry rate limit exceeded",
            headers={"Retry-After": str(_QOE_RATE_LIMIT_WINDOW_SECONDS)},
        )

    fresh, duplicates, verified = _fresh_events(body.events)
    _record_delivery(body)
    if duplicates:
        record_later(
            "playback.telemetry.events", float(duplicates), {"outcome": "duplicate"}
        )
    if fresh:
        outcome = "accepted" if allowed and verified else "unverified"
        record_later(
            "playback.telemetry.events", float(len(fresh)), {"outcome": outcome}
        )
    for event in fresh:
        _record_qoe_event(event)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
