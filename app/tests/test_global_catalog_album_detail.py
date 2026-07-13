import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local_album(pg_db):
    pg_db.upsert_artist({"name": "High Vis"})
    album_id = pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "year": "2022",
            "track_count": 1,
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
            "duration": 183.0,
        }
    )


def _insert_remote_album():
    from crate.db.tx import transaction_scope

    node_uid = str(uuid.uuid4())
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    rows = [
        (artist_uid, "artist", "High Vis", None, None, None, None, {}),
        (album_uid, "album", "No Sense No Feeling", "High Vis", None, "2019", None, {}),
        (
            track_uid,
            "track",
            "Choose To Lose",
            "High Vis",
            "No Sense No Feeling",
            "2019",
            190,
            {
                "format": "flac",
                "bitrate": 949,
                "sample_rate": 44100,
                "bit_depth": 16,
                "size_bytes": 31767318,
            },
        ),
    ]
    with transaction_scope() as session:
        for (
            remote_entity_uid,
            entity_type,
            title,
            artist,
            album,
            year,
            duration,
            raw_json,
        ) in rows:
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
                            remote_revision,
                            availability_json,
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
                            'rev-1',
                            :availability_json,
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
                    "duration_seconds": duration,
                    "availability_json": json.dumps({"catalog": True, "stream": True}),
                    "raw_json": json.dumps({"fixture": True, **raw_json}),
                },
            )


def test_global_album_detail_returns_local_album_payload(pg_db):
    from crate.db.queries.global_catalog import get_global_album_detail, search_global_catalog
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_album(pg_db)
    reconcile_local_catalog()
    album_uid = search_global_catalog("Blending", 10)["albums"][0]["global_album_uid"]

    payload = get_global_album_detail(album_uid)

    assert payload["name"] == "Blending"
    assert payload["artist"] == "High Vis"
    assert payload["tracks"][0]["title"] == "Talk For Hours"
    assert payload["tracks"][0]["global_track_uid"]
    assert payload["availability"]["local"] is True


def test_global_album_detail_returns_remote_album_without_node_labels(pg_db):
    from crate.db.queries.global_catalog import get_global_album_detail, search_global_catalog
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    _insert_remote_album()
    reconcile_remote_catalog()
    album_uid = search_global_catalog("No Sense", 10)["albums"][0]["global_album_uid"]

    payload = get_global_album_detail(album_uid)

    assert payload["name"] == "No Sense No Feeling"
    assert payload["tracks"][0]["title"] == "Choose To Lose"
    assert payload["tracks"][0]["availability"]["remote"] is True
    assert payload["tracks"][0]["format"] == "flac"
    assert payload["tracks"][0]["bitrate"] == 949
    assert payload["tracks"][0]["sample_rate"] == 44100
    assert payload["tracks"][0]["bit_depth"] == 16
    assert payload["tracks"][0]["size_mb"] == 30
    assert "node_uid" not in payload
    assert "remote_entity_uid" not in payload["tracks"][0]


def test_catalog_album_detail_endpoint(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_album_detail",
            lambda uid: {"name": "Blending", "artist": "High Vis", "tracks": []},
        )

        response = test_app.get(f"/api/catalog/albums/{uuid.uuid4()}")

    assert response.status_code == 200
    assert response.json()["name"] == "Blending"


def test_catalog_album_detail_endpoint_hydrates_remote_album_facet(test_app):
    global_uid = str(uuid.uuid4())

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_album_detail",
            lambda uid: {
                "global_album_uid": uid,
                "local_album_id": None,
                "local_album_entity_uid": None,
                "name": "Found",
                "artist": "Rival Schools",
                "genre": "",
                "tracks": [
                    {
                        "globalTrackUid": "track-global-1",
                        "title": "69 Guns",
                        "track_number": 1,
                        "disc_number": 1,
                        "format": "",
                        "tags": {"genre": ""},
                    }
                ],
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_source",
            lambda **kwargs: {
                "kind": "remote",
                "entity_type": kwargs["entity_type"],
                "global_entity_uid": kwargs["global_entity_uid"],
                "node_uid": "node-b",
                "remote_entity_uid": "remote-album-1",
                "source_revision": "rev-1",
                "facet": kwargs["facet"],
                "facet_payload": {"available": True, "revision": "rev-1"},
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.get_or_fetch_remote_json_facet",
            lambda selection, request: {
                "genre": "Post-hardcore",
                "remote_entity_uid": "remote-album-1",
                "tracks": [
                    {
                        "entity_uid": "remote-track-1",
                        "title": "69 Guns",
                        "track_number": 1,
                        "disc_number": 1,
                        "format": "FLAC",
                        "genre": "Post-hardcore",
                    }
                ],
            },
        )

        response = test_app.get(f"/api/catalog/albums/{global_uid}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["genre"] == "Post-hardcore"
    assert payload["tracks"][0]["format"] == "FLAC"
    assert payload["tracks"][0]["tags"]["genre"] == "Post-hardcore"
    assert "remote_entity_uid" not in payload
    assert "entity_uid" not in payload["tracks"][0]


def test_catalog_album_cover_endpoint_uses_local_artwork_source(test_app):
    from fastapi.responses import Response

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_album_artwork",
            lambda uid: {
                "kind": "local",
                "local_album_id": 12,
                "local_album_entity_uid": "album-local-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.api_cover_by_entity_uid",
            lambda entity_uid, size=None, image_format=None: Response(
                content=b"local-cover",
                media_type="image/jpeg",
                headers={"X-Album-Entity": entity_uid},
            ),
        )

        response = test_app.get(f"/api/catalog/albums/{uuid.uuid4()}/cover?size=256")

    assert response.status_code == 200
    assert response.content == b"local-cover"
    assert response.headers["x-album-entity"] == "album-local-1"


def test_catalog_album_cover_endpoint_uses_remote_artwork_source(test_app):
    from fastapi.responses import Response

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_album_artwork",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-b",
                "remote_entity_uid": "remote-album-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.remote_album_cover",
            lambda node_uid,
            remote_entity_uid,
            request,
            size=None,
            image_format=None,
            selection=None: Response(
                content=b"remote-cover",
                media_type="image/jpeg",
                headers={"X-Remote-Album": f"{node_uid}:{remote_entity_uid}"},
            ),
        )

        response = test_app.get(f"/api/catalog/albums/{uuid.uuid4()}/cover?size=256")

    assert response.status_code == 200
    assert response.content == b"remote-cover"
    assert response.headers["x-remote-album"] == "node-b:remote-album-1"
