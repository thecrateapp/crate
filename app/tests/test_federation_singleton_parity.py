from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "federation-dev-e2e.py"


def _load_harness():
    spec = importlib.util.spec_from_file_location("federation_dev_e2e", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_singleton_parity_mode_runs_the_single_node_acceptance(monkeypatch):
    harness = _load_harness()
    calls: list[str] = []

    monkeypatch.setattr(
        harness,
        "run_singleton_e2e",
        lambda: calls.append("singleton"),
    )
    monkeypatch.setattr(
        harness.sys,
        "argv",
        [str(SCRIPT), "singleton-parity"],
    )

    assert harness.main() == 0
    assert calls == ["singleton"]


def test_singleton_acceptance_probes_user_data_and_enrichment_contracts():
    harness = _load_harness()

    assert harness.SINGLETON_PARITY_PATHS == (
        "/api/me/follows",
        "/api/me/albums",
        "/api/me/likes",
        "/api/me/history?limit=1",
        "/api/genres/sound-intelligence/health",
    )
