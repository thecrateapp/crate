"""Catalogue families exported to Prometheus, shared by every process of a container."""

from __future__ import annotations

import atexit
import logging
import math
import os
import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Literal

from crate.observability.metric_catalog import (
    METRIC_CATALOG,
    MetricDefinition,
    MetricSeries,
)

log = logging.getLogger(__name__)

EXPORTED_PREFIXES = (
    "api.request.",
    "artwork.",
    "catalog.search.",
    "federation.playback.",
    "home.",
    "media_worker.",
    "opensubsonic.",
    "playback.",
    "storage.",
    "stream.",
    "worker.",
)
EXCLUDED_FAMILIES = frozenset({"api.route.latency"})
DROPPED_LABELS = frozenset({"route", "service"})
OPTIONAL_LABELS = ("task_type",)
LABEL_BUDGET = 4000
PER_PROCESS_GAUGES = frozenset({"stream.concurrent"})
BUCKETS = MappingProxyType(
    {
        "seconds": (
            0.005,
            0.01,
            0.025,
            0.05,
            0.1,
            0.25,
            0.5,
            1.0,
            2.5,
            5.0,
            10.0,
            30.0,
            60.0,
            300.0,
        ),
        "bytes": tuple(float(1024 * 4**power) for power in range(11)),
        "ratio": (0.1, 0.25, 0.5, 0.75, 0.9, 1.0),
        "1": (1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0),
    }
)
_UNIT_SUFFIXES = MappingProxyType(
    {"seconds": "seconds", "bytes": "bytes", "ratio": "ratio"}
)
_INPUT_UNIT_TOKENS = frozenset({"ms", "seconds", "mb", "bytes", "percent"})
_COUNT_TOKENS = frozenset({"count", "total"})


@dataclass(frozen=True)
class ExportedFamily:
    source: str
    name: str
    kind: str
    unit: str
    labels: tuple[str, ...]
    multiprocess_mode: Literal["livesum", "mostrecent"] | None
    buckets: tuple[float, ...] | None


def prometheus_name(definition: MetricDefinition) -> str:
    tokens = re.split(r"[._]", definition.name)
    removable = _INPUT_UNIT_TOKENS | (
        _COUNT_TOKENS if definition.kind == "counter" else frozenset()
    )
    if len(tokens) > 1 and tokens[-1] in removable:
        tokens = tokens[:-1]
    suffix = _UNIT_SUFFIXES.get(definition.unit)
    if suffix and suffix not in tokens:
        tokens.append(suffix)
    return "crate_" + "_".join(tokens)


def _labels(definition: MetricDefinition) -> tuple[str, ...]:
    if definition.name in PER_PROCESS_GAUGES:
        return ()
    labels = {
        name: len(values)
        for name, values in definition.labels
        if name not in DROPPED_LABELS
    }
    for optional in OPTIONAL_LABELS:
        if math.prod(labels.values()) <= LABEL_BUDGET:
            break
        labels.pop(optional, None)
    return tuple(sorted(labels))


def _family(definition: MetricDefinition) -> ExportedFamily:
    mode: Literal["livesum", "mostrecent"] | None = None
    if definition.kind == "gauge":
        mode = "livesum" if definition.name in PER_PROCESS_GAUGES else "mostrecent"
    return ExportedFamily(
        source=definition.name,
        name=prometheus_name(definition),
        kind=definition.kind,
        unit=definition.unit,
        labels=_labels(definition),
        multiprocess_mode=mode,
        buckets=BUCKETS[definition.unit] if definition.kind == "histogram" else None,
    )


EXPORTED_FAMILIES = MappingProxyType(
    {
        name: _family(definition)
        for name, definition in METRIC_CATALOG.items()
        if name.startswith(EXPORTED_PREFIXES) and name not in EXCLUDED_FAMILIES
    }
)

_metrics: dict[str, Any] = {}
_enabled: bool | None = None
_exit_pid: int | None = None


def enabled() -> bool:
    global _enabled
    if _enabled is None:
        _enabled = os.environ.get("CRATE_PROMETHEUS_METRICS") == "1" and bool(
            os.environ.get("PROMETHEUS_MULTIPROC_DIR")
        )
    return _enabled


def _mark_dead(pid: int) -> None:
    if os.getpid() != pid:
        return
    from prometheus_client import multiprocess

    multiprocess.mark_process_dead(pid)


def _register_exit() -> None:
    global _exit_pid
    pid = os.getpid()
    if _exit_pid != pid:
        _exit_pid = pid
        atexit.register(_mark_dead, pid)


def _metric(family: ExportedFamily) -> Any:
    if family.name in _metrics:
        return _metrics[family.name]
    import prometheus_client

    _register_exit()
    description = f"{family.source} ({family.unit})"
    metric: Any
    if family.kind == "counter":
        metric = prometheus_client.Counter(
            family.name, description, family.labels, registry=None
        )
    elif family.kind == "gauge":
        metric = prometheus_client.Gauge(
            family.name,
            description,
            family.labels,
            registry=None,
            multiprocess_mode=family.multiprocess_mode or "mostrecent",
        )
    else:
        metric = prometheus_client.Histogram(
            family.name,
            description,
            family.labels,
            registry=None,
            buckets=family.buckets or BUCKETS[family.unit],
        )
    _metrics[family.name] = metric
    return metric


def observe(series: MetricSeries, value: float) -> None:
    """Add one catalogue observation in catalogue units; never raises."""
    if not enabled():
        return
    family = EXPORTED_FAMILIES.get(series.definition.name)
    if family is None or (family.kind == "counter" and value <= 0):
        return
    try:
        metric = _metric(family)
        if family.labels:
            tags = dict(series.tags)
            metric = metric.labels(*(tags.get(label, "") for label in family.labels))
        if family.kind == "counter":
            metric.inc(value)
        elif family.kind == "gauge":
            metric.set(value)
        else:
            metric.observe(value)
    except Exception:
        log.debug("Prometheus observation failed for %s", family.name, exc_info=True)


__all__ = [
    "EXPORTED_FAMILIES",
    "ExportedFamily",
    "enabled",
    "observe",
    "prometheus_name",
]
