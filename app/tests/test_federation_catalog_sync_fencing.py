"""Fencing of concurrent federation catalog sync sessions (FED-D11, P1).

A sync session takes a per-peer ``sync_generation`` when it starts. Every page,
tombstone and checkpoint write re-checks it under the cursor row lock, so a
stale session aborts instead of deleting a newer session's rows or moving its
checkpoint back. Peer disable and revocation bump the generation in the same
transaction, and a database guard fences writers that predate the fence.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import approve_federation_node


@pytest.fixture
def peer(pg_db, monkeypatch):
    from crate.db.repositories import tasks_mutations, tasks_shared
    from crate.db.tx import transaction_scope

    del pg_db
    monkeypatch.setattr(tasks_mutations, "dispatch_task", lambda *_args: None)
    monkeypatch.setattr(tasks_shared, "publish_tasks_surface_signal", lambda: None)
    node_uid = str(uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    return node_uid


def _page(node_uid, generation, session_uid, *uids, revision="r", next_page=1):
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )

    return apply_federation_manifest_page(
        node_uid=node_uid,
        revision=revision,
        sync_session_uid=session_uid,
        sync_generation=generation,
        items=[
            {"entity_type": "artist", "entity_uid": uid, "title": f"{uid} {revision}"}
            for uid in uids
        ],
        checkpoint={
            "next_page": next_page,
            "page_size": 500,
            "synced": next_page,
            "next_cursor": f"{session_uid}:{next_page}",
        },
    )


def _rows(node_uid):
    from crate.db.tx import read_scope

    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT remote_entity_uid, title, deleted_at "
                    "FROM federation_catalog_items "
                    "WHERE node_uid = CAST(:uid AS uuid) ORDER BY remote_entity_uid"
                ),
                {"uid": node_uid},
            ).mappings()
        ]


def _cursor(node_uid):
    from crate.db.repositories.federation_catalog import get_cursor

    return get_cursor(node_uid)


def _checkpoint(node_uid):
    return json.loads(_cursor(node_uid)["cursor"])


def test_stale_full_sync_cannot_delete_a_newer_sessions_catalog(peer):
    """The P1 reproduction: the stale session resumes after a newer page."""
    from crate.db.repositories.federation_catalog import (
        tombstone_catalog_items_missing_from_revision,
        tombstone_catalog_items_missing_from_session,
        upsert_cursor,
    )
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )

    old_session, new_session = str(uuid4()), str(uuid4())
    old_generation = begin_catalog_sync_session(peer)
    _page(peer, old_generation, old_session, "shared", revision="old")
    new_generation = begin_catalog_sync_session(peer)
    assert new_generation == old_generation + 1
    _page(peer, new_generation, new_session, "shared", "new-item", revision="new")
    expected_cursor = _cursor(peer)["cursor"]

    with pytest.raises(CatalogSyncFenced, match="superseded"):
        tombstone_catalog_items_missing_from_session(
            peer, old_session, sync_generation=old_generation
        )
    with pytest.raises(CatalogSyncFenced):
        tombstone_catalog_items_missing_from_revision(
            peer, "old", sync_generation=old_generation
        )
    with pytest.raises(CatalogSyncFenced):
        upsert_cursor(peer, "stale-old-cursor", sync_generation=old_generation)

    rows = _rows(peer)
    assert [row["title"] for row in rows] == ["new-item new", "shared new"]
    assert [row["deleted_at"] for row in rows] == [None, None]
    assert _cursor(peer)["cursor"] == expected_cursor
    assert json.loads(expected_cursor)["sync_session_uid"] == new_session


def test_stale_page_written_after_a_newer_session_started_is_rejected(peer):
    """Interleaving 1: the newer session starts first, the stale page lands later."""
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )

    old_session, new_session = str(uuid4()), str(uuid4())
    old_generation = begin_catalog_sync_session(peer)
    new_generation = begin_catalog_sync_session(peer)
    _page(peer, new_generation, new_session, "a", revision="new", next_page=3)

    with pytest.raises(CatalogSyncFenced) as fenced:
        _page(peer, old_generation, old_session, "a", "stale", revision="old")

    assert fenced.value.expected_generation == old_generation
    assert fenced.value.current_generation == new_generation
    assert [row["title"] for row in _rows(peer)] == ["a new"]
    assert _checkpoint(peer)["next_page"] == 3
    assert _checkpoint(peer)["sync_session_uid"] == new_session


def test_newer_session_waits_for_an_in_flight_stale_page_then_fences_it(peer):
    """Interleaving 2: the stale page holds the lock while the newer session starts."""
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import transaction_scope

    old_session, new_session = str(uuid4()), str(uuid4())
    old_generation = begin_catalog_sync_session(peer)
    page_locked, release_page = Event(), Event()

    def stale_page():
        with transaction_scope() as session:
            apply_federation_manifest_page(
                node_uid=peer,
                revision="old",
                sync_session_uid=old_session,
                sync_generation=old_generation,
                items=[{"entity_type": "artist", "entity_uid": "a", "title": "old"}],
                checkpoint={"next_page": 1, "page_size": 500, "synced": 1},
                session=session,
            )
            page_locked.set()
            assert release_page.wait(10)

    with ThreadPoolExecutor(max_workers=2) as pool:
        stale = pool.submit(stale_page)
        assert page_locked.wait(10)
        starting = pool.submit(begin_catalog_sync_session, peer)
        with pytest.raises(TimeoutError):
            starting.result(timeout=0.5)
        release_page.set()
        stale.result(timeout=10)
        new_generation = starting.result(timeout=10)

    assert new_generation == old_generation + 1
    with pytest.raises(CatalogSyncFenced):
        _page(peer, old_generation, old_session, "b", revision="old", next_page=2)
    _page(peer, new_generation, new_session, "a", revision="new")
    assert [row["title"] for row in _rows(peer)] == ["a new"]
    assert _checkpoint(peer)["sync_session_uid"] == new_session


def test_restart_mid_page_resumes_without_moving_the_checkpoint_back(peer):
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import transaction_scope

    session_uid = str(uuid4())
    first_worker = begin_catalog_sync_session(peer)
    _page(peer, first_worker, session_uid, "p0", next_page=1)

    class WorkerKilled(Exception):
        pass

    # The worker dies after writing page 1's rows but before its commit.
    with pytest.raises(WorkerKilled), transaction_scope() as session:
        apply_federation_manifest_page(
            node_uid=peer,
            revision="r",
            sync_session_uid=session_uid,
            sync_generation=first_worker,
            items=[{"entity_type": "artist", "entity_uid": "p1", "title": "p1"}],
            checkpoint={"next_page": 2, "page_size": 500, "synced": 2},
            session=session,
        )
        raise WorkerKilled
    assert [row["remote_entity_uid"] for row in _rows(peer)] == ["p0"]
    assert _checkpoint(peer)["next_page"] == 1

    # The retried task resumes the same session from the stored checkpoint.
    restarted = begin_catalog_sync_session(peer)
    _page(peer, restarted, session_uid, "p1", next_page=2)
    _page(peer, restarted, session_uid, "p2", next_page=3)

    # A zombie of the first worker cannot replay page 1 over the resumed session,
    with pytest.raises(CatalogSyncFenced):
        _page(peer, first_worker, session_uid, "p1", next_page=2)
    # and a replayed page of the current session never moves the checkpoint back.
    _page(peer, restarted, session_uid, "p1", next_page=2)

    assert _checkpoint(peer)["next_page"] == 3
    assert [row["remote_entity_uid"] for row in _rows(peer)] == ["p0", "p1", "p2"]


def test_delta_checkpoint_only_moves_forward_and_is_fenced(peer):
    from crate.db.jobs.global_catalog_reconciliation import apply_federation_delta_page
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )

    def delta(generation, cursor, sequence):
        return apply_federation_delta_page(
            node_uid=peer,
            items=[],
            next_cursor=cursor,
            last_sequence=sequence,
            sync_generation=generation,
        )

    old_generation = begin_catalog_sync_session(peer)
    delta(old_generation, "cursor-20", 20)
    new_generation = begin_catalog_sync_session(peer)
    delta(new_generation, "cursor-30", 30)
    delta(new_generation, "cursor-25", 25)
    with pytest.raises(CatalogSyncFenced):
        delta(old_generation, "cursor-40", 40)

    cursor = _cursor(peer)
    assert cursor["cursor"] == "cursor-30"
    assert cursor["last_applied_cursor"] == 30


def test_stale_session_cannot_record_an_error_backoff_for_the_newer_one(peer):
    from crate.db.repositories.federation_catalog import record_catalog_sync_error
    from crate.db.repositories.federation_catalog_fence import (
        begin_catalog_sync_session,
    )

    old_generation = begin_catalog_sync_session(peer)
    new_generation = begin_catalog_sync_session(peer)

    assert not record_catalog_sync_error(
        peer, "stale failure", sync_generation=old_generation
    )
    assert _cursor(peer)["last_error"] is None
    assert record_catalog_sync_error(
        peer, "current failure", sync_generation=new_generation
    )
    assert _cursor(peer)["last_error"] == "current failure"


@pytest.mark.parametrize(
    "revoke",
    [
        pytest.param(lambda repo, uid: repo.disable_peer(uid), id="disable"),
        pytest.param(
            lambda repo, uid: repo.update_peer(uid, trust_state="pending"),
            id="trust-revoked",
        ),
    ],
)
def test_revocation_during_a_bootstrap_fences_the_running_session(peer, revoke):
    from crate.db.repositories import federation as repo
    from crate.db.repositories.federation_catalog import (
        tombstone_catalog_items_missing_from_session,
        upsert_cursor,
    )
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )

    session_uid = str(uuid4())
    generation = begin_catalog_sync_session(peer)
    _page(peer, generation, session_uid, "a")

    revoke(repo, peer)

    assert _cursor(peer)["sync_generation"] == generation + 1
    with pytest.raises(CatalogSyncFenced):
        _page(peer, generation, session_uid, "b", next_page=2)
    with pytest.raises(CatalogSyncFenced):
        tombstone_catalog_items_missing_from_session(
            peer, session_uid, sync_generation=generation
        )
    with pytest.raises(CatalogSyncFenced):
        upsert_cursor(peer, "done", sync_generation=generation)
    with pytest.raises(CatalogSyncFenced, match="not approved"):
        begin_catalog_sync_session(peer)
    assert [row["remote_entity_uid"] for row in _rows(peer)] == ["a"]


def test_admin_disable_is_never_rejected_by_the_fence_while_a_page_is_in_flight(
    peer,
):
    from crate.db.repositories import federation as repo
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import transaction_scope

    session_uid = str(uuid4())
    generation = begin_catalog_sync_session(peer)
    page_locked, release_page = Event(), Event()

    def in_flight_page():
        with transaction_scope() as session:
            apply_federation_manifest_page(
                node_uid=peer,
                revision="r",
                sync_session_uid=session_uid,
                sync_generation=generation,
                items=[{"entity_type": "artist", "entity_uid": "a", "title": "a"}],
                checkpoint={"next_page": 1, "page_size": 500, "synced": 1},
                session=session,
            )
            page_locked.set()
            assert release_page.wait(10)

    with ThreadPoolExecutor(max_workers=2) as pool:
        page = pool.submit(in_flight_page)
        assert page_locked.wait(10)
        disabling = pool.submit(repo.disable_peer, peer)
        release_page.set()
        page.result(timeout=10)
        disabled = disabling.result(timeout=10)

    assert disabled["trust_state"] == "disabled"
    assert _cursor(peer)["sync_generation"] == generation + 1
    assert [row["deleted_at"] is not None for row in _rows(peer)] == [True]
    with pytest.raises(CatalogSyncFenced):
        _page(peer, generation, session_uid, "b", next_page=2)


def test_disable_bumps_the_generation_in_its_own_transaction(peer):
    """A rolled-back disable leaves the running session valid."""
    from crate.db.repositories.federation_catalog_fence import (
        begin_catalog_sync_session,
    )
    from crate.db.tx import transaction_scope

    generation = begin_catalog_sync_session(peer)

    class Abort(Exception):
        pass

    with pytest.raises(Abort), transaction_scope() as session:
        session.execute(
            text(
                "UPDATE federation_nodes SET disabled_at = NOW(), "
                "trust_state = 'disabled' WHERE node_uid = CAST(:uid AS uuid)"
            ),
            {"uid": peer},
        )
        bumped = session.execute(
            text(
                "SELECT sync_generation FROM federation_catalog_cursors "
                "WHERE node_uid = CAST(:uid AS uuid)"
            ),
            {"uid": peer},
        ).scalar_one()
        assert bumped == generation + 1
        raise Abort

    assert _cursor(peer)["sync_generation"] == generation
    _page(peer, generation, str(uuid4()), "a")


# ── Mixed-version writers (the v159/v160 database bridge) ──────────────────


def _legacy(sql, params):
    """Run SQL the way a pre-160 image does: without declaring a fence."""
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(text(sql), params)


_LEGACY_CURSOR = """
    INSERT INTO federation_catalog_cursors (node_uid, cursor, updated_at)
    VALUES (CAST(:uid AS uuid), :cursor, NOW())
    ON CONFLICT (node_uid) DO UPDATE SET cursor = EXCLUDED.cursor,
        full_sync_completed_at = NOW(), updated_at = NOW()
