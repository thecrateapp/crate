import pytest
from sqlalchemy import text
import uuid

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_incremental_reconcile_claims_dirty_sources_without_full_library_scan(
    pg_db, monkeypatch
):
    from crate.db.tx import read_scope
    from crate.federation import global_reconciliation

    pg_db.upsert_artist({"name": "Incremental Artist"})
    monkeypatch.setattr(
        global_reconciliation,
        "iter_local_sources",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("incremental reconciliation must not scan all local sources")
        ),
    )

    result = global_reconciliation.reconcile_dirty_catalog_sources(limit=10)

    assert result == {"claimed": 1, "completed": 1, "failed": 0, "remaining": 0}
    with read_scope() as session:
        canonical = session.execute(
            text(
                """
                SELECT canonical_name, has_local, source_count
                FROM global_catalog_artists
                WHERE canonical_name = 'Incremental Artist'
                """
            )
        ).mappings().one()
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


def test_remote_catalog_upsert_is_projected_from_its_dirty_source(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.catalog import upsert_catalog_item
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    node_uid = str(uuid.uuid4())
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
    }

    with read_scope() as session:
        source = session.execute(
            text(
                """
                SELECT source_kind, remote_entity_uid, source_revision
                FROM global_catalog_sources
                WHERE node_uid = CAST(:node_uid AS uuid)
                """
            ),
            {"node_uid": node_uid},
        ).mappings().one()

    assert source == {
        "source_kind": "federated",
        "remote_entity_uid": "remote-artist-1",
        "source_revision": "remote-rev-1",
    }
