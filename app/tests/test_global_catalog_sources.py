import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local_album_track(pg_db):
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())

    pg_db.upsert_artist(
        {
            "name": "Rival Schools",
            "entity_uid": artist_uid,
            "mbid": "artist-mbid",
            "has_photo": 1,
        }
    )
    album_id = pg_db.upsert_album(
        {
            "artist": "Rival Schools",
            "name": "Pedals",
            "path": "/music/Rival Schools/Pedals",
            "entity_uid": album_uid,
            "musicbrainz_albumid": "release-mbid",
            "year": "2011",
            "track_count": 1,
            "total_duration": 214.0,
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
            "entity_uid": track_uid,
            "musicbrainz_trackid": "recording-mbid",
            "duration": 214.0,
            "disc_number": 1,
            "track_number": 1,
            "format": "flac",
            "size": 1024,
        }
    )
    return artist_uid, album_uid, track_uid


def test_iter_local_sources_extracts_artist_album_and_track_refs(pg_db):
    from crate.federation.global_sources import iter_local_sources

    artist_uid, album_uid, track_uid = _seed_local_album_track(pg_db)

    sources = list(iter_local_sources(batch_size=1))
    by_type = {source["entity_type"]: source for source in sources}

    assert set(by_type) == {"artist", "album", "track"}
    assert by_type["artist"]["local_entity_uid"] == artist_uid
    assert by_type["album"]["local_entity_uid"] == album_uid
    assert by_type["track"]["local_entity_uid"] == track_uid
    assert by_type["artist"]["source_payload"]["canonical_name"] == "Rival Schools"
    assert by_type["album"]["source_payload"]["canonical_name"] == "Pedals"
    assert by_type["track"]["source_payload"]["canonical_title"] == "Wring It Out"


def test_local_sources_do_not_expose_remote_refs(pg_db):
    from crate.federation.global_sources import iter_local_sources

    _seed_local_album_track(pg_db)

    for source in iter_local_sources(batch_size=2):
        assert source["source_kind"] == "local"
        assert source["node_uid"] is None
        assert source["remote_entity_uid"] is None
        assert "remote_revision" not in source["source_payload"]


def test_local_source_match_keys_are_stable(pg_db):
    from crate.federation.global_sources import iter_local_sources

    _seed_local_album_track(pg_db)

    keys = {
        source["entity_type"]: source["match_key"] for source in iter_local_sources()
    }

    assert keys == {
        "artist": "artist:rival schools",
        "album": "album:rival schools|pedals|2011",
        "track": "track:rival schools|pedals|1|1|wring it out",
    }


def test_iter_local_sources_handles_empty_library(pg_db):
    from crate.federation.global_sources import iter_local_sources
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(text("DELETE FROM library_tracks"))
        session.execute(text("DELETE FROM library_albums"))
        session.execute(text("DELETE FROM library_artists"))

    assert list(iter_local_sources(batch_size=1)) == []