"""
_LEGACY_TOMBSTONE = """
    UPDATE federation_catalog_items SET deleted_at = NOW()
    WHERE node_uid = CAST(:uid AS uuid) AND deleted_at IS NULL
      AND remote_revision IS DISTINCT FROM :revision
"""
_LEGACY_UPSERT = """
    INSERT INTO federation_catalog_items
        (node_uid, remote_entity_uid, entity_type, title, remote_revision)
    VALUES (CAST(:uid AS uuid), :entity_uid, 'artist', :title, :revision)
    ON CONFLICT (node_uid, entity_type, remote_entity_uid) DO UPDATE SET
        title = EXCLUDED.title, remote_revision = EXCLUDED.remote_revision
"""


def test_pre_fence_writers_keep_working_until_a_fenced_session_starts(peer):
    _legacy(
        _LEGACY_UPSERT,
        {"uid": peer, "entity_uid": "a", "title": "old image", "revision": "r0"},
    )
    _legacy(_LEGACY_TOMBSTONE, {"uid": peer, "revision": "r1"})
    _legacy(_LEGACY_CURSOR, {"uid": peer, "cursor": "r1"})

    assert _cursor(peer)["cursor"] == "r1"
    assert _cursor(peer)["sync_generation"] == 0
    assert [row["deleted_at"] is not None for row in _rows(peer)] == [True]


@pytest.mark.parametrize(
    ("sql", "params"),
    [
        pytest.param(_LEGACY_CURSOR, {"cursor": "stale"}, id="cursor"),
        pytest.param(_LEGACY_TOMBSTONE, {"revision": "old"}, id="tombstone"),
        pytest.param(
            _LEGACY_UPSERT,
            {"entity_uid": "a", "title": "stale", "revision": "old"},
            id="page-row",
        ),
    ],
)
def test_pre_fence_writers_cannot_overwrite_a_fenced_session(peer, sql, params):
    from crate.db.repositories.federation_catalog_fence import (
        begin_catalog_sync_session,
    )

    session_uid = str(uuid4())
    generation = begin_catalog_sync_session(peer)
    _page(peer, generation, session_uid, "a", revision="new", next_page=4)

    with pytest.raises(DBAPIError, match="federation catalog sync fenced"):
        _legacy(sql, {"uid": peer, **params})

    assert [(row["title"], row["deleted_at"]) for row in _rows(peer)] == [
        ("a new", None)
    ]
    assert _checkpoint(peer)["next_page"] == 4


def test_pre_fence_admin_disable_still_tombstones_and_fences(peer):
    """An old API image disabling a peer is never blocked by the guard."""
    from crate.db.repositories.federation_catalog_fence import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
    )
    from crate.db.tx import transaction_scope

    session_uid = str(uuid4())
    generation = begin_catalog_sync_session(peer)
    _page(peer, generation, session_uid, "a")

    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE federation_nodes SET disabled_at = NOW(), "
                "trust_state = 'disabled' WHERE node_uid = CAST(:uid AS uuid)"
            ),
            {"uid": peer},
        )
        session.execute(
            text(
                "UPDATE federation_catalog_items SET deleted_at = NOW() "
                "WHERE node_uid = CAST(:uid AS uuid) AND deleted_at IS NULL"
            ),
            {"uid": peer},
        )

    assert [row["deleted_at"] is not None for row in _rows(peer)] == [True]
    with pytest.raises(CatalogSyncFenced):
        _page(peer, generation, session_uid, "b")


def test_the_generation_never_moves_backwards(peer):
    from crate.db.repositories.federation_catalog_fence import (
        begin_catalog_sync_session,
    )

    begin_catalog_sync_session(peer)
    begin_catalog_sync_session(peer)
    with pytest.raises(DBAPIError, match="cannot move backwards"):
        _legacy(
            "UPDATE federation_catalog_cursors SET sync_generation = 1 "
            "WHERE node_uid = CAST(:uid AS uuid)",
            {"uid": peer},
        )


def test_old_publishers_still_stage_through_the_v159_bridge_with_the_fence(peer):
    from crate.db.jobs import federation_catalog_changes as changes

    del peer
    _legacy(
        """
        INSERT INTO federation_catalog_changes (
            entity_type, entity_uid, operation, payload_revision,
            payload_json, retention_until
        ) VALUES ('artist', 'legacy', 'upsert', 'old-revision',
                  '{"title":"old image"}', NOW() + INTERVAL '90 days')
        """,
        {},
    )
    before = changes.catalog_high_water_mark()
    changes.publish_pending_catalog_changes(limit=10)
    published = changes.list_catalog_changes(after_sequence=before, limit=10)
    assert [row["payload_json"]["title"] for row in published] == ["old image"]


# ── Migration 160 ─────────────────────────────────────────────────────────


class _Recorder:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)


class _SessionExecutor:
    def __init__(self, session):
        self.session = session

    def execute(self, statement):
        self.session.execute(text(statement))


def test_migration_160_follows_159_and_uses_the_shared_schema(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.160_federation_catalog_sync_fencing"
    )
    schema = import_module(
        "crate.db.schema_sections.federation_catalog_sync_fencing_v160"
    )
    upgrade, expected = _Recorder(), _Recorder()
    monkeypatch.setattr(migration, "op", upgrade)
    migration.upgrade()
    schema.create_federation_catalog_sync_fencing_v160_schema(expected)
    assert migration.revision == "160"
    assert migration.down_revision == "159"
    assert upgrade.statements == expected.statements

    downgrade, expected_down = _Recorder(), _Recorder()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    schema.drop_federation_catalog_sync_fencing_v160_schema(expected_down)
    assert downgrade.statements == expected_down.statements


def test_migration_160_downgrades_and_reapplies_on_postgres(peer):
    from crate.db.repositories.federation_catalog_fence import (
        begin_catalog_sync_session,
    )
    from crate.db.schema_sections.federation_catalog_sync_fencing_v160 import (
        create_federation_catalog_sync_fencing_v160_schema,
        drop_federation_catalog_sync_fencing_v160_schema,
    )
    from crate.db.tx import transaction_scope

    generation = begin_catalog_sync_session(peer)
    _page(peer, generation, str(uuid4()), "a")

    with transaction_scope() as session:
        drop_federation_catalog_sync_fencing_v160_schema(_SessionExecutor(session))
        columns = session.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'federation_catalog_cursors'"
            )
        ).scalars()
        assert "sync_generation" not in set(columns)
    # Downgraded, pre-160 writers are unrestricted again.
    _legacy(_LEGACY_CURSOR, {"uid": peer, "cursor": "pre-160"})
    _legacy(_LEGACY_TOMBSTONE, {"uid": peer, "revision": "other"})

    with transaction_scope() as session:
        create_federation_catalog_sync_fencing_v160_schema(_SessionExecutor(session))
        # Idempotent, as migration 001 + later revisions re-run sections.
        create_federation_catalog_sync_fencing_v160_schema(_SessionExecutor(session))
    assert _cursor(peer)["sync_generation"] == 0
    assert begin_catalog_sync_session(peer) == 1
