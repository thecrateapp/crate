from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import text

from tests.conftest import approve_federation_node


@pytest.fixture
def sync_worker(monkeypatch):
    from crate.worker_handlers import federation

    state = SimpleNamespace(paths=[], responses=[], batches=[], cursors=[], stored={})

    class Response:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload
            self.status_code = payload.get("status_code", 200)

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def json(self):
            return self.payload

    def request(**kwargs):
        state.paths.append(kwargs["path"])
        assert state.responses, "Unexpected extra federation request"
        return Response(state.responses.pop(0))

    def apply_page(**kwargs):
        state.batches.append(kwargs)
        return {"applied": len(kwargs["items"]), "invalidated": 0}

    monkeypatch.setattr(
        federation.repo,
        "get_peer",
        lambda uid: {"node_uid": uid, "api_base_url": "https://peer.invalid"},
    )
    monkeypatch.setattr(
        federation.repo,
        "get_local_node",
        lambda: {
            "node_uid": "local",
            "active_key_id": "key",
            "private_key_ref": "unused",
        },
    )
    monkeypatch.setattr(federation.repo, "update_peer", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("crate.federation.client.federated_get", request)
    monkeypatch.setattr(
        "crate.federation.catalog.get_cursor", lambda _uid: state.stored
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_catalog_item",
        lambda **_kwargs: pytest.fail("Manifest rows must be persisted as a page"),
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation_manifest_import.apply_federation_manifest_page",
        apply_page,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.save_catalog_sync_checkpoint",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.upsert_cursor",
        lambda uid, cursor, **kwargs: state.cursors.append((uid, cursor, kwargs)),
    )
    for name in (
        "tombstone_catalog_items_missing_from_revision",
        "tombstone_catalog_items_missing_from_session",
    ):
        monkeypatch.setattr(f"crate.federation.catalog.{name}", lambda *_a, **_k: 0)
    state.errors = []
    monkeypatch.setattr(
        "crate.federation.catalog.record_catalog_sync_error",
        lambda uid, error, **kwargs: state.errors.append((uid, error, kwargs)) or True,
    )
    for name in ("emit_catalog_sync_completed", "emit_catalog_sync_failed"):
        monkeypatch.setattr(f"crate.federation.events.{name}", lambda *_a, **_k: None)
    monkeypatch.setattr(
        "crate.db.jobs.global_catalog_reconciliation.apply_federation_delta_page",
        lambda **kwargs: {"applied": len(kwargs["items"])},
    )
    state.generations = []

    def begin_session(uid):
        state.generations.append(uid)
        return len(state.generations)

    monkeypatch.setattr(
        "crate.federation.catalog.begin_catalog_sync_session", begin_session
    )
    state.run = lambda **params: federation._sync_single_peer_catalog("peer", params)
    return state


def _manifest(*, revision="r1", uid="track-a", has_more=False, **kwargs):
    return {
        "revision": revision,
        "items": [{"entity_type": "track", "entity_uid": uid, "title": uid}],
        "has_more": has_more,
        **kwargs,
    }


def _delta(**kwargs):
    return {
        "items": [],
        "next_cursor": "delta-" + "x" * 50,
        "scanned_sequence": 17,
        "has_more": False,
        **kwargs,
    }


def test_manifest_uses_one_bulk_import_per_page_and_then_catches_up_deltas(sync_worker):
    initial_cursor = "initial-" + "x" * 50
    sync_worker.responses = [
        _manifest(
            has_more=True,
            next_cursor="page-two",
            snapshot_cursor=initial_cursor,
            snapshot_sequence=17,
        ),
        _manifest(uid="track-b", snapshot_cursor=initial_cursor, snapshot_sequence=17),
        _delta(),
    ]

    result = sync_worker.run()

    assert result["status"] == "completed"
    assert result["synced"] == 2
    assert len(sync_worker.batches) == 2
    assert all(batch["checkpoint"] for batch in sync_worker.batches)
    assert (
        sync_worker.batches[0]["sync_session_uid"]
        == sync_worker.batches[1]["sync_session_uid"]
    )
    assert "page_size=500" in sync_worker.paths[0]
    assert sync_worker.paths[-1].startswith("/api/federation/v1/catalog/delta?")
    assert parse_qs(urlsplit(sync_worker.paths[-1]).query)["cursor"] == [initial_cursor]
    assert sync_worker.cursors[0][2]["last_applied_cursor"] == 17


def test_successful_old_bootstrap_continues_with_deltas_instead_of_daily_full(
    sync_worker,
):
    sync_worker.stored = {
        "cursor": "opaque-" + "x" * 50,
        "last_full_verified_at": datetime.now(UTC) - timedelta(days=30),
    }
    sync_worker.responses = [_delta()]

    result = sync_worker.run()

    assert result["mode"] == "delta"
    assert len(sync_worker.paths) == 1
    assert "/catalog/delta?" in sync_worker.paths[0]
    assert sync_worker.batches == []


def test_force_full_remains_an_explicit_repair_operation(sync_worker):
    sync_worker.stored = {"cursor": "opaque-" + "x" * 50}
    sync_worker.responses = [_manifest()]

    result = sync_worker.run(force_full=True)

    assert result["status"] == "completed"
    assert "/catalog/manifest?" in sync_worker.paths[0]


def test_force_full_discards_an_incomplete_bootstrap_checkpoint(sync_worker):
    sync_worker.stored = {
        "cursor": json.dumps(
            {
                "status": "partial",
                "revision": "stale",
                "next_page": 9,
                "page_size": 500,
                "synced": 4500,
                "next_cursor": "stale-cursor",
            }
        )
    }
    sync_worker.responses = [_manifest()]

    result = sync_worker.run(force_full=True)

    assert result["synced"] == 1
    assert "page=0" in sync_worker.paths[0]
    assert "cursor=" not in sync_worker.paths[0]


def test_revision_restart_discards_old_cursor_and_sync_session(sync_worker):
    sync_worker.responses = [
        _manifest(has_more=True, next_cursor="stale-cursor"),
        _manifest(revision="r2", uid="must-not-apply"),
        _manifest(revision="r2", uid="fresh-start"),
    ]

    result = sync_worker.run(page_size=1)

    assert result["status"] == "completed"
    assert result["synced"] == 1
    assert "cursor=stale-cursor" in sync_worker.paths[1]
    assert "page=0" in sync_worker.paths[2]
    assert "cursor=" not in sync_worker.paths[2]
    assert (
        sync_worker.batches[0]["sync_session_uid"]
        != sync_worker.batches[1]["sync_session_uid"]
    )


def test_expired_delta_cursor_recovers_with_bootstrap(sync_worker):
    sync_worker.stored = {
        "cursor": "opaque-" + "x" * 50,
        "last_full_verified_at": datetime.now(UTC),
    }
    sync_worker.responses = [{"status_code": 410}, _manifest()]

    result = sync_worker.run()

    assert result["status"] == "completed"
    assert "/catalog/delta?" in sync_worker.paths[0]
    assert "/catalog/manifest?" in sync_worker.paths[1]


def test_delta_that_makes_no_progress_fails_instead_of_looping(sync_worker):
    cursor = "opaque-" + "x" * 50
    sync_worker.stored = {"cursor": cursor, "last_full_verified_at": datetime.now(UTC)}
    sync_worker.responses = [_delta(next_cursor=cursor, has_more=True)]

    result = sync_worker.run()

    assert result["status"] == "failed"
    assert "progress" in result["error"]
    assert len(sync_worker.paths) == 1


@pytest.mark.parametrize(
    "delta_age,expected", [(timedelta(minutes=1), False), (timedelta(days=2), True)]
)
def test_peer_freshness_uses_delta_heartbeat_not_last_full_scan(
    monkeypatch, delta_age, expected
):
    from crate.db.repositories import federation_catalog

    now = datetime.now(UTC)
    monkeypatch.setattr(
        federation_catalog,
        "get_cursor",
        lambda _uid: {
            "full_sync_completed_at": now - timedelta(days=30),
            "last_delta_at": now - delta_age,
        },
    )
    assert federation_catalog.is_catalog_stale("peer") is expected


def test_unchanged_rows_stay_available_after_an_empty_delta_heartbeat(pg_db):
    from uuid import uuid4

    from crate.db.jobs.global_catalog_reconciliation import apply_federation_delta_page
    from crate.db.queries.global_catalog_sources import iter_remote_sources
    from crate.db.repositories.federation_catalog import is_catalog_stale
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope, transaction_scope

    from crate.db.repositories.federation_catalog_fence import (
        begin_catalog_sync_session,
        declare_catalog_maintenance_write,
    )

    del pg_db
    node_uid = str(uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    generation = begin_catalog_sync_session(node_uid)
    apply_federation_manifest_page(
        node_uid=node_uid,
        revision="r1",
        sync_session_uid=str(uuid4()),
        sync_generation=generation,
        items=[
            {
                "entity_type": "artist",
                "entity_uid": "unchanged",
                "title": "Unchanged Artist",
            }
        ],
        checkpoint={"next_page": 1, "page_size": 500, "synced": 1},
    )
    with transaction_scope() as session:
        # Age the rows and the checkpoint as an operator repair would.
        declare_catalog_maintenance_write(session)
        session.execute(
            text(
                "UPDATE federation_catalog_items SET indexed_at = NOW() - INTERVAL '30 days' WHERE node_uid = CAST(:uid AS uuid)"
            ),
            {"uid": node_uid},
        )
        session.execute(
            text(
                "UPDATE federation_catalog_cursors SET full_sync_completed_at = NOW() - INTERVAL '30 days', last_delta_at = NOW() - INTERVAL '30 days' WHERE node_uid = CAST(:uid AS uuid)"
            ),
            {"uid": node_uid},
        )
    with read_scope() as session:
        indexed_before = session.execute(
            text(
                "SELECT indexed_at FROM federation_catalog_items WHERE node_uid = CAST(:uid AS uuid)"
            ),
            {"uid": node_uid},
        ).scalar_one()

    apply_federation_delta_page(
        node_uid=node_uid,
        items=[],
        next_cursor="current-delta",
        last_sequence=1,
        sync_generation=generation,
    )

    assert not is_catalog_stale(node_uid)
    assert [
        row["remote_entity_uid"] for row in iter_remote_sources(node_uid=node_uid)
    ] == ["unchanged"]
    with read_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT indexed_at FROM federation_catalog_items WHERE node_uid = CAST(:uid AS uuid)"
                ),
                {"uid": node_uid},
            ).scalar_one()
            == indexed_before
        )


