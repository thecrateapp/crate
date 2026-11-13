"""Prometheus gauges of the backups engine (admin backups, BK6).

The ``backup_alerts`` task refreshes them every 5 minutes from the backup tables,
through the metric catalogue (``crate.metrics.record``):

- ``backup.last_success.timestamp`` (``crate_backup_last_success_timestamp_seconds``):
  when the last good run of each kind finished, per ``destination`` and ``kind``;
- ``backup.run.duration`` (``crate_backup_run_duration_seconds``): how long that run
  took;
- ``backup.bytes`` (``crate_backup_bytes``): the repository size each destination
  reported, or the latest local dump's size.

Labels stay bounded: ``destination`` is the destination's provider kind (``s3``,
``gdrive``...) or ``dumps`` for the local dumps, never its name. Several enabled
destinations of one kind report the oldest success, the longest run and the summed
size, so the gauge never hides the one that is behind. A kind that never succeeded
has no sample: missing stays missing.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

DESTINATION_RUN_KINDS = ("offsite", "verify", "restore_drill")
LOCAL_RUN_KINDS = ("dump", "local_retention")
LOCAL_LABEL = "dumps"

Sample = tuple[str, float, dict[str, str]]


def _finished(run: Mapping[str, Any] | None) -> tuple[float, float] | None:
    """(finished timestamp, duration in seconds) of a finished run."""
    if not run:
        return None
    finished = run.get("finished_at")
    started = run.get("started_at")
    if not isinstance(finished, datetime):
        return None
    duration = (
        max(0.0, (finished - started).total_seconds())
        if isinstance(started, datetime)
        else 0.0
    )
    return finished.timestamp(), duration


def backup_samples(
    *,
    destinations: Sequence[Mapping[str, Any]],
    latest: Mapping[str, Mapping[str, Mapping[str, Any]]],
    local_runs: Mapping[str, Mapping[str, Any]],
) -> list[Sample]:
    """The gauge values to record, from rows already read."""
    success: dict[tuple[str, str], float] = {}
    duration: dict[tuple[str, str], float] = {}
    size: dict[str, int] = {}

    def add(label: str, run_kind: str, run: Mapping[str, Any] | None) -> None:
        finished = _finished(run)
        if finished is None:
            return
        at, took = finished
        key = (label, run_kind)
        success[key] = min(success.get(key, at), at)
        duration[key] = max(duration.get(key, took), took)

    for destination in destinations:
        if not destination.get("enabled"):
            continue
        label = str(destination["kind"])
        runs = latest.get(str(destination["id"]), {})
        for run_kind in DESTINATION_RUN_KINDS:
            add(label, run_kind, runs.get(f"{run_kind}_succeeded"))
        if isinstance(destination.get("repository_bytes"), int):
            size[label] = size.get(label, 0) + int(destination["repository_bytes"])
    for run_kind in LOCAL_RUN_KINDS:
        add(LOCAL_LABEL, run_kind, local_runs.get(f"{run_kind}_succeeded"))
    dump = local_runs.get("dump_succeeded") or {}
    if isinstance(dump.get("bytes"), int):
        size[LOCAL_LABEL] = int(dump["bytes"])

    samples: list[Sample] = []
    for (label, run_kind), at in sorted(success.items()):
        tags = {"destination": label, "kind": run_kind}
        samples.append(("backup.last_success.timestamp", at, tags))
        samples.append(("backup.run.duration", duration[(label, run_kind)], tags))
    for label, total in sorted(size.items()):
        samples.append(("backup.bytes", float(total), {"destination": label}))
    return samples


def record_backup_metrics(inputs: Mapping[str, Any]) -> list[Sample]:
    """Record the gauges; ``inputs`` are the rows ``alerts.read_inputs`` returns."""
    from crate.metrics import record

    samples = backup_samples(
        destinations=inputs.get("destinations") or [],
        latest=inputs.get("latest") or {},
        local_runs=inputs.get("local_runs") or {},
    )
    for name, value, tags in samples:
        record(name, value, tags)
    return samples


__all__ = ["LOCAL_LABEL", "backup_samples", "record_backup_metrics"]
