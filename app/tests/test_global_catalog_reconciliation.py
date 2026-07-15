import uuid

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local_catalog(pg_db):
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())

    pg_db.upsert_artist(
        {
            "name": "High Vis",
            "entity_uid": artist_uid,
            "mbid": "artist-mbid",
            "has_photo": 1,
        }
    )
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "entity_uid": album_uid,
            "musicbrainz_albumid": "release-mbid",
            "year": "2022",
            "track_count": 1,
            "total_duration": 183.0,
            "has_cover": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "High Vis",
            "album": "Blending",
            "filename": "01 - Talk For Hours.flac",
            "title": "Talk For Hours",
            "path": "/music/High Vis/Blending/01 - Talk For Hours.flac",
            "entity_uid": track_uid,
            "musicbrainz_trackid": "recording-mbid",
            "duration": 183.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )
    return artist_uid, album_uid, track_uid


def test_reconcile_local_catalog_creates_canonical_rows_and_sources(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_catalog(pg_db)

    result = reconcile_local_catalog(batch_size=1)

    assert result["status"] == "completed"
    assert result["source_rows_seen"] == 3
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }
    assert {source["entity_type"] for source in list_global_sources()} == {
        "artist",
        "album",
        "track",
    }


def test_local_reconciliation_batch_is_bounded_and_resumable(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_reconciliation import reconcile_local_catalog_batch

    _seed_local_catalog(pg_db)

    cursor = None
    batches = []
    while True:
        result = reconcile_local_catalog_batch(batch_size=1, cursor=cursor)
        batches.append(result)
        assert result["source_rows_seen"] <= 1
        if result["completed"]:
            break
        cursor = result["next_cursor"]

    assert len(batches) > 1
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }


def test_reconcile_local_catalog_is_idempotent(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_catalog(pg_db)

    first = reconcile_local_catalog()
    second = reconcile_local_catalog()

    assert first["source_rows_seen"] == 3
    assert second["source_rows_seen"] == 3
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 3,
    }


def test_full_local_reconciliation_prunes_a_source_missing_from_write_model(pg_db):
    from sqlalchemy import text

    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    artist_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Deleted Outside Queue", "entity_uid": artist_uid})
    reconcile_local_catalog()
    with transaction_scope() as session:
        session.execute(
            text(
                "DELETE FROM library_artists WHERE entity_uid = CAST(:entity_uid AS uuid)"
            ),
            {"entity_uid": artist_uid},
        )

    reconcile_local_catalog()

    with read_scope() as session:
        source = (
            session.execute(
                text(
                    """
                    SELECT source_stale, source_deleted_at
                    FROM global_catalog_sources
                    WHERE local_entity_uid = CAST(:entity_uid AS uuid)
                    """
                ),
                {"entity_uid": artist_uid},
            )
            .mappings()
            .one()
        )
    assert get_global_catalog_counts()["artists"] == 0
    assert source["source_stale"] is True
    assert source["source_deleted_at"] is not None


def test_reconcile_local_catalog_prefers_local_sources(pg_db):
    from crate.db.queries.global_catalog import list_global_sources
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_catalog(pg_db)

    reconcile_local_catalog()

    sources = list_global_sources()
    assert len(sources) == 3
    for source in sources:
        assert source["source_kind"] == "local"
        assert source["preferred_for_display"] is True
        assert source["preferred_for_artwork"] is True
        assert source["preferred_for_playback"] is True
