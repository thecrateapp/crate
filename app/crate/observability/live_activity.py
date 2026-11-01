"""Live Stack activity frames: aggregate counts sampled off-request, only while watched."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import datetime, timezone

from crate.observability import metric_buckets

log = logging.getLogger(__name__)

PREFIX = "crate:live:stack"
CHANNEL = f"{PREFIX}:activity"
FRAME_KEY = f"{PREFIX}:frame"
WATCH_KEY = f"{PREFIX}:watched"
SEQUENCE_KEY = f"{PREFIX}:sequence"
FRAME_TTL_SECONDS = 30
WATCH_TTL_SECONDS = 30
MAX_FRAME_GAP_SECONDS = 120
RESOURCES_INTERVAL_SECONDS = 30
SCHEMA_VERSION = 1

_SPECS = {
    "requests": ("api.request.client", 2),
    "tasks": ("worker.task.duration", 2),
}


class ActivitySampler:
    """Turn absolute per-minute counters into per-frame deltas without inventing zeros."""

    def __init__(
        self,
        *,
        redis: Callable,
        minute: Callable[[], int],
        now: Callable[[], float],
        count_listening: Callable[[], int],
        fetch_resources: Callable[[], dict] | None = None,
    ):
        self._redis = redis
        self._fetch_resources = fetch_resources
        self._resources: dict | None = None
        self._resources_at: float | None = None
        self._minute = minute
        self._now = now
        self._count_listening = count_listening
        self._previous: dict[tuple[str, str, int], int] | None = None
        self._previous_at: float | None = None

    def redis(self):
        return self._redis()

    def reset(self) -> None:
        self._previous = None
        self._previous_at = None

    def _read_counts(self) -> tuple[dict[tuple[str, str, int], int], bool]:
        redis = self._redis()
        if redis is None:
            raise ConnectionError("Metric Redis is unavailable")
        rows = metric_buckets.read_buckets(redis, _SPECS, self._minute())
        counts = {
            (key, row["tags"], int(row["minute"])): int(row["count"])
            for key, key_rows in rows.items()
            for row in key_rows
        }
        return counts, bool(rows.incomplete)

    def _deltas(self, current: dict[tuple[str, str, int], int]):
        requests: dict[str, dict[str, int]] = {}
        queues: dict[str, dict[str, int]] = {}
        for identity, count in current.items():
            delta = count - self._previous.get(identity, 0)
            if delta <= 0:
                continue
            key, raw_tags, _minute = identity
            tags = json.loads(raw_tags)
            if key == "requests":
                entry = requests.setdefault(
                    tags.get("client", "other"), {"count": 0, "errors": 0}
                )
                entry["count"] += delta
                if tags.get("status_class") == "5xx":
                    entry["errors"] += delta
            else:
                entry = queues.setdefault(
                    tags.get("queue", "other"), {"completed": 0, "failed": 0}
                )
                outcome = tags.get("outcome")
                if outcome == "completed":
                    entry["completed"] += delta
                elif outcome in {"failed", "timeout"}:
                    entry["failed"] += delta
        return requests, queues

    def sample(self, *, events: int | None) -> dict:
        now = self._now()
        sources = {}
        requests = queues = None
        warming = False
        window = None
        try:
            current, incomplete = self._read_counts()
            sources["metrics"] = "partial" if incomplete else "available"
            stalled = (
                self._previous_at is not None
                and now - self._previous_at > MAX_FRAME_GAP_SECONDS
            )
            if self._previous is None or stalled:
                warming = True
                sources["metrics"] = "warming"
            else:
                requests, queues = self._deltas(current)
                window = now - self._previous_at
            self._previous, self._previous_at = current, now
        except Exception:
            log.debug("Live activity metrics read failed", exc_info=True)
            sources["metrics"] = "unavailable"
            self.reset()
        try:
            listening = int(self._count_listening())
            sources["playback"] = "available"
        except Exception:
            log.debug("Live activity playback read failed", exc_info=True)
            listening = None
            sources["playback"] = "unavailable"
        sources["projector"] = "available" if events is not None else "unavailable"
        sources["resources"] = self._refresh_resources(now)
        if warming:
            availability = "warming"
        elif any(
            state in {"unavailable", "partial"}
            for key, state in sources.items()
            if key != "resources"
        ):
            availability = "partial"
        else:
            availability = "available"
        return {
            "schema": SCHEMA_VERSION,
            "sequence": None,
            "observed_at": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
            "window_seconds": round(window, 3) if window is not None else None,
            "availability": availability,
            "requests": requests,
            "queues": queues,
            "projector": {"events": int(events)} if events is not None else None,
            "listening": listening,
            "resources": self._resources,
            "sources": sources,
        }

    def _refresh_resources(self, now: float) -> str:
        if self._fetch_resources is None:
            return "unconfigured"
        if (
            self._resources_at is not None
            and now - self._resources_at < RESOURCES_INTERVAL_SECONDS
        ):
            return "available" if self._resources is not None else "unavailable"
        self._resources_at = now
        try:
            self._resources = self._fetch_resources()
            return "available"
        except Exception:
            log.debug("Live activity resource read failed", exc_info=True)
            return "unavailable"


def mark_watched(redis) -> None:
    redis.set(WATCH_KEY, "1", ex=WATCH_TTL_SECONDS)


def publish_if_watched(sampler: ActivitySampler, *, events: int | None) -> dict | None:
    """Sample and fan out one frame, but only when an SSE client asked recently."""
    redis = sampler.redis()
    if redis is None or not redis.exists(WATCH_KEY):
        sampler.reset()
        return None
    frame = sampler.sample(events=events)
    frame["sequence"] = int(redis.incr(SEQUENCE_KEY))
    payload = json.dumps(frame, separators=(",", ":"))
    redis.set(FRAME_KEY, payload, ex=FRAME_TTL_SECONDS)
    redis.publish(CHANNEL, payload)
    return frame


__all__ = [
    "ActivitySampler",
    "CHANNEL",
    "FRAME_KEY",
    "WATCH_KEY",
    "mark_watched",
    "publish_if_watched",
]
