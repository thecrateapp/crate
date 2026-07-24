from __future__ import annotations

from contextlib import contextmanager


class _Result:
    rowcount = 1


class _Session:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))
        return _Result()


def test_delta_items_and_cursor_commit_in_one_transaction(monkeypatch):
    from crate.db.jobs import global_catalog_reconciliation as jobs

    session = _Session()

    @contextmanager
    def tx():
        yield session

    monkeypatch.setattr(jobs, "transaction_scope", tx)
    monkeypatch.setattr(
        "crate.db.repositories.global_catalog_dirty_sources.enqueue_federated_dirty_source",
        lambda *args, **kwargs: None,
    )

    result = jobs.apply_federation_delta_page(
        node_uid="00000000-0000-0000-0000-000000000002",
        items=[
            {
                "sequence": 21,
                "entity_type": "artist",
                "remote_entity_uid": "artist-1",
                "operation": "upsert",
                "payload_revision": "sha256:a",
                "payload": {"title": "High Vis", "artist": "High Vis"},
            },
            {
                "sequence": 22,
                "entity_type": "track",
                "remote_entity_uid": "track-1",
                "operation": "delete",
                "payload_revision": "sha256:b",
                "payload": {"deleted": True},
            },
        ],
        next_cursor="opaque-next",
    )

    assert result == {"applied": 2, "last_sequence": 22}
    assert any(
        "INSERT INTO federation_catalog_items" in sql for sql, _ in session.calls
    )
    assert any(
        "INSERT INTO federation_catalog_cursors" in sql for sql, _ in session.calls
    )
    cursor_call = next(
        params
        for sql, params in session.calls
        if "INSERT INTO federation_catalog_cursors" in sql
    )
    assert cursor_call["cursor"] == "opaque-next"
    assert cursor_call["last_sequence"] == 22


def test_duplicate_delta_page_is_idempotent(monkeypatch):
    from crate.db.jobs import global_catalog_reconciliation as jobs

    session = _Session()

    @contextmanager
    def tx():
        yield session

    monkeypatch.setattr(jobs, "transaction_scope", tx)
    monkeypatch.setattr(
        "crate.db.repositories.global_catalog_dirty_sources.enqueue_federated_dirty_source",
        lambda *args, **kwargs: None,
    )
    item = {
        "sequence": 8,
        "entity_type": "album",
        "remote_entity_uid": "album-1",
        "operation": "upsert",
        "payload_revision": "sha256:album",
        "payload": {"title": "Blending", "artist": "High Vis"},
    }

    jobs.apply_federation_delta_page(
        node_uid="00000000-0000-0000-0000-000000000002",
        items=[item],
        next_cursor="cursor-8",
    )
    jobs.apply_federation_delta_page(
        node_uid="00000000-0000-0000-0000-000000000002",
        items=[item],
        next_cursor="cursor-8",
    )

    upserts = [
        sql for sql, _ in session.calls if "INSERT INTO federation_catalog_items" in sql
    ]
    assert len(upserts) == 2
    assert all("ON CONFLICT" in sql for sql in upserts)
