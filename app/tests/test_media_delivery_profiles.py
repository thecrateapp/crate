from __future__ import annotations

import sys
from pathlib import Path


LOAD_DIR = Path(__file__).parent / "load"
sys.path.insert(0, str(LOAD_DIR))

from artwork_delivery_profile import artwork_slo_failures  # noqa: E402
from local_stream_delivery_profile import local_stream_slo_failures  # noqa: E402
from media_profile_common import percentile  # noqa: E402


def test_media_profile_percentile_is_stable():
    assert percentile([4, 1, 3, 2], 0.5) == 3
    assert percentile([4, 1, 3, 2], 0.95) == 4
    assert percentile([], 0.95) == 0


def test_artwork_slo_requires_all_successes_and_bounded_warm_ttfb():
    assert (
        artwork_slo_failures(
            {"warm": {"statuses": {"200": 10}, "ttfb_p95_ms": 49.9}}, 10
        )
        == []
    )
    assert (
        len(
            artwork_slo_failures(
                {"warm": {"statuses": {"200": 9, "503": 1}, "ttfb_p95_ms": 51}},
                10,
            )
        )
        == 2
    )


def test_local_stream_slo_requires_contract_speed_and_throughput():
    report = {
        "fastapi": {
            "statuses": {"206": 10},
            "bytes_total": 1000,
            "throughput_bytes_per_second": 1000,
            "ttfb_p95_ms": 100,
        },
        "readplane": {
            "statuses": {"206": 10},
            "bytes_total": 1000,
            "throughput_bytes_per_second": 1100,
            "ttfb_p95_ms": 80,
        },
    }

    assert local_stream_slo_failures(report, 10) == []

    report["readplane"]["bytes_total"] = 999
    report["readplane"]["throughput_bytes_per_second"] = 900
    report["readplane"]["ttfb_p95_ms"] = 81
    assert len(local_stream_slo_failures(report, 10)) == 3


def test_readplane_race_tests_use_a_cgo_capable_image():
    workflow = (
        Path(__file__).parents[2] / ".github/workflows/test-readplane.yml"
    ).read_text()
    race_step = workflow.split("- name: Native media race tests", maxsplit=1)[1]
    race_step = race_step.split("- name:", maxsplit=1)[0]

    assert "golang:1.23-alpine" not in race_step
    assert "golang:1.23" in race_step
    assert "go test -race" in race_step
