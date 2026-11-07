"""Deterministic Crate priority for error issues.

The score orders the inbox whether or not a model is configured, explains itself
("a regression in streaming with 14 users") and never moves between calls. Weights
are calibrated with the real backlog and pinned by tests; changing them is a reviewed
change.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

LEVEL_WEIGHTS = {"fatal": 40, "error": 25, "warning": 5, "info": 0}
SUBSTATUS_WEIGHTS = {"escalating": 25, "regressed": 20, "new": 15}
SENTRY_PRIORITY_WEIGHTS = {"high": 15, "medium": 5, "low": 0}
SERVICE_WEIGHTS = {
    "readplane": 15,
    "api": 15,
    "playback": 15,
    "listen": 15,
    "workers": 10,
    "projector": 10,
    "media-worker": 10,
    "admin": 5,
    "cast-receiver": 5,
    "docs": 0,
    "site": 0,
}
USERS_WEIGHT = 6
EVENTS_WEIGHT = 3

CRITICAL_SCORE = 70
CRITICAL_TRIAGE_CONFIDENCE = 0.6


def service_weight(service: str | None) -> int:
    """Weight for a `service` tag or project slug (`crate-api`, `worker-fast`, ...)."""
    name = (service or "").strip().lower().removeprefix("crate-")
    if name.startswith("worker-"):
        return SERVICE_WEIGHTS["playback"] if name == "worker-playback" else 10
    return SERVICE_WEIGHTS.get(name, 0)


def _count(value: Any) -> int:
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def crate_score(issue: Mapping[str, Any]) -> int:
    score = (
        LEVEL_WEIGHTS.get(str(issue.get("level") or ""), 0)
        + SUBSTATUS_WEIGHTS.get(str(issue.get("substatus") or ""), 0)
        + service_weight(issue.get("service"))
        + USERS_WEIGHT * math.log2(1 + _count(issue.get("users_24h")))
        + EVENTS_WEIGHT * math.log2(1 + _count(issue.get("events_24h")))
        + SENTRY_PRIORITY_WEIGHTS.get(str(issue.get("sentry_priority") or ""), 0)
    )
    return int(round(score))


def is_critical(
    issue: Mapping[str, Any], triage: Mapping[str, Any] | None = None
) -> bool:
    """Critical lane: a high score, or a confident critical triage."""
    score = issue.get("crate_score")
    if score is None:
        score = crate_score(issue)
    if int(score) >= CRITICAL_SCORE:
        return True
    if not triage or triage.get("severity") != "critical":
        return False
    return float(triage.get("confidence") or 0) >= CRITICAL_TRIAGE_CONFIDENCE


__all__ = [
    "CRITICAL_SCORE",
    "CRITICAL_TRIAGE_CONFIDENCE",
    "crate_score",
    "is_critical",
    "service_weight",
]
