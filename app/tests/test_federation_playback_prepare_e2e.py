from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_dev_harness_exercises_remote_prepare_then_fallback_and_ready_playback():
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    for text in (
        "def run_playback_prepare_e2e()",
        '"/api/playback/prepare"',
        "request_remote_playback_prepare",
        "wait_for_remote_playback_prepare",
        "resolve_and_probe_global_playback",
        'mode == "playback-prepare"',
    ):
        assert text in script


def test_dev_harness_exposes_the_playback_prepare_scenario_in_make():
    makefile = (ROOT / "Makefile").read_text()

    assert "federation-dev-playback-prepare-e2e:" in makefile
    assert "federation-dev-e2e.py playback-prepare" in makefile
