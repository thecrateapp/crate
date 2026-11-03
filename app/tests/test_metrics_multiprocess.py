from __future__ import annotations

import json

import pytest

from tests.prometheus_processes import collect, record_script, run_child

pytest.importorskip("prometheus_client")

REQUEST = (
    "api.request.count",
    1.0,
    {"method": "GET", "path": "/api/status", "status": "200", "target": "api"},
)
LATENCY = (
    "api.request.latency",
    120.0,
    {"method": "GET", "path": "/api/status", "status": "200", "target": "api"},
)
COUNTER = (
    'crate_api_request_total{"latency_class": "", "method": "GET", '
    '"status_class": "2xx", "target": "api"}'
)
HISTOGRAM_COUNT = (
    'crate_api_request_latency_seconds_count{"method": "GET", '
    '"status_class": "2xx", "target": "api"}'
)


def test_two_children_add_up_in_one_scrape_and_a_restart_neither_duplicates_nor_erases(
    tmp_path,
):
    run_child(record_script(*[REQUEST, LATENCY] * 3), tmp_path)
    run_child(record_script(*[REQUEST, LATENCY] * 4), tmp_path)

    samples = collect(tmp_path)
    assert samples[COUNTER] == 7
    assert samples[HISTOGRAM_COUNT] == 7

    run_child(record_script(REQUEST, LATENCY), tmp_path)

    samples = collect(tmp_path)
    assert samples[COUNTER] == 8
    assert samples[HISTOGRAM_COUNT] == 8


def test_a_global_gauge_keeps_the_latest_observation_instead_of_summing(tmp_path):
    depth = ("worker.queue.depth", 5.0, {"queue": "default"})
    run_child(record_script(depth), tmp_path)
    run_child(
        record_script(("worker.queue.depth", 3.0, {"queue": "default"})), tmp_path
    )

    assert collect(tmp_path)['crate_worker_queue_depth{"queue": "default"}'] == 3


def test_per_process_gauges_sum_live_processes_and_drop_dead_ones(tmp_path):
    first = run_child(
        record_script(("stream.concurrent", 2.0, {}), exit_hard=True), tmp_path
    )
    run_child(record_script(("stream.concurrent", 3.0, {}), exit_hard=True), tmp_path)
    assert collect(tmp_path)["crate_stream_concurrent{}"] == 5

    run_child(
        "from prometheus_client import multiprocess\n"
        f"multiprocess.mark_process_dead({int(first.stdout)})",
        tmp_path,
    )
    assert collect(tmp_path)["crate_stream_concurrent{}"] == 3

    run_child(record_script(("stream.concurrent", 4.0, {})), tmp_path)
    assert collect(tmp_path)["crate_stream_concurrent{}"] == 3


def test_the_supervisor_resets_the_directory_once_and_children_keep_it(tmp_path):
    (tmp_path / "counter_1.db").write_bytes(b"stale")
    run_child(
        "import os\n"
        "from crate.observability.metrics_server import prepare\n"
        "print(prepare(os.environ))",
        None,
        CRATE_PROMETHEUS_METRICS="1",
        PROMETHEUS_MULTIPROC_DIR=str(tmp_path),
    )
    assert not (tmp_path / "counter_1.db").exists()

    run_child(record_script(REQUEST), tmp_path)
    run_child(record_script(REQUEST), tmp_path)

    assert collect(tmp_path)[COUNTER] == 2
    assert json.dumps(sorted(p.name for p in tmp_path.iterdir())).count("counter_") == 2
