import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _insert_remote_item(
    *,
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    title: str,
    artist: str | None = None,
    album: str | None = None,
    year: str | None = None,
    duration_seconds: int | None = None,
    musicbrainz_artist_mbid: str | None = None,
    musicbrainz_release_mbid: str | None = None,
    musicbrainz_recording_mbid: str | None = None,
    deleted: bool = False,
    raw_json: dict | None = None,
):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
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
                        duration_seconds,
                        musicbrainz_artist_mbid,
                        musicbrainz_release_mbid,
                        musicbrainz_recording_mbid,
                        remote_revision,
                        deleted_at,
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
                        :duration_seconds,
                        :musicbrainz_artist_mbid,
                        :musicbrainz_release_mbid,
                        :musicbrainz_recording_mbid,
                        'rev-1',
                        CASE WHEN :deleted THEN NOW() ELSE NULL END,
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
                "duration_seconds": duration_seconds,
                "musicbrainz_artist_mbid": musicbrainz_artist_mbid,
                "musicbrainz_release_mbid": musicbrainz_release_mbid,
                "musicbrainz_recording_mbid": musicbrainz_recording_mbid,
                "deleted": deleted,
                "raw_json": json.dumps(raw_json or {"fixture": True}),
            },
        )


def test_iter_remote_sources_extracts_catalog_items(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="artist-1",
        entity_type="artist",
        title="Rival Schools",
        musicbrainz_artist_mbid="artist-mbid",
    )
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="album-1",
        entity_type="album",
        title="Pedals",
        artist="Rival Schools",
        year="2011",
        musicbrainz_release_mbid="release-mbid",
    )
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="track-1",
        entity_type="track",
        title="Wring It Out",
        artist="Rival Schools",
        album="Pedals",
        duration_seconds=214,
        musicbrainz_recording_mbid="recording-mbid",
    )

    sources = list(iter_remote_sources(batch_size=1))
    by_type = {source["entity_type"]: source for source in sources}

    assert set(by_type) == {"artist", "album", "track"}
    assert by_type["artist"]["node_uid"] == node_uid
    assert by_type["album"]["remote_entity_uid"] == "album-1"
    assert by_type["track"]["source_payload"]["canonical_title"] == "Wring It Out"
    assert by_type["album"]["source_payload"]["canonical_name"] == "Pedals"


def test_remote_sources_do_not_expose_local_refs(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="album-1",
        entity_type="album",
        title="Pedals",
        artist="Rival Schools",
    )

    source = next(iter_remote_sources())

    assert source["source_kind"] == "federated"
    assert source["local_id"] is None
    assert source["local_entity_uid"] is None
    assert source["node_uid"] == node_uid
    assert source["remote_entity_uid"] == "album-1"


def test_remote_deleted_items_are_marked_stale(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="track-1",
        entity_type="track",
        title="Wring It Out",
        artist="Rival Schools",
        album="Pedals",
        deleted=True,
    )

    source = next(iter_remote_sources())

    assert source["source_deleted_at"] is not None
    assert source["source_stale"] is True


