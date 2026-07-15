import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import approve_federation_node, PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _insert_remote_catalog_item(
    *,
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    title: str,
    artist: str | None = None,
    album: str | None = None,
    year: str | None = None,
    track_count: int | None = None,
    duration_seconds: int | None = None,
    musicbrainz_artist_mbid: str | None = None,
    musicbrainz_release_mbid: str | None = None,
    musicbrainz_recording_mbid: str | None = None,
    raw_json: dict | None = None,
):
    from crate.db.tx import transaction_scope

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
                        artist,
                        album,
                        year,
                        track_count,
                        duration_seconds,
                        musicbrainz_artist_mbid,
                        musicbrainz_release_mbid,
                        musicbrainz_recording_mbid,
                        remote_revision,
                        raw_json
                    )
                VALUES
                    (
                        :node_uid,
                        :remote_entity_uid,
                        :entity_type,
                        :title,
                        :artist,
                        :album,
                        :year,
                        :track_count,
                        :duration_seconds,
                        :musicbrainz_artist_mbid,
                        :musicbrainz_release_mbid,
                        :musicbrainz_recording_mbid,
                        'rev-1',
                        :raw_json
                    )
                """
            ),
            {
                "node_uid": node_uid,
                "remote_entity_uid": remote_entity_uid,
                "entity_type": entity_type,
                "title": title,
                "artist": artist,
                "album": album,
                "year": year,
                "track_count": track_count,
                "duration_seconds": duration_seconds,
                "musicbrainz_artist_mbid": musicbrainz_artist_mbid,
                "musicbrainz_release_mbid": musicbrainz_release_mbid,
                "musicbrainz_recording_mbid": musicbrainz_recording_mbid,
                "raw_json": json.dumps(raw_json or {"fixture": True}),
            },
        )


def test_remote_artist_with_same_mbid_merges_into_local_artist(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist(
        {"name": "Rival Schools", "mbid": "artist-mbid", "has_photo": 1}
    )
    reconcile_local_catalog()
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="artist-remote",
        entity_type="artist",
        title="Rival Schools",
        musicbrainz_artist_mbid="artist-mbid",
    )

    result = reconcile_remote_catalog()

    assert result["status"] == "completed"
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


def test_local_catalog_promotes_matching_remote_entities_without_duplicates(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="artist-remote",
        entity_type="artist",
        title="High Vis",
        musicbrainz_artist_mbid="artist-mbid",
    )
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="album-remote",
        entity_type="album",
        title="Blending",
        artist="High Vis",
        year="2022",
        track_count=1,
        musicbrainz_release_mbid="release-mbid",
    )
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="track-remote",
        entity_type="track",
        title="Talk For Hours",
        artist="High Vis",
        album="Blending",
        duration_seconds=183,
        musicbrainz_recording_mbid="recording-mbid",
    )
    reconcile_remote_catalog()

    pg_db.upsert_artist({"name": "High Vis", "mbid": "artist-mbid", "has_photo": 1})
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "musicbrainz_albumid": "release-mbid",
            "year": "2022",
            "track_count": 1,
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
            "musicbrainz_trackid": "recording-mbid",
            "duration": 183.0,
            "disc_number": 1,
            "track_number": 1,
        }
    )

    reconcile_local_catalog()

    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 6,
    }
    sources = list_global_sources()
    for entity_type in ("artist", "album", "track"):
        entity_sources = [
            source for source in sources if source["entity_type"] == entity_type
        ]
        assert len(entity_sources) == 2
        assert len({source["global_entity_uid"] for source in entity_sources}) == 1
        local_source = next(
            source for source in entity_sources if source["source_kind"] == "local"
        )
        assert local_source["preferred_for_display"] is True


def test_remote_source_keeps_its_canonical_uid_when_metadata_changes(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.db.tx import transaction_scope
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "High Vis"})
    reconcile_local_catalog()
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="artist-remote",
        entity_type="artist",
        title="High Vis",
    )
    reconcile_remote_catalog()
    original_uid = list_global_sources()[0]["global_entity_uid"]

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE federation_catalog_items
                SET title = 'High Vis UK', remote_revision = 'rev-2'
                WHERE node_uid = CAST(:node_uid AS uuid)
                  AND remote_entity_uid = 'artist-remote'
                """
            ),
            {"node_uid": node_uid},
        )

    reconcile_remote_catalog()

    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 0,
        "tracks": 0,
        "sources": 2,
    }
    sources = list_global_sources()
    assert {source["global_entity_uid"] for source in sources} == {original_uid}


