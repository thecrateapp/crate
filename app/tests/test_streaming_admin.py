from __future__ import annotations

from contextlib import contextmanager


def test_playback_delivery_snapshot_separates_pending_variant_states(monkeypatch):
    from crate.db.queries import streaming_admin

    variant_stats = {
        "variants": 9,
        "variant_tracks": 4,
        "ready": 2,
        "pending": 6,
        "pending_active": 1,
        "pending_unassigned": 2,
        "pending_stale": 3,
        "running": 0,
        "failed": 1,
        "missing": 0,
        "ready_tracks": 2,
        "cached_bytes": 100,
        "ready_source_bytes": 200,
        "avg_prepare_seconds": 1.5,
    }
    executed: list[str] = []

    class Result:
        def __init__(self, row=None, rows=None):
            self.row = row
            self.rows = rows or []

        def mappings(self):
            return self

        def first(self):
            return self.row

        def all(self):
            return self.rows

    class Session:
        def execute(self, statement, _params=None):
            query = str(statement)
            executed.append(query)
            if len(executed) == 1:
                return Result(variant_stats)
            if len(executed) == 2:
                return Result(
                    {
                        "tracks": 4,
                        "lossless_tracks": 4,
                        "hires_tracks": 0,
                    }
                )
            return Result(rows=[])

    @contextmanager
    def scope():
        yield Session()

    monkeypatch.setattr(streaming_admin, "read_scope", scope)

    snapshot = streaming_admin.get_playback_delivery_snapshot(limit=8)

    assert snapshot["stats"]["pending"] == 6
    assert snapshot["stats"]["pending_active"] == 1
    assert snapshot["stats"]["pending_unassigned"] == 2
    assert snapshot["stats"]["pending_stale"] == 3
    assert "LEFT JOIN tasks" in executed[0]
    assert "pending_active" in executed[0]
    assert "pending_stale" in executed[0]


def test_mark_variant_missing_detaches_previous_task(monkeypatch):
    from crate.db.repositories import streaming

    executed: list[str] = []

    class Session:
        def execute(self, statement, _params):
            executed.append(str(statement))

    @contextmanager
    def scope():
        yield Session()

    monkeypatch.setattr(streaming, "transaction_scope", scope)

    streaming.mark_variant_missing("cache-key")

    assert "task_id = NULL" in executed[0]
