from __future__ import annotations

import math
import re

import pytest

from crate.observability.metric_catalog import METRIC_CATALOG
from crate.observability.prometheus import (
    BUCKETS,
    EXPORTED_FAMILIES,
    LABEL_BUDGET,
    PER_PROCESS_GAUGES,
)
from tests.prometheus_processes import collect, run_child


@pytest.mark.parametrize(
    ("source", "name", "kind"),
    [
        ("api.request.count", "crate_api_request", "counter"),
        ("api.request.latency", "crate_api_request_latency_seconds", "histogram"),
        ("playback.startup.ms", "crate_playback_startup_seconds", "histogram"),
        ("playback.stall.count", "crate_playback_stall", "counter"),
        ("stream.bytes", "crate_stream_bytes", "histogram"),
        ("stream.cache.bytes_removed", "crate_stream_cache_bytes_removed", "counter"),
        ("worker.queue.wait", "crate_worker_queue_wait_seconds", "histogram"),
        ("worker.queue.depth", "crate_worker_queue_depth", "gauge"),
        (
            "worker.resource.swap_used_mb",
            "crate_worker_resource_swap_used_bytes",
            "gauge",
        ),
        (
            "worker.resource.memory_available_percent",
            "crate_worker_resource_memory_available_ratio",
            "gauge",
        ),
    ],
)
def test_families_carry_prometheus_names_types_and_base_units(source, name, kind):
    family = EXPORTED_FAMILIES[source]

    assert (family.name, family.kind) == (name, kind)
    assert family.unit == METRIC_CATALOG[source].unit


def test_every_exported_name_is_unique_valid_and_ends_in_its_unit():
    names = [family.name for family in EXPORTED_FAMILIES.values()]

    assert len(names) == len(set(names))
    for family in EXPORTED_FAMILIES.values():
        assert re.fullmatch(r"crate_[a-z][a-z0-9_]*", family.name), family.name
        assert not family.name.endswith("_total"), family.name
        suffix = {"seconds": "_seconds", "bytes": "_bytes", "ratio": "_ratio"}.get(
            family.unit
        )
        if suffix:
            assert suffix in family.name + "_", family.name


def test_labels_are_bounded_and_carry_no_routes_or_identities():
    for family in EXPORTED_FAMILIES.values():
        catalogue = dict(METRIC_CATALOG[family.source].labels)
        assert not {"route", "service", "peer_uid", "user_id"} & set(family.labels)
        assert set(family.labels) <= set(catalogue)
        assert (
            math.prod(len(catalogue[label]) for label in family.labels) <= LABEL_BUDGET
        )


def test_histograms_use_increasing_buckets_of_their_unit():
    for family in EXPORTED_FAMILIES.values():
        if family.kind != "histogram":
            assert family.buckets is None
            continue
        assert family.buckets == BUCKETS[family.unit]
        assert list(family.buckets) == sorted(set(family.buckets))


def test_gauges_never_sum_observations_over_time():
    for family in EXPORTED_FAMILIES.values():
        if family.kind != "gauge":
            assert family.multiprocess_mode is None
        elif family.source in PER_PROCESS_GAUGES:
            assert (family.multiprocess_mode, family.labels) == ("livesum", ())
        else:
            assert family.multiprocess_mode == "mostrecent"


def test_disabled_export_imports_nothing_and_ignores_observations():
    result = run_child(
        """
        import sys
        from crate.observability import prometheus
        from crate.observability.metric_catalog import canonical_metric

        prometheus.observe(canonical_metric("api.request.count"), 1.0)
        print("prometheus_client" in sys.modules, prometheus._metrics)
        """,
        None,
    )

    assert result.stdout.split() == ["False", "{}"]


def test_counters_and_gauges_do_not_depend_on_redis(tmp_path):
    pytest.importorskip("prometheus_client")
    run_child(
        """
        import crate.db.cache_runtime
        from crate import metrics

        crate.db.cache_runtime.get_redis = lambda: None
        tags = {"method": "GET", "path": "/api/status", "status": "200"}
        metrics.record("api.request.count", 1.0, tags)
        metrics.record("api.request.count", 2.0, tags)
        metrics.record_later("api.request.count", 1.0, tags)
        metrics.record("api.request.count", -4.0, tags)
        metrics.record("worker.queue.depth", 5, {"queue": "default"})
        metrics.record("worker.queue.depth", 3, {"queue": "default"})
        metrics.record("playback.startup.ms", 250.0, {"origin": "local"})
        """,
        tmp_path,
    )

    samples = collect(tmp_path)
    assert (
        samples[
            'crate_api_request_total{"latency_class": "", "method": "GET", '
            '"status_class": "2xx", "target": ""}'
        ]
        == 4
    )
    assert samples['crate_worker_queue_depth{"queue": "default"}'] == 3
    startup = (
        '{"effective_policy": "", "engine": "", "origin": "local", '
        '"requested_policy": "", "runtime": ""}'
    )
    assert samples["crate_playback_startup_seconds_sum" + startup] == 0.25
    assert samples["crate_playback_startup_seconds_count" + startup] == 1