# ── FED-D11 fencing in the worker ──────────────────────────────────────────


def test_every_session_write_carries_the_session_generation(sync_worker, monkeypatch):
    deltas = []
    monkeypatch.setattr(
        "crate.db.jobs.global_catalog_reconciliation.apply_federation_delta_page",
        lambda **kwargs: deltas.append(kwargs) or {"applied": 0},
    )
    sync_worker.responses = [
        _manifest(snapshot_cursor="initial-" + "x" * 50, snapshot_sequence=3),
        _delta(),
    ]

    result = sync_worker.run()

    assert result["status"] == "completed"
    assert sync_worker.generations == ["peer"]
    assert [batch["sync_generation"] for batch in sync_worker.batches] == [1]
    assert [cursor[2]["sync_generation"] for cursor in sync_worker.cursors] == [1]
    assert [delta["sync_generation"] for delta in deltas] == [1]


def test_superseded_run_stops_without_tombstoning_or_checkpointing(
    sync_worker, monkeypatch
):
    from crate.federation.catalog import CatalogSyncFenced

    def superseded_page(**kwargs):
        sync_worker.batches.append(kwargs)
        if len(sync_worker.batches) == 2:
            raise CatalogSyncFenced("peer", expected_generation=1, current_generation=2)
        return {"applied": len(kwargs["items"]), "invalidated": 0}

    tombstones = []
    monkeypatch.setattr(
        "crate.db.repositories.federation_manifest_import.apply_federation_manifest_page",
        superseded_page,
    )
    monkeypatch.setattr(
        "crate.federation.catalog.tombstone_catalog_items_missing_from_session",
        lambda *args, **kwargs: tombstones.append(args) or 0,
    )
    sync_worker.responses = [
        _manifest(has_more=True, next_cursor="two", snapshot_cursor="s" * 50),
        _manifest(uid="track-b", snapshot_cursor="s" * 50),
    ]

    result = sync_worker.run()

    assert result["status"] == "fenced"
    assert "superseded" in result["error"]
    assert "generation 1" in result["error"] and "generation 2" in result["error"]
    assert tombstones == []
    assert sync_worker.cursors == []
    assert sync_worker.errors == []


def test_stale_run_failure_is_not_recorded_over_the_newer_run(sync_worker, monkeypatch):
    updates = []
    monkeypatch.setattr(
        "crate.federation.catalog.record_catalog_sync_error",
        lambda *_args, **_kwargs: False,
    )
    from crate.worker_handlers import federation

    monkeypatch.setattr(
        federation.repo, "update_peer", lambda *args, **kwargs: updates.append(kwargs)
    )
    sync_worker.responses = [{"status_code": 500}]

    result = sync_worker.run()

    assert result["status"] == "fenced"
    assert updates == []


def test_disabled_or_revoked_peer_is_skipped_before_any_request(
    sync_worker, monkeypatch
):
    from crate.federation.catalog import CatalogSyncFenced

    def refuse(uid):
        raise CatalogSyncFenced(
            uid,
            expected_generation=None,
            current_generation=None,
            reason="catalog sync for peer not started: the peer is disabled",
        )

    monkeypatch.setattr("crate.federation.catalog.begin_catalog_sync_session", refuse)

    result = sync_worker.run()

    assert result["status"] == "skipped"
    assert sync_worker.paths == []
    assert sync_worker.batches == []
