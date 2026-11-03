"""Radio and Music Paths observations, recorded once per batch or plan."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from statistics import median

from crate.metrics import record_later

log = logging.getLogger(__name__)

RELAXATION_LEVELS = ("none", "artist_batch", "artist_session", "consecutive")
PATH_WARNING_CODES = (
    "insufficient_tracks",
    "excess_tracks",
    "missing_origin",
    "missing_destination",
    "duplicate_song",
    "unavailable_track",
    "invalid_progress",
    "artist_repeat_limit",
    "repeated_artist",
    "unresolved_waypoint",
    "invalid_waypoint_order",
)


@dataclass
class RadioBatchObservation:
    stage: str
    requested: int
    profile: str | None = None
    recovered: bool = False
    relaxation: dict[str, int] = field(default_factory=dict)


_radio_batch: ContextVar[RadioBatchObservation | None] = ContextVar(
    "radio_batch_observation", default=None
)


def note_radio_relaxation(level: str) -> None:
    observation = _radio_batch.get()
    if observation is not None:
        observation.relaxation[level] = observation.relaxation.get(level, 0) + 1


def note_radio_generated(profile: str) -> None:
    observation = _radio_batch.get()
    if observation is not None:
        observation.profile = profile


def note_radio_recovered() -> None:
    observation = _radio_batch.get()
    if observation is not None:
        observation.profile = None
        observation.recovered = True
        observation.relaxation.clear()


@contextmanager
def observe_radio_batch(stage: str, requested: int):
    """Yield a holder for the batch result; record it even when generation fails."""
    observation = RadioBatchObservation(stage=stage, requested=max(1, requested))
    token = _radio_batch.set(observation)
    started = time.perf_counter()
    holder: dict = {}
    try:
        yield holder
    except Exception:
        _record_radio_batch(observation, None, started)
        raise
    finally:
        _radio_batch.reset(token)
    _record_radio_batch(observation, holder.get("result"), started)


def _record_radio_batch(
    observation: RadioBatchObservation, result: dict | None, started: float
) -> None:
    try:
        generated = observation.profile is not None
        outcome = "error" if result is None else str(result.get("status") or "other")
        source = (
            "generated"
            if generated
            else "recovered"
            if observation.recovered
            else "replayed"
        )
        record_later(
            "radio.batch.count",
            1.0,
            {
                "stage": observation.stage,
                "outcome": outcome,
                "source": source,
                "profile": observation.profile or "none",
            },
        )
        if not generated or result is None:
            return
        tags = {"stage": observation.stage, "profile": observation.profile}
        tracks = list(result.get("tracks") or [])
        record_later("radio.batch.ms", (time.perf_counter() - started) * 1000.0, tags)
        record_later("radio.batch.fill", len(tracks) / observation.requested, tags)
        profile = {"profile": observation.profile}
        for level, count in observation.relaxation.items():
            record_later(
                "radio.batch.relaxation", float(count), {**profile, "level": level}
            )
        with_vector = sum(1 for track in tracks if track.get("bliss_vector"))
        for coverage, count in (
            ("present", with_vector),
            ("missing", len(tracks) - with_vector),
        ):
            if count:
                record_later(
                    "radio.batch.vectors",
                    float(count),
                    {**profile, "coverage": coverage},
                )
        distances = [
            float(track["distance"])
            for track in tracks
            if isinstance(track.get("distance"), (int, float))
        ]
        if distances and observation.profile != "global_catalog":
            record_later("radio.batch.distance", median(distances), profile)
    except Exception:
        log.debug("Radio batch observation failed", exc_info=True)


def observe_music_path_plan(
    engine: str, plan: dict | None, step_count: int, started: float
) -> None:
    try:
        tracks = list((plan or {}).get("tracks") or [])
        if plan is None:
            outcome = "unresolved"
        elif not tracks:
            outcome = "empty"
        elif plan.get("is_partial"):
            outcome = "partial"
        else:
            outcome = "complete"
        tags = {"engine": engine}
        record_later("paths.plan.count", 1.0, {**tags, "outcome": outcome})
        record_later("paths.plan.ms", (time.perf_counter() - started) * 1000.0, tags)
        if plan is None:
            return
        generated = plan.get("generated_step_count", len(tracks))
        record_later("paths.plan.fill", generated / max(1, step_count), tags)
        codes = {
            str(warning.get("code"))
            for warning in plan.get("warnings") or []
            if isinstance(warning, dict)
        }
        for code in sorted(codes):
            record_later("paths.plan.warnings", 1.0, {**tags, "code": code})
    except Exception:
        log.debug("Music path observation failed", exc_info=True)


__all__ = [
    "PATH_WARNING_CODES",
    "RELAXATION_LEVELS",
    "note_radio_generated",
    "note_radio_recovered",
    "note_radio_relaxation",
    "observe_music_path_plan",
    "observe_radio_batch",
]