def test_catalog_manifest_items_expose_content_facets(pg_db):
    from crate.api.federation import _catalog_manifest_items
    from crate.db.tx import transaction_scope
    from crate.genre_taxonomy import core_genre_uid, get_core_taxonomy_descriptor

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    pg_db.upsert_artist(
        {
            "name": "Birds In Row",
            "entity_uid": artist_uid,
            "has_photo": 1,
        }
    )
    pg_db.set_artist_genres("Birds In Row", [("screamo", 1.0, "test")])
    album_id = pg_db.upsert_album(
        {
            "artist": "Birds In Row",
            "name": "We Already Lost the World",
            "entity_uid": album_uid,
            "path": "/music/Birds In Row/We Already Lost the World",
            "has_cover": 1,
            "track_count": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Birds In Row",
            "album": "We Already Lost the World",
            "filename": "01 - We Count So We Don't Have To Listen.flac",
            "title": "We Count So We Don't Have To Listen",
            "entity_uid": track_uid,
            "path": "/music/Birds In Row/We Already Lost the World/01.flac",
            "duration": 180.0,
        }
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET bpm = 142,
                    energy = 0.86,
                    danceability = 0.62,
                    valence = 0.48,
                    acousticness = 0.12,
                    instrumentalness = 0.02,
                    format = 'flac',
                    bitrate = 949964,
                    sample_rate = 44100,
                    bit_depth = 16,
                    size = 31767318
                WHERE entity_uid = :track_uid
                """
            ),
            {"track_uid": track_uid},
        )

    items = _catalog_manifest_items(page=0, page_size=50)
    by_type = {item["entity_type"]: item for item in items}

    assert by_type["artist"]["facets"]["metadata"]["available"] is True
    assert by_type["artist"]["facets"]["artist_photo"]["available"] is True
    assert by_type["artist"]["facets"]["artist_info"]["available"] is True
    assert by_type["artist"]["genres"] == ["screamo"]
    assert by_type["artist"]["genre_assertions"] == [
        {
            "raw_label": "screamo",
            "weight": 1.0,
            "confidence": 1.0,
            "is_direct": True,
            "global_genre_uid": core_genre_uid("screamo"),
            "canonical_slug": "screamo",
            "taxonomy": {
                "id": get_core_taxonomy_descriptor()["taxonomy_id"],
                "version": get_core_taxonomy_descriptor()["version"],
                "digest": get_core_taxonomy_descriptor()["digest"],
            },
        }
    ]
    assert by_type["album"]["facets"]["album_detail"]["available"] is True
    assert by_type["album"]["facets"]["album_artwork"]["available"] is True
    assert by_type["track"]["facets"]["track_info"]["available"] is True
    assert by_type["track"]["facets"]["playback"]["available"] is True
    assert by_type["track"]["bpm"] == 142.0
    assert by_type["track"]["energy"] == 0.86
    assert by_type["track"]["danceability"] == 0.62
    assert by_type["track"]["valence"] == 0.48
    assert by_type["track"]["acousticness"] == 0.12
    assert by_type["track"]["format"] == "flac"
    assert by_type["track"]["bitrate"] == 949
    assert by_type["track"]["sample_rate"] == 44100
    assert by_type["track"]["bit_depth"] == 16
    assert by_type["track"]["size_bytes"] == 31767318


def test_catalog_manifest_hides_all_genre_evidence_without_metadata_grant(
    monkeypatch,
):
    import asyncio

    from crate.api import federation

    async def fake_peer(_request):
        return {"node_uid": "peer", "default_grant_preset": "catalog"}

    monkeypatch.setattr(federation, "_require_signed_node_request", fake_peer)
    monkeypatch.setattr(federation, "_require_capability", lambda *_args: None)
    monkeypatch.setattr(federation, "_peer_has_capability", lambda *_args: False)
    def fake_items(*, include_genres: bool, **_kwargs):
        item = {"entity_type": "artist", "remote_entity_uid": "artist-1"}
        if include_genres:
            item["genres"] = ["screamo"]
            item["genre_assertions"] = [{"raw_label": "screamo"}]
        return [item]

    monkeypatch.setattr(federation, "_catalog_manifest_items", fake_items)

    response = asyncio.run(federation.catalog_manifest(object()))

    assert "taxonomy" not in response
    assert response["items"] == [
        {
            "entity_type": "artist",
            "remote_entity_uid": "artist-1",
        }
    ]


def test_remote_sources_preserve_manifest_facets(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    facets = {
        "metadata": {"available": True, "revision": "artist-rev"},
        "artist_photo": {"available": True, "revision": "photo-rev"},
        "artist_info": {"available": True, "revision": "info-rev"},
    }
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="artist-1",
        entity_type="artist",
        title="High Vis",
        raw_json={"facets": facets},
    )

    source = next(iter_remote_sources())

    assert source["source_payload"]["facets"] == facets


def test_remote_sources_preserve_manifest_genres(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="artist-1",
        entity_type="artist",
        title="High Vis",
        raw_json={
            "genres": ["post-punk", "punk rock"],
            "facets": {"artist_info": {"available": True}},
        },
    )

    source = next(iter_remote_sources())

    assert source["source_payload"]["genres"] == ["post-punk", "punk rock"]


def test_remote_sources_preserve_manifest_audio_features(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="track-1",
        entity_type="track",
        title="Talk For Hours",
        artist="High Vis",
        album="Guided Tour",
        raw_json={
            "bpm": 142,
            "energy": 0.86,
            "danceability": 0.62,
            "valence": 0.48,
            "acousticness": 0.12,
            "instrumentalness": 0.02,
        },
    )

    source = next(iter_remote_sources())

    assert source["source_payload"]["bpm"] == 142
    assert source["source_payload"]["energy"] == 0.86
    assert source["source_payload"]["danceability"] == 0.62
    assert source["source_payload"]["valence"] == 0.48
    assert source["source_payload"]["acousticness"] == 0.12


def test_remote_sources_preserve_manifest_quality(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="track-1",
        entity_type="track",
        title="Guided Tour",
        artist="High Vis",
        album="Guided Tour",
        raw_json={
            "format": "flac",
            "bitrate": 949,
            "sample_rate": 44100,
            "bit_depth": 16,
            "size_bytes": 31767318,
        },
    )

    source = next(iter_remote_sources())

    assert source["source_payload"]["format"] == "flac"
    assert source["source_payload"]["bitrate"] == 949
    assert source["source_payload"]["sample_rate"] == 44100
    assert source["source_payload"]["bit_depth"] == 16
    assert source["source_payload"]["size_bytes"] == 31767318


def test_remote_artist_photo_availability_comes_from_manifest_facets(pg_db):
    from crate.federation.global_sources import iter_remote_sources

    node_uid = str(uuid.uuid4())
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid="artist-1",
        entity_type="artist",
        title="High Vis",
        raw_json={
            "facets": {
                "artist_photo": {"available": True, "revision": "photo-rev"}
            }
        },
    )

    source = next(iter_remote_sources())

    assert source["source_payload"]["has_photo"] is True


def test_remote_reconciliation_refreshes_existing_artist_photo_flag(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.db.tx import transaction_scope
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    node_uid = str(uuid.uuid4())
    remote_entity_uid = "artist-1"
    _insert_remote_item(
        node_uid=node_uid,
        remote_entity_uid=remote_entity_uid,
        entity_type="artist",
        title="High Vis",
    )
    reconcile_remote_catalog(node_uid=node_uid)
    assert search_global_catalog("High Vis", 10)["artists"][0]["has_photo"] is False

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE federation_catalog_items
                SET raw_json = :raw_json, remote_revision = 'rev-2'
                WHERE node_uid = :node_uid
                  AND remote_entity_uid = :remote_entity_uid
                  AND entity_type = 'artist'
                """
            ),
            {
                "node_uid": node_uid,
                "remote_entity_uid": remote_entity_uid,
                "raw_json": json.dumps(
                    {
                        "facets": {
                            "artist_photo": {
                                "available": True,
                                "revision": "photo-rev",
                            }
                        }
                    }
                ),
            },
        )

    reconcile_remote_catalog(node_uid=node_uid)

    assert search_global_catalog("High Vis", 10)["artists"][0]["has_photo"] is True
