"""Bounded metric identity and units, without runtime services at import time."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from types import MappingProxyType

from crate.observability.http_metric_routes import HTTP_ROUTES
from crate.observability.metric_catalog_data import (
    LABEL_VALUES,
    MCP_OUTCOMES,
    MCP_TOOLS,
    METRIC_SPECS,
)

_ALIASES = {
    "api.latency": "api.request.latency",
    "api.requests": "api.request.count",
    "api.errors": "api.request.errors",
    "api.slow": "api.request.slow",
}
_SERVICES = frozenset(
    {
        "api",
        "readplane",
        "worker",
        "worker-default",
        "worker-fast",
        "worker-maintenance",
        "worker-analysis",
        "worker-heavy",
        "worker-playback",
        "projector",
        "media-worker",
        "listen",
        "admin",
        "cast",
        "docs",
        "other",
    }
)
_PARAMETER = re.compile(r"\{[^{}]+\}")


@dataclass(frozen=True)
class MetricDefinition:
    name: str
    kind: str
    unit: str
    input_unit: str
    scale: float
    labels: tuple[tuple[str, frozenset[str]], ...]
    max_series: int = 1024
    sampled: bool = False


@dataclass(frozen=True)
class MetricSeries:
    definition: MetricDefinition
    tags: tuple[tuple[str, str], ...]
    tags_json: str
    series_id: str
    normalized_labels: int


def _label_name(name: str, registry: str) -> str:
    if name == "path":
        return "route"
    if name == "status":
        return "status_class" if registry == "http_status" else "outcome"
    return {"type": "task_type", "reason_code": "reason", "result": "outcome"}.get(
        name, name
    )


def _values(registry: str) -> frozenset[str]:
    if registry == "http_path":
        return HTTP_ROUTES
    values = LABEL_VALUES[registry]
    if isinstance(values, str):
        values = LABEL_VALUES[values]
    return frozenset((*values, "other"))


def _definition(
    name: str, kind: str, input_unit: str, labels: dict
) -> MetricDefinition:
    unit, scale = {
        "milliseconds": ("seconds", 0.001),
        "mebibytes": ("bytes", 1024.0 * 1024),
        "percent": ("ratio", 0.01),
    }.get(input_unit, (input_unit, 1.0))
    fields = {
        _label_name(key, registry): _values(registry)
        for key, registry in labels.items()
    }
    fields["service"] = _SERVICES
    if name.startswith(("api.", "stream.", "opensubsonic.request")):
        fields["target"] = frozenset({"api", "opensubsonic", "stream", "other"})
    return MetricDefinition(
        name=name,
        kind={
            "counter_delta": "counter",
            "distribution": "histogram",
            "sampled_distribution": "histogram",
        }.get(kind, kind),
        unit=unit,
        input_unit=input_unit,
        scale=scale,
        labels=tuple(sorted(fields.items())),
        sampled=kind == "sampled_distribution",
    )


_definitions = {
    name: _definition(name, kind, unit, labels)
    for name, (kind, unit, labels) in METRIC_SPECS.items()
}
for _tool in MCP_TOOLS:
    for _suffix, _kind, _unit in (
        ("latency_ms", "distribution", "milliseconds"),
        ("response_bytes", "distribution", "bytes"),
        *((outcome, "counter_delta", "1") for outcome in MCP_OUTCOMES),
    ):
        _name = f"mcp.tool.{_tool}.{_suffix}"
        _definitions[_name] = _definition(_name, _kind, _unit, {})
for _outcome in MCP_OUTCOMES:
    _name = f"mcp.tool.{_outcome}"
    _definitions[_name] = _definition(_name, "counter_delta", "1", {})
METRIC_CATALOG = MappingProxyType(_definitions)


def get_metric_definition(name: str) -> MetricDefinition:
    canonical_name = _ALIASES.get(name, name)
    try:
        return METRIC_CATALOG[canonical_name]
    except KeyError:
        raise ValueError("Metric is not configured in the catalogue") from None


def canonical_metric(name: str, tags: dict | None = None) -> MetricSeries:
    definition = get_metric_definition(name)
    fields = dict(definition.labels)
    canonical: dict[str, str] = {}
    normalized = 0
    for key, raw_value in (tags or {}).items():
        registry = METRIC_SPECS.get(definition.name, (None, None, {}))[2].get(key)
        label = _label_name(str(key), registry or "")
        if label not in fields:
            normalized += 1
            continue
        value = str(raw_value)
        if label == "target" and value == "subsonic":
            value = "opensubsonic"
        if label == "method":
            value = value.upper()
        elif label == "route":
            value = _PARAMETER.sub(":param", value)
        elif label == "status_class" and value.isdigit():
            code = int(value)
            value = f"{code // 100}xx" if 100 <= code < 600 else "other"
        if value not in fields[label]:
            value = "other"
            normalized += 1
        if label in canonical and canonical[label] != value:
            canonical[label] = "other"
            normalized += 1
        else:
            canonical[label] = value
    items = tuple(sorted(canonical.items()))
    tags_json = json.dumps(dict(items), sort_keys=True, separators=(",", ":"))
    series_id = hashlib.sha256(f"{definition.name}\0{tags_json}".encode()).hexdigest()
    return MetricSeries(definition, items, tags_json, series_id, normalized)


__all__ = [
    "METRIC_CATALOG",
    "MetricDefinition",
    "MetricSeries",
    "canonical_metric",
    "get_metric_definition",
]