def test_remote_reconciliation_batch_is_bounded_and_resumable(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_reconciliation import reconcile_remote_catalog_batch

    node_uid = str(uuid.uuid4())
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="artist-remote-1",
        entity_type="artist",
        title="Rival Schools",
    )
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="artist-remote-2",
        entity_type="artist",
        title="High Vis",
    )

    cursor = None
    batches = []
    while True:
        result = reconcile_remote_catalog_batch(batch_size=1, cursor=cursor)
        batches.append(result)
        assert result["source_rows_seen"] <= 1
        if result["completed"]:
            break
        cursor = result["next_cursor"]

    assert len(batches) > 1
    assert get_global_catalog_counts() == {
        "artists": 2,
        "albums": 0,
        "tracks": 0,
        "sources": 2,
    }


def test_remote_album_with_ambiguous_title_does_not_auto_merge(pg_db):
    from crate.db.queries.global_catalog import get_global_catalog_counts
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Rival Schools"})
    pg_db.upsert_album(
        {
            "artist": "Rival Schools",
            "name": "Pedals",
            "path": "/music/Rival Schools/Pedals",
            "year": "2011",
            "track_count": 10,
        }
    )
    reconcile_local_catalog()
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="album-remote",
        entity_type="album",
        title="Pedals (Deluxe Edition)",
        artist="Rival Schools",
    )

    reconcile_remote_catalog()

    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 2,
        "tracks": 0,
        "sources": 3,
    }


def test_remote_album_artwork_refreshes_existing_canonical_album(pg_db):
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "High Vis"})
    pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Guided Tour",
            "path": "/music/High Vis/Guided Tour",
            "year": "2024",
            "track_count": 11,
            "has_cover": 0,
        }
    )
    reconcile_local_catalog()
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="album-remote",
        entity_type="album",
        title="Guided Tour",
        artist="High Vis",
        year="2024",
        track_count=11,
        raw_json={
            "has_cover": True,
            "facets": {"album_artwork": {"available": True, "revision": "rev-1"}},
        },
    )

    reconcile_remote_catalog()

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT has_cover, artwork_source_json
                    FROM global_catalog_albums
                    WHERE artist_name = 'High Vis' AND canonical_name = 'Guided Tour'
                    """
                )
            )
            .mappings()
            .one()
        )

    assert row["has_cover"] is True
    assert row["artwork_source_json"]["source_kind"] == "federated"


def test_remote_track_with_same_recording_mbid_merges_into_local_track(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_catalog_counts,
        list_global_sources,
    )
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    node_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Rival Schools"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Rival Schools",
            "name": "Pedals",
            "path": "/music/Rival Schools/Pedals",
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
            "musicbrainz_trackid": "recording-mbid",
        }
    )
    reconcile_local_catalog()
    _insert_remote_catalog_item(
        node_uid=node_uid,
        remote_entity_uid="track-remote",
        entity_type="track",
        title="Wring It Out",
        artist="Rival Schools",
        album="Pedals",
        duration_seconds=214,
        musicbrainz_recording_mbid="recording-mbid",
    )

    reconcile_remote_catalog()

    assert get_global_catalog_counts() == {
        "artists": 1,
        "albums": 1,
        "tracks": 1,
        "sources": 4,
    }
    track_sources = [
        source for source in list_global_sources() if source["entity_type"] == "track"
    ]
    assert len({source["global_entity_uid"] for source in track_sources}) == 1
