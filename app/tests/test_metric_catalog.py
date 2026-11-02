from __future__ import annotations

import pytest

from crate.observability.metric_catalog import (
    METRIC_CATALOG,
    canonical_metric,
    get_metric_definition,
)


@pytest.mark.parametrize(
    ("name", "input_unit", "unit", "scale"),
    [
        ("mcp.tool.latency_ms", "milliseconds", "seconds", 0.001),
        ("mcp.tool.response_bytes", "bytes", "bytes", 1.0),
    ],
)
def test_global_mcp_metrics_have_explicit_catalogue_definitions(
    name, input_unit, unit, scale
):
    definition = get_metric_definition(name)

    assert definition.name == name
    assert definition.kind == "histogram"
    assert definition.input_unit == input_unit
    assert definition.unit == unit
    assert definition.scale == scale


@pytest.mark.parametrize(
    "name",
    ["unregistered.user.supplied.metric", "mcp.tool.unregistered_tool.latency_ms"],
)
def test_unknown_names_are_rejected_without_extending_the_catalogue(name):
    size_before = len(METRIC_CATALOG)

    with pytest.raises(ValueError):
        get_metric_definition(name)

    assert len(METRIC_CATALOG) == size_before


@pytest.mark.parametrize(
    ("legacy", "canonical"),
    [
        ("api.latency", "api.request.latency"),
        ("api.requests", "api.request.count"),
        ("api.errors", "api.request.errors"),
        ("api.slow", "api.request.slow"),
    ],
)
def test_legacy_alias_and_canonical_name_resolve_to_the_same_series(legacy, canonical):
    alias = canonical_metric(legacy, {"method": "GET"})
    direct = canonical_metric(canonical, {"method": "GET"})

    assert alias.definition.name == canonical
    assert alias.definition == direct.definition
    assert alias.series_id == direct.series_id
    assert alias.tags_json == direct.tags_json


@pytest.mark.parametrize(
    ("name", "input_unit", "scale", "sample", "seconds"),
    [
        ("media_worker.package.duration", "milliseconds", 0.001, 1500.0, 1.5),
        ("worker.queue.wait", "seconds", 1.0, 2.5, 2.5),
    ],
)
def test_duration_units_come_from_the_definition_not_the_metric_name(
    name, input_unit, scale, sample, seconds
):
    definition = get_metric_definition(name)

    assert definition.kind == "histogram"
    assert definition.input_unit == input_unit
    assert definition.unit == "seconds"
    assert definition.scale == scale
    assert sample * definition.scale == pytest.approx(seconds)


@pytest.mark.parametrize(
    ("path", "target", "route"),
    [
        ("/api/artists/{artist_id}/radio", "api", "/api/artists/:param/radio"),
        ("/api/playback/qoe", "api", "/api/playback/qoe"),
        ("/rest/getSong", "opensubsonic", "/rest/getSong"),
    ],
)
def test_http_metric_identity_preserves_registered_route_templates(path, target, route):
    series = canonical_metric(
        "api.route.latency", {"method": "GET", "path": path, "target": target}
    )

    assert dict(series.tags)["route"] == route
    assert dict(series.tags)["target"] == target


def test_http_metric_identity_never_persists_free_artist_slugs():
    raw_path = "/api/artists/SENSITIVE_SLUG/radio"

    series = canonical_metric("api.route.latency", {"path": raw_path, "target": "api"})

    assert dict(series.tags)["route"] == "other"
    assert raw_path not in series.tags_json
    assert "SENSITIVE_SLUG" not in series.tags_json
