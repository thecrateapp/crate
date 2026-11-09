from __future__ import annotations

import json
import subprocess
from types import SimpleNamespace

import pytest

import export_blog_fixture as exporter


def _planner_matches_pin() -> bool:
    """Whether this checkout has the fixture's pinned planner sources unchanged."""
    result = subprocess.run(
        [
            "git",
            "diff",
            "--quiet",
            exporter.PIN,
            "--",
            "app/crate/smart_mix",
            "app/tests/smart_mix_candidate_cases.py",
        ],
        cwd=exporter.REPO_ROOT,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


# The blog fixture records planner output at exporter.PIN. A shallow CI clone lacks that
# commit, and later planner work legitimately changes the output; the published fixture
# stays valid at its pin, so these checks only run where the pinned sources are present.
requires_pinned_planner = pytest.mark.skipif(
    not _planner_matches_pin(),
    reason=f"planner sources differ from {exporter.PIN} or the commit is unavailable",
)


@requires_pinned_planner
def test_generated_fixture_keeps_voice_omission_tradeoff_and_unknown_fallback():
    data = exporter.build_fixture()
    baseline, best, alternative = data["choices"]

    assert data["kind"] == "synthetic-test-fixture"
    assert baseline["metrics"]["vocalClashMs"] == 19_420
    assert baseline["metrics"]["musicLeftOut"] == {
        "outgoingUnplayedMs": 0,
        "incomingSkippedMs": 0,
    }
    assert best["metrics"]["vocalClashMs"] == 0
    assert best["metrics"]["musicLeftOut"]["outgoingUnplayedMs"] == 92_160
    assert alternative["metrics"]["musicLeftOut"] == {
        "outgoingUnplayedMs": 15_360,
        "incomingSkippedMs": 30_720,
    }
    for choice in [*data["choices"], data["fallback"]]:
        assert choice["metrics"]["policyViolations"] == []
        assert (
            choice["geometry"]["outgoingEndMs"]
            <= data["tracks"]["outgoing"]["activeEndMs"]
        )
        assert (
            choice["geometry"]["incomingEndMs"]
            <= data["tracks"]["incoming"]["activeEndMs"]
        )
    assert data["fallback"]["plan"] == baseline["plan"]
    assert data["fallback"]["metrics"]["vocalClashMs"] is None
    assert data["fallback"]["metrics"]["phraseAlignment"]["basis"] == "grid"


@requires_pinned_planner
def test_export_and_check_detect_stale_fixture_without_overwriting(tmp_path):
    target = tmp_path / "fixture.json"
    assert exporter.main(["--output", str(target)]) == 0
    assert exporter.main(["--check", "--output", str(target)]) == 0
    data = json.loads(target.read_text())
    data["fallback"]["metrics"]["vocalClashMs"] = 0
    target.write_text(json.dumps(data))
    before = target.read_bytes()
    with pytest.raises(SystemExit) as failure:
        exporter.main(["--check", "--output", str(target)])
    assert failure.value.code == 1
    assert target.read_bytes() == before


def test_source_drift_refuses_export(tmp_path, monkeypatch):
    target = tmp_path / "fixture.json"
    monkeypatch.setattr(
        exporter.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1)
    )
    with pytest.raises(SystemExit) as failure:
        exporter.main(["--output", str(target)])
    assert failure.value.code == 1
    assert not target.exists()
