from __future__ import annotations

from tests.load.federation_stream_benchmark import CaseResult


def test_benchmark_gate_requires_every_structural_budget():
    from tests.load.federation_stream_benchmark import evaluate_gate

    report = {
        "cases": {
            "remote_full_25": {
                "ttfb_p95_ms": 100,
                "throughput_mib_s": 90,
                "errors": 0,
            },
            "direct_full_25": {"throughput_mib_s": 100},
        },
        "event_loop_lag_p95_ms": 5,
        "metadata_under_load_p95_ms": 25,
        "range_ok": True,
        "disconnect_ok": True,
    }

    assert evaluate_gate(report)["passed"] is True
    report["event_loop_lag_p95_ms"] = 100
    assert evaluate_gate(report)["passed"] is False


def test_benchmark_percentile_is_nearest_rank():
    from tests.load.federation_stream_benchmark import percentile

    assert percentile([1, 2, 3, 4, 100], 0.95) == 100
    assert percentile([], 0.95) == 0


def test_benchmark_aggregate_uses_median_and_preserves_all_errors():
    from tests.load.federation_stream_benchmark import aggregate_case_results

    samples = [
        CaseResult("remote_full_25", 25, 25, 100, 0, 10, 20, 30, 900),
        CaseResult("remote_full_25", 25, 25, 100, 1, 12, 25, 35, 300),
        CaseResult("remote_full_25", 25, 25, 100, 0, 11, 22, 32, 850),
    ]

    result = aggregate_case_results("remote_full_25", samples)

    assert result.requests == 75
    assert result.bytes_received == 300
    assert result.errors == 1
    assert result.ttfb_p95_ms == 22
    assert result.throughput_mib_s == 850
