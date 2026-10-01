from __future__ import annotations

import pytest
from capture_windows_offline_perf import (
    _latest_progress_summary,
    _probe_started,
    make_tauri_config,
    validate_measurement_report,
)

REVISION = "a" * 40


def _sample_stats(command: str | None = None, count: int = 0) -> dict:
    return {
        "commands": {command: count} if command else {},
        "indexWriteCalls": count,
        "indexWriteBytes": count * 12,
    }


def _valid_report() -> dict:
    hydration = [
        {
            "assets": count,
            "samples": [
                {
                    "hydratedEntries": count,
                    "firstPassStats": _sample_stats("reconcile_offline_media", 1),
                    "warmPassStats": _sample_stats(),
                }
                for _ in range(3)
            ],
        }
        for count in (100, 1_000, 5_000)
    ]
    verification = {
        "batches": [
            {
                "assets": count,
                "expectedIpcBatches": (count + 499) // 500,
                "validAssets": [count] * 3,
                "samples": [
                    {
                        "validAssets": count,
                        "stats": _sample_stats(
                            "verify_offline_media_assets", (count + 499) // 500
                        ),
                    }
                    for _ in range(3)
                ],
            }
            for count in (100, 1_000, 5_000)
        ],
        "twoCallers": {"samples": [{"validConcurrent": 2_000} for _ in range(3)]},
    }
    index_writes = {
        "serialControl": {
            "samples": [
                {"durableEntries": 100, "stats": _sample_stats(count=100)}
                for _ in range(3)
            ]
        },
        "batched": [
            {
                "mutations": count,
                "samples": [
                    {
                        "durableEntries": count,
                        "stats": _sample_stats(count=1),
                    }
                    for _ in range(3)
                ],
            }
            for count in (100, 1_000, 5_000)
        ],
    }
    return {
        "event": "native-performance-results",
        "revision": REVISION,
        "host": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "hydration": hydration,
        "verification": verification,
        "indexWrites": index_writes,
        "pairwiseIndexWrites": {
            "commitsPerRun": 500,
            "samples": [
                {
                    "durableEntries": 1_000,
                    "stats": _sample_stats(count=500),
                }
                for _ in range(3)
            ],
        },
    }


def test_tauri_config_uses_isolated_identifier_and_exact_revision() -> None:
    config = make_tauri_config(
        REVISION, 18_765, "app.cratemusic.crate.desktop.nativeperf.run123"
    )

    assert config["identifier"].endswith("nativeperf.run123")
    assert config["build"]["devUrl"] == (
        "http://127.0.0.1:5178/scripts/native-perf/probe.html"
        f"?port=18765&revision={REVISION}"
    )


def test_measurement_validator_accepts_complete_correct_windows_capture() -> None:
    validate_measurement_report(_valid_report(), REVISION)


def test_measurement_validator_rejects_missing_durable_write_telemetry() -> None:
    report = _valid_report()
    report["indexWrites"]["batched"][1]["samples"][0]["stats"]["indexWriteCalls"] = 0

    with pytest.raises(ValueError, match="expected one durable snapshot write"):
        validate_measurement_report(report, REVISION)


def test_measurement_validator_rejects_incomplete_file_verification() -> None:
    report = _valid_report()
    report["verification"]["batches"][2]["validAssets"] = [5_000, 4_999, 5_000]

    with pytest.raises(ValueError, match="one or more files failed validation"):
        validate_measurement_report(report, REVISION)


def test_probe_start_marker_is_detected_before_measurement_results() -> None:
    events = [
        {
            "event": "native-performance-progress",
            "phase": "probe",
            "status": "started",
        }
    ]

    assert _probe_started(events)
    assert _latest_progress_summary(events) == "probe/started"


def test_latest_progress_reports_the_last_completed_phase() -> None:
    events = [
        {
            "event": "native-performance-progress",
            "phase": "probe",
            "status": "started",
        },
        {
            "event": "native-performance-progress",
            "phase": "index-writes",
            "status": "started",
        },
    ]

    assert _latest_progress_summary(events) == "index-writes/started"
    assert not _probe_started([])
    assert _latest_progress_summary([]) == "none received"
