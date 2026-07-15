import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_disabling_peer_immediately_invalidates_its_catalog_sources(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.repositories import federation as federation_repo
    from crate.db.tx import read_scope
    from crate.federation.catalog import upsert_catalog_item
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    node_uid = str(uuid.uuid4())
    federation_repo.upsert_peer(
        node_uid=node_uid,
        display_name="Remote Node",
        api_base_url="https://remote.test",
        active_key_id="key-1",
        trust_state="approved",
    )
    upsert_catalog_item(
        node_uid,
        "artist-remote",
        "artist",
        "Remote Artist",
        remote_revision="rev-1",
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1
    assert get_global_catalog_counts()["artists"] == 1

    federation_repo.disable_peer(node_uid)

    with read_scope() as session:
        raw_item = (
            session.execute(
                text(
                    """
                    SELECT deleted_at
                    FROM federation_catalog_items
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND remote_entity_uid = 'artist-remote'
                    """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .one()
        )
        source = (
            session.execute(
                text(
                    """
                    SELECT source_stale, source_deleted_at
                    FROM global_catalog_sources
                    WHERE node_uid = CAST(:node_uid AS uuid)
                      AND remote_entity_uid = 'artist-remote'
                    """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .one()
        )

    assert raw_item["deleted_at"] is not None
    assert source["source_stale"] is True
    assert source["source_deleted_at"] is not None
    assert get_global_catalog_counts()["artists"] == 0
