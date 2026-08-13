from __future__ import annotations


def test_warm_recent_home_discovery_snapshots_isolates_user_failures(monkeypatch):
    from crate.db import home, home_warming

    recent_calls = []
    snapshot_calls = []

    def list_recent(*, window_minutes: int, limit: int) -> list[int]:
        recent_calls.append((window_minutes, limit))
        return [7, 9, 11]

    def refresh_snapshot(user_id: int, *, fresh: bool = False) -> dict:
        snapshot_calls.append((user_id, fresh))
        if user_id == 9:
            raise RuntimeError("snapshot unavailable")
        return {}

    monkeypatch.setattr(home_warming, "list_recent_home_user_ids", list_recent)
    monkeypatch.setattr(home, "get_cached_home_discovery", refresh_snapshot)

    warmed = home_warming.warm_recent_home_discovery_snapshots(
        window_minutes=45, limit=12
    )

    assert recent_calls == [(45, 12)]
    assert snapshot_calls == [(7, True), (9, True), (11, True)]
    assert warmed == 2
