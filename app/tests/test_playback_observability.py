from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]


def test_playback_slos_define_windows_alerts_and_actionable_rollback():
    document = (
        ROOT / "docs/technical/09-playback-realtime-and-subsonic.md"
    ).read_text()
    for text in (
        "startup p95",
        "stall ratio",
        "range retry",
        "transcode queue wait",
        "fallback-original",
        "15 minutes",
        "rollback",
    ):
        assert text in document


def test_playback_release_gates_prohibit_sensitive_telemetry_and_document_warmup():
    document = (
        ROOT / "docs/technical/09-playback-realtime-and-subsonic.md"
    ).read_text()
    for text in (
        "raw URLs",
        "tokens",
        "CRATE_PLAYBACK_WARMUP_ENABLED",
        "5 Mbps / 150 ms",
        "reusable playback session",
    ):
        assert text in document


def test_playback_slo_local_links_resolve():
    source = ROOT / "docs/technical/09-playback-realtime-and-subsonic.md"
    for target in re.findall(r"\[[^]]+]\(([^)]+)\)", source.read_text()):
        if "://" in target:
            continue
        relative_path, _, anchor = target.partition("#")
        destination = source.parent / relative_path
        assert destination.is_file(), target
        if anchor:
            headings = {
                re.sub(r"[^a-z0-9 -]", "", line.lstrip("# ").lower()).replace(" ", "-")
                for line in destination.read_text().splitlines()
                if line.startswith("#")
            }
            assert anchor in headings, target