def test_global_source_resolver_picks_lowest_latency_facet_source(pg_db):
    from crate.db.tx import transaction_scope
    from crate.federation.global_source_resolver import resolve_global_source

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    slow_node_uid = str(uuid.uuid4())
    fast_node_uid = str(uuid.uuid4())
    missing_facet_node_uid = str(uuid.uuid4())

    with transaction_scope() as session:
        for node_uid, latency_ms in (
            (slow_node_uid, 250),
            (fast_node_uid, 25),
            (missing_facet_node_uid, 5),
        ):
            session.execute(
                text(
                    """
                    INSERT INTO federation_nodes
                        (
                            node_uid,
                            display_name,
                            api_base_url,
                            active_key_id,
                            trust_state,
                            health_json
                        )
                    VALUES
                        (
                            :node_uid,
                            :display_name,
                            :api_base_url,
                            'key-1',
                            'approved',
                            :health_json
                        )
                    """
                ),
                {
                    "node_uid": node_uid,
                    "display_name": f"Node {latency_ms}",
                    "api_base_url": f"http://{node_uid}.example.test",
                    "health_json": f'{{"healthy": true, "latency_ms": {latency_ms}}}',
                },
            )

        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (
                        global_artist_uid,
                        canonical_name,
                        sort_name,
                        normalized_name,
                        source_count,
                        has_remote
                    )
                VALUES
                    (:artist_uid, 'Birds In Row', 'Birds In Row', 'birds in row', 3, true)
                """
            ),
            {"artist_uid": artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums
                    (
                        global_album_uid,
                        global_artist_uid,
                        canonical_name,
                        normalized_name,
                        artist_name,
                        source_count,
                        has_remote,
                        has_cover
                    )
                VALUES
                    (
                        :album_uid,
                        :artist_uid,
                        'We Already Lost the World',
                        'we already lost the world',
                        'Birds In Row',
                        3,
                        true,
                        true
                    )
                """
            ),
            {"album_uid": album_uid, "artist_uid": artist_uid},
        )

        for node_uid, remote_uid, facets in (
            (
                slow_node_uid,
                "album-slow",
                {"album_artwork": {"available": True, "revision": "slow"}},
            ),
            (
                fast_node_uid,
                "album-fast",
                {"album_artwork": {"available": True, "revision": "fast"}},
            ),
            (
                missing_facet_node_uid,
                "album-no-artwork",
                {"album_detail": {"available": True, "revision": "detail"}},
            ),
        ):
            session.execute(
                text(
                    """
                    INSERT INTO global_catalog_sources
                        (
                            entity_type,
                            global_entity_uid,
                            source_kind,
                            node_uid,
                            remote_entity_uid,
                            source_revision,
                            source_payload_json,
                            match_key,
                            match_confidence,
                            match_method,
                            preferred_for_artwork
                        )
                    VALUES
                        (
                            'album',
                            :album_uid,
                            'federated',
                            :node_uid,
                            :remote_uid,
                            :revision,
                            :payload,
                            :match_key,
                            0.900,
                            'test',
                            true
                        )
                    """
                ),
                {
                    "album_uid": album_uid,
                    "node_uid": node_uid,
                    "remote_uid": remote_uid,
                    "revision": facets.get("album_artwork", {}).get("revision", "x"),
                    "payload": json.dumps({"facets": facets}),
                    "match_key": f"album:{remote_uid}",
                },
            )

    selection = resolve_global_source(
        global_entity_uid=album_uid,
        entity_type="album",
        facet="album_artwork",
    )

    assert selection["node_uid"] == fast_node_uid
    assert selection["remote_entity_uid"] == "album-fast"


def test_global_source_resolver_rejects_orphaned_peer_source(pg_db):
    from crate.db.tx import transaction_scope
    from crate.federation.global_source_resolver import (
        NoGlobalSource,
        resolve_global_source,
    )

    artist_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (
                        global_artist_uid,
                        canonical_name,
                        sort_name,
                        normalized_name,
                        source_count,
                        has_remote
                    )
                VALUES
                    (:artist_uid, 'Orphan Artist', 'Orphan Artist', 'orphan artist', 1, true)
                """
            ),
            {"artist_uid": artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_sources
                    (
                        entity_type,
                        global_entity_uid,
                        source_kind,
                        node_uid,
                        remote_entity_uid,
                        source_payload_json,
                        match_key
                    )
                VALUES
                    (
                        'artist',
                        :artist_uid,
                        'federated',
                        :node_uid,
                        'artist-1',
                        CAST(:source_payload_json AS jsonb),
                        'artist:orphan'
                    )
                """
            ),
            {
                "artist_uid": artist_uid,
                "node_uid": str(uuid.uuid4()),
                "source_payload_json": json.dumps(
                    {"facets": {"metadata": {"available": True}}}
                ),
            },
        )

    with pytest.raises(NoGlobalSource):
        resolve_global_source(
            global_entity_uid=artist_uid,
            entity_type="artist",
            facet="metadata",
        )
