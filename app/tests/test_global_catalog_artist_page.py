import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local_artist_album_track(pg_db):
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


def _insert_remote_catalog_items():
    from crate.db.tx import transaction_scope

    node_uid = str(uuid.uuid4())
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_nodes
                    (node_uid, display_name, api_base_url, active_key_id, trust_state)
                VALUES
                    (:node_uid, 'Remote fixture', :api_base_url, 'key-1', 'approved')
                """
            ),
            {
                "node_uid": node_uid,
                "api_base_url": f"https://{node_uid}.example.test",
            },
        )
        for item in (
            {
                "remote_entity_uid": artist_uid,
                "entity_type": "artist",
                "title": "Rival Schools",
                "artist": None,
                "album": None,
                "year": None,
                "duration_seconds": None,
            },
            {
                "remote_entity_uid": album_uid,
                "entity_type": "album",
                "title": "United By Fate",
                "artist": "Rival Schools",
                "album": None,
                "year": "2001",
                "duration_seconds": None,
            },
            {
                "remote_entity_uid": track_uid,
                "entity_type": "track",
                "title": "Used For Glue",
                "artist": "Rival Schools",
                "album": "United By Fate",
                "year": "2001",
                "duration_seconds": 183,
            },
        ):
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
                    "availability_json": json.dumps({"catalog": True, "stream": True}),
                    "raw_json": json.dumps({"fixture": True}),
                    **item,
                },
            )


def test_global_artist_page_returns_local_artist_payload(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_artist_page,
        search_global_catalog,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_artist_album_track(pg_db)
    reconcile_local_catalog()
    artist_uid = search_global_catalog("Rival", 10)["artists"][0]["global_artist_uid"]

    payload = get_global_artist_page(artist_uid)

    assert payload["artist"]["name"] == "Rival Schools"
    assert payload["artist"]["albums"][0]["name"] == "Pedals"
    assert payload["top_tracks"][0]["title"] == "Wring It Out"
    assert payload["artist"]["availability"]["local"] is True


def test_global_artist_page_honors_top_track_limit_without_truncating_total(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_artist_page,
        search_global_catalog,
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    pg_db.upsert_artist({"name": "Many Tracks"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Many Tracks",
            "name": "Complete",
            "path": "/music/Many Tracks/Complete",
            "track_count": 15,
        }
    )
    for number in range(1, 16):
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Many Tracks",
                "album": "Complete",
                "filename": f"{number:02d}.flac",
                "title": f"Track {number:02d}",
                "path": f"/music/Many Tracks/Complete/{number:02d}.flac",
                "track_number": number,
            }
        )
    reconcile_local_catalog()
    artist_uid = search_global_catalog("Many Tracks", 10)["artists"][0][
        "global_artist_uid"
    ]

    payload = get_global_artist_page(artist_uid, top_tracks_limit=14)

    assert len(payload["top_tracks"]) == 14
    assert payload["artist"]["total_tracks"] == 15


def test_global_artist_page_merges_local_and_remote_albums(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_artist_page,
        search_global_catalog,
    )
    from crate.federation.global_reconciliation import (
        reconcile_local_catalog,
        reconcile_remote_catalog,
    )

    _seed_local_artist_album_track(pg_db)
    reconcile_local_catalog()
    _insert_remote_catalog_items()
    reconcile_remote_catalog()
    artist_uid = search_global_catalog("Rival", 10)["artists"][0]["global_artist_uid"]

    payload = get_global_artist_page(artist_uid)

    album_names = {album["name"] for album in payload["artist"]["albums"]}
    track_titles = {track["title"] for track in payload["top_tracks"]}
    assert album_names == {"Pedals", "United By Fate"}
    assert {"Wring It Out", "Used For Glue"} <= track_titles
    assert "node_uid" not in payload["artist"]["albums"][1]
    assert "remote_entity_uid" not in payload["top_tracks"][0]


def test_catalog_artist_page_endpoint(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {"name": "Rival Schools", "albums": []},
                "info": {"similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_source",
            lambda **_kwargs: (_ for _ in ()).throw(
                __import__(
                    "crate.federation.global_source_resolver",
                    fromlist=["NoGlobalSource"],
                ).NoGlobalSource()
            ),
        )

        response = test_app.get(f"/api/catalog/artists/{uuid.uuid4()}/page")

    assert response.status_code == 200
    assert response.json()["artist"]["name"] == "Rival Schools"


def test_catalog_artist_page_endpoint_uses_local_artist_page_source(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {
                    "id": 12,
                    "name": "Birds In Row",
                    "local_artist_entity_uid": "artist-local-1",
                    "global_artist_uid": str(uid),
                },
                "info": {"bio": "", "similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.api_artist_page_by_entity_uid",
            lambda request, entity_uid, **kwargs: {
                "artist": {
                    "id": 12,
                    "entity_uid": entity_uid,
                    "name": "Birds In Row",
                    "albums": [],
                },
                "info": {"bio": "local bio", "similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )

        response = test_app.get(f"/api/catalog/artists/{uuid.uuid4()}/page")

    assert response.status_code == 200
    assert response.json()["info"]["bio"] == "local bio"
    assert response.json()["artist"]["global_artist_uid"]


def test_catalog_artist_page_endpoint_hydrates_remote_artist_info(test_app):
    global_artist_uid = str(uuid.uuid4())

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {
                    "id": None,
                    "name": "High Vis",
                    "local_artist_entity_uid": None,
                    "global_artist_uid": str(uid),
                    "albums": [],
                },
                "info": {"bio": "", "tags": [], "similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_source",
            lambda **kwargs: {
                "kind": "remote",
                "entity_type": "artist",
                "global_entity_uid": kwargs["global_entity_uid"],
                "node_uid": "node-b",
                "remote_entity_uid": "remote-artist-1",
                "source_revision": "rev-1",
                "facet": kwargs["facet"],
                "facet_payload": {"available": True, "revision": "rev-1"},
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.get_or_fetch_remote_json_facet",
            lambda selection, request: {
                "bio": "remote bio",
                "tags": ["post-hardcore"],
                "similar": [{"name": "Militarie Gun"}],
                "top_tracks": [
                    {
                        "title": "Choose To Lose",
                        "album": "No Sense No Feeling",
                    }
                ],
                "shows": {
                    "events": [
                        {
                            "id": "show-1",
                            "artist_name": "High Vis",
                            "venue": "The Dome",
                            "probable_setlist": [{"title": "Choose To Lose"}],
                        }
                    ],
                    "configured": True,
                    "source": "cache",
                },
                "enrichment": {
                    "setlist": {
                        "probable_setlist": [{"title": "Choose To Lose"}],
                        "total_shows": 1,
                    }
                },
            },
        )

        response = test_app.get(f"/api/catalog/artists/{global_artist_uid}/page")

    assert response.status_code == 200
    payload = response.json()
    assert payload["artist"]["name"] == "High Vis"
    assert payload["info"]["bio"] == "remote bio"
    assert payload["info"]["tags"] == ["post-hardcore"]
    assert payload["shows"]["events"][0]["venue"] == "The Dome"
    assert payload["enrichment"]["setlist"]["probable_setlist"][0]["title"] == (
        "Choose To Lose"
    )
    assert "node_uid" not in payload["artist"]


def test_remote_artist_ranking_reorders_global_tracks_without_leaking_remote_ids():
    from crate.api.catalog import _merge_remote_artist_page_sections

    payload = {
        "top_tracks": [
            {
                "id": "global-track-a",
                "global_track_uid": "global-track-a",
                "title": "A Song",
                "album": "Album",
            },
            {
                "id": "global-track-b",
                "global_track_uid": "global-track-b",
                "title": "B Song",
                "album": "Album",
            },
        ],
        "shows": {"events": [], "configured": False, "source": "none"},
        "enrichment": {},
    }
    remote = {
        "top_tracks": [
            {"id": "42", "title": "B Song", "album": "Album"},
            {"id": "41", "title": "A Song", "album": "Album"},
        ]
    }

    merged = _merge_remote_artist_page_sections(payload, remote)

    assert [track["id"] for track in merged["top_tracks"]] == [
        "global-track-b",
        "global-track-a",
    ]


def test_catalog_artist_photo_endpoint_uses_local_artist_source(test_app):
    from fastapi.responses import Response

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {
                    "id": 12,
                    "name": "Birds In Row",
                    "local_artist_entity_uid": "artist-local-1",
                },
                "info": {"similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.api_artist_photo_by_entity_uid",
            lambda request, entity_uid, random_pick=False, size=None, image_format=None: (
                Response(
                    content=b"artist-photo",
                    media_type="image/jpeg",
                    headers={"X-Artist-Entity": entity_uid},
                )
            ),
        )

        response = test_app.get(f"/api/catalog/artists/{uuid.uuid4()}/photo?size=256")

    assert response.status_code == 200
    assert response.content == b"artist-photo"
    assert response.headers["x-artist-entity"] == "artist-local-1"


def test_catalog_artist_photo_endpoint_uses_remote_artist_photo_source(test_app):
    from fastapi.responses import Response

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {
                    "id": None,
                    "name": "High Vis",
                    "local_artist_entity_uid": None,
                    "global_artist_uid": str(uid),
                    "has_photo": True,
                },
                "info": {"similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_artist_photo",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-b",
                "remote_entity_uid": "remote-artist-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.remote_artist_photo",
            lambda node_uid, remote_entity_uid, request, size=None, image_format=None, selection=None: (
                Response(
                    content=b"remote-artist-photo",
                    media_type="image/jpeg",
                    headers={"X-Remote-Artist": f"{node_uid}:{remote_entity_uid}"},
                )
            ),
        )

        response = test_app.get(f"/api/catalog/artists/{uuid.uuid4()}/photo?size=256")

    assert response.status_code == 200
    assert response.content == b"remote-artist-photo"
    assert response.headers["x-remote-artist"] == "node-b:remote-artist-1"


def test_catalog_artist_background_endpoint_uses_remote_background_source(test_app):
    from fastapi.responses import Response

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {
                    "id": None,
                    "name": "High Vis",
                    "local_artist_entity_uid": None,
                    "global_artist_uid": str(uid),
                    "has_photo": True,
                },
                "info": {"similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_artist_background",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-b",
                "remote_entity_uid": "remote-artist-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.remote_artist_background",
            lambda node_uid, remote_entity_uid, request, size=None, image_format=None, selection=None: (
                Response(
                    content=b"remote-artist-background",
                    media_type="image/jpeg",
                    headers={"X-Remote-Artist": f"{node_uid}:{remote_entity_uid}"},
                )
            ),
        )

        response = test_app.get(
            f"/api/catalog/artists/{uuid.uuid4()}/background?size=1280"
        )

    assert response.status_code == 200
    assert response.content == b"remote-artist-background"
    assert response.headers["x-remote-artist"] == "node-b:remote-artist-1"


def test_catalog_artist_background_endpoint_falls_back_to_remote_photo(test_app):
    from fastapi import HTTPException
    from fastapi.responses import Response

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_artist_page",
            lambda uid: {
                "artist": {
                    "id": None,
                    "name": "High Vis",
                    "local_artist_entity_uid": None,
                    "global_artist_uid": str(uid),
                    "has_photo": True,
                },
                "info": {"similar": []},
                "top_tracks": [],
                "shows": {"events": [], "configured": False, "source": "none"},
                "enrichment": {},
                "artist_hot_rank": None,
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_artist_background",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-b",
                "remote_entity_uid": "remote-artist-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.remote_artist_background",
            lambda *args, **kwargs: (_ for _ in ()).throw(
                HTTPException(status_code=404)
            ),
        )
        monkeypatch.setattr(
            "crate.api.catalog.remote_artist_photo",
            lambda node_uid, remote_entity_uid, request, size=None, image_format=None, selection=None: (
                Response(
                    content=b"remote-artist-photo",
                    media_type="image/jpeg",
                    headers={"X-Remote-Artist": f"{node_uid}:{remote_entity_uid}"},
                )
            ),
        )

        response = test_app.get(
            f"/api/catalog/artists/{uuid.uuid4()}/background?size=1280"
        )

    assert response.status_code == 200
    assert response.content == b"remote-artist-photo"
    assert response.headers["x-remote-artist"] == "node-b:remote-artist-1"
