import uuid

import pytest
from sqlalchemy import text

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


def test_local_album_resolves_artist_through_merged_local_source(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    shared_mbid = str(uuid.uuid4())
    pg_db.upsert_artist(
        {
            "name": "Emma Ruth Rundle",
            "entity_uid": str(uuid.uuid4()),
            "mbid": shared_mbid,
        }
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (
                    entity_uid, name, slug, folder_name, album_count, track_count,
                    total_size, formats_json, has_photo, mbid, updated_at
                )
                VALUES (
                    CAST(:entity_uid AS uuid), :name, :slug, :name, 0, 0,
                    0, '[]'::jsonb, 0, :mbid, NOW()
                )
                """
            ),
            {
                "entity_uid": str(uuid.uuid4()),
                "name": "Emma Ruth Rundle & Thou",
                "slug": "emma-ruth-rundle-and-thou",
                "mbid": shared_mbid,
            },
        )
    album_id = pg_db.upsert_album(
        {
            "artist": "Emma Ruth Rundle",
            "name": "Engine of Hell",
            "path": "/music/Emma Ruth Rundle/Engine of Hell",
            "entity_uid": str(uuid.uuid4()),
            "track_count": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Emma Ruth Rundle",
            "album": "Engine of Hell",
            "filename": "01 - Return.flac",
            "title": "Return",
            "path": "/music/Emma Ruth Rundle/Engine of Hell/01 - Return.flac",
            "entity_uid": str(uuid.uuid4()),
            "duration": 246.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )

    result = reconcile_local_catalog()

    with read_scope() as session:
        canonical_artist = (
            session.execute(
                text(
                    """
                    SELECT canonical_name, source_count
                    FROM global_catalog_artists
                    """
                )
            )
            .mappings()
            .one()
        )

    assert result["source_rows_seen"] == 4
    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 4,
    }
    assert canonical_artist == {
        "canonical_name": "Emma Ruth Rundle",
        "source_count": 2,
    }


def test_local_track_resolves_album_through_merged_local_source(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    pg_db.upsert_artist(
        {
            "name": "Alias Artist",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    shared_release_mbid = str(uuid.uuid4())
    original_album_id = pg_db.upsert_album(
        {
            "artist": "Alias Artist",
            "name": "Original Title",
            "path": "/music/Alias Artist/Original Title",
            "entity_uid": str(uuid.uuid4()),
            "musicbrainz_albumid": shared_release_mbid,
            "track_count": 1,
        }
    )
    pg_db.upsert_album(
        {
            "artist": "Alias Artist",
            "name": "Renamed Edition",
            "path": "/music/Alias Artist/Renamed Edition",
            "entity_uid": str(uuid.uuid4()),
            "musicbrainz_albumid": shared_release_mbid,
            "track_count": 1,
        }
    )
    track_uid = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "album_id": original_album_id,
            "artist": "Alias Artist",
            "album": "Original Title",
            "filename": "01 - Source Bound.flac",
            "title": "Source Bound",
            "path": "/music/Alias Artist/Original Title/01 - Source Bound.flac",
            "entity_uid": track_uid,
            "duration": 180.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )

    reconcile_local_catalog()

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        track.global_album_uid::text AS track_album_uid,
                        source.global_entity_uid::text AS source_album_uid
                    FROM global_catalog_tracks track
                    JOIN global_catalog_sources track_source
                      ON track_source.global_entity_uid = track.global_track_uid
                     AND track_source.entity_type = 'track'
                    JOIN global_catalog_sources source
                      ON source.source_kind = 'local'
                     AND source.entity_type = 'album'
                     AND source.local_id = :album_id
                    WHERE track_source.local_entity_uid = CAST(:track_uid AS uuid)
                    """
                ),
                {"album_id": original_album_id, "track_uid": track_uid},
            )
            .mappings()
            .one()
        )

    assert row["track_album_uid"] == row["source_album_uid"]


@pytest.mark.parametrize("reconciliation_mode", ["full", "incremental"])
def test_local_track_uses_album_artist_when_track_credit_is_not_canonical(
    pg_db, reconciliation_mode
):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import (
        reconcile_dirty_catalog_sources,
        reconcile_local_catalog,
    )

    pg_db.upsert_artist(
        {
            "name": "The Who",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    album_id = pg_db.upsert_album(
        {
            "artist": "The Who",
            "name": "Who Came First",
            "path": "/music/The Who/Who Came First",
            "entity_uid": str(uuid.uuid4()),
            "track_count": 1,
        }
    )
    track_uid = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Pete Townshend",
            "album": "Who Came First",
            "filename": "01 - Pure And Easy.flac",
            "title": "Pure And Easy",
            "path": "/music/The Who/Who Came First/01 - Pure And Easy.flac",
            "entity_uid": track_uid,
            "duration": 333.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )

    if reconciliation_mode == "full":
        reconcile_local_catalog()
    else:
        result = reconcile_dirty_catalog_sources(limit=10)
        assert result["failed"] == 0
        assert result["remaining"] == 0

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        track.global_artist_uid::text AS track_artist_uid,
                        album.global_artist_uid::text AS album_artist_uid
                    FROM global_catalog_sources source
                    JOIN global_catalog_tracks track
                      ON track.global_track_uid = source.global_entity_uid
                    JOIN global_catalog_albums album
                      ON album.global_album_uid = track.global_album_uid
                    WHERE source.source_kind = 'local'
                      AND source.entity_type = 'track'
                      AND source.local_entity_uid = CAST(:track_uid AS uuid)
                    """
                ),
                {"track_uid": track_uid},
            )
            .mappings()
            .one_or_none()
        )

    assert row is not None
    assert row["track_artist_uid"] == row["album_artist_uid"]


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
