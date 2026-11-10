from __future__ import annotations

import json
import uuid
from contextlib import contextmanager

import pytest
from sqlalchemy import event, text

from tests.conftest import approve_federation_node


@pytest.fixture
def peer(pg_db, monkeypatch):
    del pg_db
    from crate.db.repositories import tasks_mutations, tasks_shared
    from crate.db.tx import transaction_scope

    dispatched = []
    monkeypatch.setattr(
        tasks_mutations, "dispatch_task", lambda *args: dispatched.append(args)
    )
    monkeypatch.setattr(tasks_shared, "publish_tasks_surface_signal", lambda: None)
    monkeypatch.setattr(tasks_shared, "_publish_task_transition_signal", lambda _: None)
    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    return node_uid, dispatched


def _checkpoint(synced):
    return {
        "next_page": 1,
        "page_size": 200,
        "synced": synced,
        "next_cursor": "opaque-next",
        "snapshot_cursor": "opaque-snapshot",
    }


def _cache(node_uid, remote_entity_uid, suffix):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_content_cache (
                    cache_key, entity_type, global_entity_uid, facet,
                    source_node_uid, remote_entity_uid, payload_json
                ) VALUES (
                    :key, 'artist', CAST(:global_uid AS uuid), 'overview',
                    CAST(:node_uid AS uuid), :remote_uid, '{}'::jsonb
                )
                """
            ),
            {
                "key": suffix,
                "global_uid": str(uuid.uuid4()),
                "node_uid": node_uid,
                "remote_uid": remote_entity_uid,
            },
        )


def test_manifest_page_preserves_metadata_and_projects_all_entity_types(peer):
    from crate.db.jobs.global_catalog_reconciliation import (
        reconcile_dirty_catalog_sources,
    )
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope

    node_uid, dispatched = peer
    sync_uid = str(uuid.uuid4())
    _cache(node_uid, "artist-1", "changed-cache")
    _cache(node_uid, "other-artist", "retained-cache")
    items = [
        {
            "entity_type": "artist",
            "remote_entity_uid": "artist-1",
            "name": "Bulk Artist",
        },
        {
            "entity_type": "album",
            "entity_uid": "album-1",
            "title": "Bulk Album",
            "artist": "Bulk Artist",
            "year": 2024,
        },
        {
            "entity_type": "track",
            "remote_entity_uid": "track-1",
            "title": "Bulk Track",
            "artist": "Bulk Artist",
            "album": "Bulk Album",
            "duration": "123.8",
            "track_number": 2,
            "disc_number": 1,
            "genres": ["post-hardcore"],
        },
    ]

    result = apply_federation_manifest_page(
        node_uid=node_uid,
        items=items,
        revision="revision-1",
        sync_session_uid=sync_uid,
        checkpoint=_checkpoint(3),
    )

    assert result == {"applied": 3, "invalidated": 1}
    assert len(dispatched) == 1
    with read_scope() as session:
        track = (
            session.execute(
                text(
                    "SELECT duration_seconds, track_number, disc_number, raw_json, "
                    "remote_revision, last_seen_sync_session_uid::text AS sync_uid "
                    "FROM federation_catalog_items WHERE remote_entity_uid = 'track-1'"
                )
            )
            .mappings()
            .one()
        )
        assert dict(track) == {
            "duration_seconds": 123,
            "track_number": 2,
            "disc_number": 1,
            "raw_json": items[2],
            "remote_revision": "revision-1",
            "sync_uid": sync_uid,
        }
        cursor = session.execute(
            text("SELECT cursor FROM federation_catalog_cursors WHERE node_uid = :uid"),
            {"uid": node_uid},
        ).scalar_one()
        assert json.loads(cursor) == {
            "status": "partial",
            "revision": "revision-1",
            "next_page": 1,
            "page_size": 200,
            "synced": 3,
            "next_cursor": "opaque-next",
            "snapshot_cursor": "opaque-snapshot",
            "sync_session_uid": sync_uid,
        }
        assert session.execute(
            text("SELECT cache_key FROM global_content_cache")
        ).scalars().all() == ["retained-cache"]
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM global_catalog_dirty_sources WHERE completed_at IS NULL"
                )
            ).scalar_one()
            == 3
        )
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM tasks WHERE type = 'global_catalog_reconcile_incremental'"
                )
            ).scalar_one()
            == 1
        )
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM domain_event_outbox WHERE event_type = 'global_catalog.source.changed'"
                )
            ).scalar_one()
            == 1
        )

    projected = reconcile_dirty_catalog_sources(limit=10)
    assert projected["completed"] == 3
    assert projected["failed"] == 0
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }


def test_manifest_page_rollback_preserves_checkpoint_cache_and_queue(peer):
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope, transaction_scope

    node_uid, dispatched = peer
    _cache(node_uid, "artist-1", "existing-cache")
    with (
        pytest.raises(RuntimeError, match="abort page"),
        transaction_scope() as session,
    ):
        apply_federation_manifest_page(
            node_uid=node_uid,
            items=[
                {
                    "entity_type": "artist",
                    "entity_uid": "artist-1",
                    "title": "Rolled back",
                }
            ],
            revision="new-revision",
            sync_session_uid=str(uuid.uuid4()),
            checkpoint=_checkpoint(1),
            session=session,
        )
        assert dispatched == []
        raise RuntimeError("abort page")

    assert dispatched == []
    with read_scope() as session:
        for table in (
            "federation_catalog_items",
            "federation_catalog_cursors",
            "global_catalog_dirty_sources",
            "tasks",
            "domain_event_outbox",
        ):
            assert (
                session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one() == 0
            )
        assert (
            session.execute(
                text("SELECT cache_key FROM global_content_cache")
            ).scalar_one()
            == "existing-cache"
        )


@contextmanager
def _query_counts():
    from crate.db.engine import get_engine

    engine = get_engine()
    counters = {"queries": 0, "commits": 0}

    def query(*_args):
        counters["queries"] += 1

    def commit(*_args):
        counters["commits"] += 1

    event.listen(engine, "before_cursor_execute", query)
    event.listen(engine, "commit", commit)
    try:
        yield counters
    finally:
        event.remove(engine, "before_cursor_execute", query)
        event.remove(engine, "commit", commit)


def test_manifest_page_query_and_commit_counts_do_not_grow_per_item(peer, request):
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope

    node_uid, dispatched = peer
    session_uid = str(uuid.uuid4())
    # Keep the real deduplicated projection task pending for both measurements.
    apply_federation_manifest_page(
        node_uid=node_uid,
        items=[{"entity_type": "artist", "entity_uid": "seed", "title": "Seed"}],
        revision="revision-1",
        sync_session_uid=session_uid,
    )
    measurements = []
    for size in (1, 200):
        with _query_counts() as counts:
            apply_federation_manifest_page(
                node_uid=node_uid,
                items=[
                    {
                        "entity_type": "track",
                        "entity_uid": f"{size}-{i}",
                        "title": f"Track {i}",
                    }
                    for i in range(size)
                ],
                revision="revision-1",
                sync_session_uid=session_uid,
                checkpoint=_checkpoint(size),
            )
        measurements.append(counts)

    request.node.user_properties.append(("manifest_page_measurements", measurements))
    assert [c["commits"] for c in measurements] == [1, 1]
    assert measurements[1]["queries"] <= measurements[0]["queries"] + 1
    assert measurements[1]["queries"] < 15
    assert len(dispatched) == 1
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_items")
            ).scalar_one()
            == 202
        )
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM global_catalog_dirty_sources")
            ).scalar_one()
            == 202
        )


def test_manifest_page_last_duplicate_wins_and_reopens_completed_dirty_source(peer):
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope, transaction_scope

    node_uid, _ = peer
    apply_federation_manifest_page(
        node_uid=node_uid,
        items=[{"entity_type": "artist", "entity_uid": "artist-1", "title": "Before"}],
        revision="revision-1",
        sync_session_uid=str(uuid.uuid4()),
    )
    with transaction_scope() as session:
        session.execute(
            text(
                'UPDATE federation_catalog_items SET deleted_at = NOW(), tombstone_json = \'{"reason":"old"}\'::jsonb'
            )
        )
        session.execute(
            text(
                "UPDATE global_catalog_dirty_sources SET completed_at = NOW(), claimed_at = NOW(), next_attempt_at = NOW(), last_error = 'old failure'"
            )
        )
    sync_uid = str(uuid.uuid4())
    result = apply_federation_manifest_page(
        node_uid=node_uid,
        items=[
            {
                "entity_type": "artist",
                "entity_uid": "artist-1",
                "title": "Intermediate",
            },
            {"entity_type": "artist", "entity_uid": "artist-1", "title": "After"},
            {"entity_type": "unknown", "entity_uid": "skipped", "title": "Skip"},
            {"entity_type": "album", "title": "Missing identifier"},
        ],
        revision="revision-2",
        sync_session_uid=sync_uid,
    )

    assert result["applied"] == 2
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT title, deleted_at, tombstone_json, remote_revision, last_seen_sync_session_uid::text AS sync_uid FROM federation_catalog_items"
                )
            )
            .mappings()
            .one()
        )
        assert dict(row) == {
            "title": "After",
            "deleted_at": None,
            "tombstone_json": {},
            "remote_revision": "revision-2",
            "sync_uid": sync_uid,
        }
        dirty = (
            session.execute(
                text(
                    "SELECT completed_at, claimed_at, next_attempt_at, last_error, source_revision FROM global_catalog_dirty_sources"
                )
            )
            .mappings()
            .one()
        )
        assert dict(dirty) == {
            "completed_at": None,
            "claimed_at": None,
            "next_attempt_at": None,
            "last_error": None,
            "source_revision": "revision-2",
        }


def test_manifest_page_rejects_unbounded_batches_without_writing(peer):
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope

    node_uid, _ = peer
    with pytest.raises(ValueError, match="500"):
        apply_federation_manifest_page(
            node_uid=node_uid,
            items=[
                {"entity_type": "track", "entity_uid": str(i), "title": "Track"}
                for i in range(501)
            ],
            revision="revision-1",
            sync_session_uid=str(uuid.uuid4()),
            checkpoint=_checkpoint(501),
        )
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_items")
            ).scalar_one()
            == 0
        )


def test_page_checkpoint_failure_rolls_back_import_cache_and_dispatch(peer):
    from crate.db.engine import get_engine
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.tx import read_scope

    node_uid, dispatched = peer
    _cache(node_uid, "artist-1", "cached-before-failure")
    engine = get_engine()

    def fail_checkpoint(_conn, _cursor, statement, *_args):
        if "INSERT INTO federation_catalog_cursors" in statement:
            raise RuntimeError("checkpoint connection lost")

    event.listen(engine, "before_cursor_execute", fail_checkpoint)
    try:
        with pytest.raises(RuntimeError, match="checkpoint connection lost"):
            apply_federation_manifest_page(
                node_uid=node_uid,
                items=[
                    {
                        "entity_type": "artist",
                        "entity_uid": "artist-1",
                        "title": "Incomplete page",
                    }
                ],
                revision="revision-1",
                sync_session_uid=str(uuid.uuid4()),
                checkpoint=_checkpoint(1),
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail_checkpoint)

    assert dispatched == []
    with read_scope() as session:
        for table in (
            "federation_catalog_items",
            "federation_catalog_cursors",
            "global_catalog_dirty_sources",
            "tasks",
            "domain_event_outbox",
        ):
            assert (
                session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one() == 0
            )
        assert (
            session.execute(
                text("SELECT cache_key FROM global_content_cache")
            ).scalar_one()
            == "cached-before-failure"
        )


def test_manifest_update_keeps_inflight_claim_and_survives_its_completion(peer):
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
    )
    from crate.db.tx import read_scope, transaction_scope

    node_uid, _ = peer
    item = {"entity_type": "artist", "entity_uid": "artist-1", "title": "Original"}
    apply_federation_manifest_page(
        node_uid=node_uid,
        items=[item],
        revision="revision-1",
        sync_session_uid=str(uuid.uuid4()),
    )
    with transaction_scope() as session:
        original = claim_dirty_sources(10, session=session)[0]
    item = {**item, "title": "Changed while claimed"}
    apply_federation_manifest_page(
        node_uid=node_uid,
        items=[item],
        revision="revision-2",
        sync_session_uid=str(uuid.uuid4()),
    )
    with read_scope() as session:
        claimed_at = session.execute(
            text("SELECT claimed_at FROM global_catalog_dirty_sources")
        ).scalar_one()
        assert claimed_at == original["claimed_at"]
    with transaction_scope() as session:
        assert complete_dirty_source(
            original["id"],
            requested_at=original["requested_at"],
            claimed_at=original["claimed_at"],
            session=session,
        )
    with transaction_scope() as session:
        pending = claim_dirty_sources(10, session=session)
    assert len(pending) == 1
    assert pending[0]["source_revision"] == "revision-2"
