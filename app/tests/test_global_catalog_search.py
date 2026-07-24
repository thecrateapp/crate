import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import approve_federation_node, PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local(pg_db):
    pg_db.upsert_artist({"name": "Rival Schools", "has_photo": 1})
    album_id = pg_db.upsert_album(
        {
            "artist": "Rival Schools",
            "name": "Pedals",
            "path": "/music/Rival Schools/Pedals",
            "year": "2011",
            "track_count": 1,
            "has_cover": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Rival Schools",
            "album": "Pedals",
            "filename": "01 - Wring It Out.flac",
            "title": "Wring It Out",
            "path": "/music/Rival Schools/Pedals/01 - Wring It Out.flac",
            "duration": 214.0,
        }
    )


def _insert_remote_artist(title: str, *, deleted: bool = False):
    from crate.db.tx import transaction_scope

    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
        session.execute(
            text(
                """
                INSERT INTO federation_catalog_items
                    (
                        node_uid,
                        remote_entity_uid,
                        entity_type,
                        title,
                        remote_revision,
                        deleted_at,
                        availability_json,
                        raw_json
                    )
                VALUES
                    (
                        :node_uid,
                        :remote_entity_uid,
                        'artist',
                        :title,
                        'rev-1',
                        CASE WHEN :deleted THEN NOW() ELSE NULL END,
                        :availability_json,
                        :raw_json
                    )
                """
            ),
            {
                "node_uid": node_uid,
                "remote_entity_uid": str(uuid.uuid4()),
                "title": title,
                "deleted": deleted,
                "availability_json": json.dumps({"catalog": True, "stream": True}),
                "raw_json": json.dumps({"fixture": True}),
            },
        )


def test_global_catalog_search_returns_local_compatible_shape(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local(pg_db)
    reconcile_local_catalog()

    result = search_global_catalog("Rival", limit=10)

    assert result["artists"][0]["name"] == "Rival Schools"
    assert result["artists"][0]["id"] is not None
    assert result["albums"][0]["name"] == "Pedals"
    assert result["albums"][0]["artist"] == "Rival Schools"
    assert result["tracks"][0]["title"] == "Wring It Out"
    assert result["tracks"][0]["path"] is None


def test_global_catalog_search_hides_remote_node_labels_by_default(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    _insert_remote_artist("Remote Rival")
    reconcile_remote_catalog()

    result = search_global_catalog("Remote", limit=10)
    artist = result["artists"][0]

    assert artist["name"] == "Remote Rival"
    assert artist["entity_uid"] is None
    assert artist["global_artist_uid"]
    assert artist["availability"]["remote"] is True
    assert "node_uid" not in artist
    assert "node_name" not in artist
    assert "remote_entity_uid" not in artist


def test_global_catalog_search_prunes_deleted_remote_sources(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    _insert_remote_artist("Rival Healthy")
    _insert_remote_artist("Rival Stale", deleted=True)
    reconcile_remote_catalog()

    result = search_global_catalog("Rival", limit=10)

    assert [artist["name"] for artist in result["artists"]] == ["Rival Healthy"]
