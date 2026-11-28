import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE, approve_federation_node

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_incremental_backlog_distinguishes_due_retries_and_expired_claims(pg_db):
    from crate.db.jobs.global_catalog_reconciliation import (
        reconcile_dirty_catalog_sources,
    )
    from crate.db.tx import transaction_scope

    for name in ("Due First", "Due Second", "Deferred", "Claimed", "Stale"):
        pg_db.upsert_artist({"name": name, "entity_uid": str(uuid.uuid4())})
    with transaction_scope() as session:
        session.execute(
            text("""
            UPDATE global_catalog_dirty_sources dirty
            SET next_attempt_at = CASE WHEN artist.name = 'Deferred'
                                      THEN NOW() + INTERVAL '1 hour' END,
                claimed_at = CASE WHEN artist.name = 'Claimed' THEN NOW()
                                  WHEN artist.name = 'Stale'
                                  THEN NOW() - INTERVAL '1 hour' END
            FROM library_artists artist
            WHERE dirty.local_entity_uid = artist.entity_uid
        """)
        )

    result = reconcile_dirty_catalog_sources(limit=1)

    assert result["completed"] == 1
    assert result["remaining"] == 3
    assert result["ready_remaining"] == 2


def test_incremental_reconcile_claims_dirty_sources_without_full_library_scan(
    pg_db, monkeypatch
):
    from crate.db.jobs import global_catalog_reconciliation as global_reconciliation
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Incremental Artist"})
    for extractor in (
        "iter_local_artist_sources",
        "iter_local_album_sources",
        "iter_local_track_sources",
    ):
        monkeypatch.setattr(
            global_reconciliation,
            extractor,
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                AssertionError("incremental reconciliation must not scan source tables")
            ),
        )

    result = global_reconciliation.reconcile_dirty_catalog_sources(limit=10)

    assert result == {
        "claimed": 1,
        "completed": 1,
        "failed": 0,
        "remaining": 0,
        "ready_remaining": 0,
    }
    with read_scope() as session:
        canonical = (
            session.execute(
                text(
                    """
                SELECT canonical_name, has_local, source_count
                FROM global_catalog_artists
                WHERE canonical_name = 'Incremental Artist'
                """
                )
            )
            .mappings()
            .one()
        )
        pending = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_dirty_sources
                WHERE completed_at IS NULL
                """
            )
        ).scalar_one()

    assert canonical == {
        "canonical_name": "Incremental Artist",
        "has_local": True,
        "source_count": 1,
    }
    assert pending == 0


def test_incremental_local_album_reconcile_propagates_release_date(pg_db):
    from crate.db.jobs.global_catalog_reconciliation import (
        reconcile_dirty_catalog_sources,
    )
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Release Date Artist"})
    pg_db.upsert_album(
        {
            "artist": "Release Date Artist",
            "name": "Canonical Release",
            "path": "/music/release-date-artist/canonical-release",
            "year": "2024",
            "release_date": "2024-03-09",
        }
    )

    local_album = pg_db.get_library_album("Release Date Artist", "Canonical Release")
    assert local_album["release_date"] == "2024-03-09"

    result = reconcile_dirty_catalog_sources(limit=10)

    assert result["failed"] == 0
    assert get_global_catalog_counts()["albums"] == 1
    with read_scope() as session:
        release_date = session.execute(
            text(
                "SELECT release_date FROM global_catalog_albums WHERE canonical_name = :name"
            ),
            {"name": "Canonical Release"},
        ).scalar_one()

    assert release_date == "2024-03-09"


def test_remote_catalog_upsert_is_projected_from_its_dirty_source(pg_db):
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.catalog import upsert_catalog_item
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    upsert_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="remote-artist-1",
        entity_type="artist",
        title="Incremental Remote Artist",
        remote_revision="remote-rev-1",
        raw_json={"genres": ["hardcore"]},
    )

    assert reconcile_dirty_catalog_sources(limit=10) == {
        "claimed": 1,
        "completed": 1,
        "failed": 0,
        "remaining": 0,
        "ready_remaining": 0,
    }

    with read_scope() as session:
        source = (
            session.execute(
                text(
                    """
                SELECT source_kind, remote_entity_uid, source_revision
                FROM global_catalog_sources
                WHERE node_uid = CAST(:node_uid AS uuid)
                """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .one()
        )

    assert source == {
        "source_kind": "federated",
        "remote_entity_uid": "remote-artist-1",
        "source_revision": "remote-rev-1",
    }


def test_incremental_local_source_promotes_matching_remote_artist(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.db.tx import transaction_scope
    from crate.federation.catalog import upsert_catalog_item
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    upsert_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="remote-high-vis",
        entity_type="artist",
        title="High Vis",
        remote_revision="remote-rev-1",
    )
    assert reconcile_dirty_catalog_sources(limit=10)["failed"] == 0

    pg_db.upsert_artist({"name": "High Vis"})
    assert reconcile_dirty_catalog_sources(limit=10) == {
        "claimed": 1,
        "completed": 1,
        "failed": 0,
        "remaining": 0,
        "ready_remaining": 0,
    }

    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 0,
        "tracks": 0,
        "sources": 2,
    }
    sources = list_global_sources()
    assert {source["global_entity_uid"] for source in sources} == {
        sources[0]["global_entity_uid"]
    }


def _claimed_dirty_source(attempts: int) -> dict:
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    return {
        "id": 41,
        "entity_type": "track",
        "source_kind": "local",
        "operation": "upsert",
        "requested_at": now,
        "claimed_at": now,
        "attempts": attempts,
    }


def test_a_source_waiting_for_its_canonical_artist_is_deferred_not_reported(
    pg_db, monkeypatch, caplog
):
    """A dependency wait retries later with backoff and never logs an error.

    Every error-level log reaches Sentry; reporting this expected wait on each
    retry exhausted the monthly error quota (CRATE-WORKERS-M).
    """
    import logging

    from crate.db.jobs import global_catalog_reconciliation as reconciliation
    from crate.db.repositories import global_catalog_dirty_sources as dirty_sources

    monkeypatch.setattr(
        dirty_sources,
        "claim_dirty_sources",
        lambda limit, session: [_claimed_dirty_source(attempts=3)],
    )

    def wait_for_artist(session, dirty):
        raise reconciliation.CanonicalDependencyPending(
            "Track source is waiting for its canonical artist"
        )

    monkeypatch.setattr(reconciliation, "_reconcile_dirty_source", wait_for_artist)
    failures = []
    monkeypatch.setattr(
        dirty_sources,
        "fail_dirty_source",
        lambda source_id, error, **kwargs: failures.append((source_id, kwargs)) or True,
    )

    with caplog.at_level(logging.INFO, logger=reconciliation.log.name):
        result = reconciliation.reconcile_dirty_catalog_sources(limit=10)

    assert result["failed"] == 1
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert failures[0][0] == 41
    # Third attempt: one hour doubled twice.
    assert failures[0][1]["retry_after_seconds"] == 4 * 3600


def test_dependency_retries_back_off_to_a_day():
    from crate.db.jobs.global_catalog_reconciliation import dependency_retry_seconds

    assert dependency_retry_seconds(1) == 3600
    assert dependency_retry_seconds(2) == 7200
    assert dependency_retry_seconds(5) == 16 * 3600
    assert dependency_retry_seconds(6) == 24 * 3600
    assert dependency_retry_seconds(12753) == 24 * 3600
    assert dependency_retry_seconds(0) == 3600


def test_an_unexpected_reconciliation_failure_is_still_reported(
    pg_db, monkeypatch, caplog
):
    import logging

    from crate.db.jobs import global_catalog_reconciliation as reconciliation
    from crate.db.repositories import global_catalog_dirty_sources as dirty_sources

    monkeypatch.setattr(
        dirty_sources,
        "claim_dirty_sources",
        lambda limit, session: [_claimed_dirty_source(attempts=1)],
    )

    def broken(session, dirty):
        raise ValueError("Local dirty source is missing entity UID")

    monkeypatch.setattr(reconciliation, "_reconcile_dirty_source", broken)
    failures = []
    monkeypatch.setattr(
        dirty_sources,
        "fail_dirty_source",
        lambda source_id, error, **kwargs: failures.append(kwargs) or True,
    )

    with caplog.at_level(logging.INFO, logger=reconciliation.log.name):
        reconciliation.reconcile_dirty_catalog_sources(limit=10)

    assert [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert failures[0]["retry_after_seconds"] is None
