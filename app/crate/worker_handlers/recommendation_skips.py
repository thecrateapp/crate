"""Hourly early-skip rates for radio and Music Paths plays."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crate.db.queries.recommendation_skips import get_early_skip_counts
from crate.metrics import record
from crate.recommendation_policy import (
    EARLY_SKIP_SECONDS,
    RECOMMENDATION_RULES_REVISION,
)
from crate.worker_handlers import TaskHandler

WINDOW = timedelta(hours=24)


def publish_early_skips(now: datetime | None = None) -> dict:
    until = (now or datetime.now(timezone.utc)).replace(
        minute=0, second=0, microsecond=0
    )
    counts = get_early_skip_counts(
        until - WINDOW, until, early_seconds=EARLY_SKIP_SECONDS
    )
    revision = str(RECOMMENDATION_RULES_REVISION)
    for surface, values in counts.items():
        tags = {"surface": surface, "rules_revision": revision}
        record("recommendations.early_skip.sample", values["delivered"], tags)
        if values["delivered"]:
            record(
                "recommendations.early_skip.ratio",
                values["early_skips"] / values["delivered"],
                tags,
            )
    return {
        "window_end": until.isoformat(),
        "rules_revision": revision,
        "surfaces": counts,
    }


def _handle_compute_recommendation_skips(
    task_id: str, params: dict, config: dict
) -> dict:
    return publish_early_skips()


RECOMMENDATION_SKIP_TASK_HANDLERS: dict[str, TaskHandler] = {
    "compute_recommendation_skips": _handle_compute_recommendation_skips,
}
