from __future__ import annotations

import pytest


@pytest.fixture
def smart_mix_on(monkeypatch):
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.delenv("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED", raising=False)


def _structure_snapshot(monkeypatch, percent: float | None) -> list[str]:
    from crate.api import capabilities

    reads: list[str] = []

    def fake_percent() -> float | None:
        reads.append("snapshot")
        return percent

    monkeypatch.setattr(capabilities, "get_smart_mix_structure_percent", fake_percent)
    return reads


def test_planner_versions_listed(test_app, monkeypatch, smart_mix_on) -> None:
    _structure_snapshot(monkeypatch, None)

    smart_mix = test_app.get("/api/capabilities").json()["smart_mix"]

    assert smart_mix["planner_versions"] == ["smart-mix-v2", "smart-mix-v3"]
    # The default planner and the VirtualDJ contract stay on v2.
    assert smart_mix["planner_version"] == "smart-mix-v2"


def test_no_planner_versions_while_smart_mix_is_off(test_app, monkeypatch) -> None:
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    reads = _structure_snapshot(monkeypatch, 100.0)

    smart_mix = test_app.get("/api/capabilities").json()["smart_mix"]

    assert smart_mix["planner_versions"] == []
    assert smart_mix["structure"] is False
    assert reads == []


@pytest.mark.parametrize(
    ("percent", "expected"),
    [(None, False), (0.0, False), (49.9, False), (50.0, True), (82.0, True)],
)
def test_structure_flag_from_coverage_snapshot(
    test_app, monkeypatch, smart_mix_on, percent, expected
) -> None:
    from crate.db.jobs import smart_mix_backfill

    reads = _structure_snapshot(monkeypatch, percent)
    monkeypatch.setattr(
        smart_mix_backfill,
        "refresh_smart_mix_coverage",
        lambda **_kwargs: pytest.fail("capabilities must not compute coverage"),
    )

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json()["smart_mix"]["structure"] is expected
    assert reads == ["snapshot"]


def test_structure_flag_survives_an_unreadable_snapshot(
    test_app, monkeypatch, smart_mix_on
) -> None:
    from crate.api import capabilities

    def broken() -> float | None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(capabilities, "get_smart_mix_structure_percent", broken)

    response = test_app.get("/api/capabilities")

    assert response.status_code == 200
    assert response.json()["smart_mix"]["structure"] is False


def test_structure_percent_reads_the_current_snapshot(monkeypatch) -> None:
    from crate.db.queries import smart_mix_admin

    snapshots = {
        "smart_mix:coverage": {
            "analyzer_version": smart_mix_admin.SMART_MIX_ANALYZER_VERSION,
            "profile_version": smart_mix_admin.SMART_MIX_PROFILE_VERSION,
            "structure_percent": 61.5,
        }
    }
    monkeypatch.setattr(
        smart_mix_admin, "get_ops_runtime_state", lambda key: snapshots.get(key)
    )
    assert smart_mix_admin.get_smart_mix_structure_percent() == 61.5

    snapshots["smart_mix:coverage"]["analyzer_version"] = "smart-mix-audio-v6"
    assert smart_mix_admin.get_smart_mix_structure_percent() is None
    snapshots.clear()
    assert smart_mix_admin.get_smart_mix_structure_percent() is None


def test_listen_planner_defaults_to_v2(test_app, monkeypatch, smart_mix_on) -> None:
    _structure_snapshot(monkeypatch, None)
    monkeypatch.delenv("CRATE_LISTEN_SMART_MIX_V3_ENABLED", raising=False)

    smart_mix = test_app.get("/api/capabilities").json()["smart_mix"]

    assert smart_mix["listen_planner_version"] == "smart-mix-v2"


def test_listen_planner_v3_behind_the_switch(
    test_app, monkeypatch, smart_mix_on
) -> None:
    _structure_snapshot(monkeypatch, None)
    monkeypatch.setenv("CRATE_LISTEN_SMART_MIX_V3_ENABLED", "true")

    body = test_app.get("/api/capabilities").json()

    assert body["smart_mix"]["listen_planner_version"] == "smart-mix-v3"
    assert "smart-mix-v3" in body["smart_mix"]["planner_versions"]
    # Older APKs and VirtualDJ read these two: they never move (LV-D3).
    assert body["smart_mix"]["planner_version"] == "smart-mix-v2"
    assert body["vdj"]["planner_version"] == "smart-mix-v2"


def test_no_listen_planner_while_smart_mix_is_off(test_app, monkeypatch) -> None:
    _structure_snapshot(monkeypatch, None)
    monkeypatch.delenv("CRATE_SMART_MIX_ENABLED", raising=False)
    monkeypatch.setenv("CRATE_LISTEN_SMART_MIX_V3_ENABLED", "true")

    smart_mix = test_app.get("/api/capabilities").json()["smart_mix"]

    assert smart_mix["listen_planner_version"] is None
