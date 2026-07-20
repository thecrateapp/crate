import json
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import approve_federation_node, PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_local_track(pg_db):
    pg_db.upsert_artist({"name": "Birds In Row"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Birds In Row",
            "name": "Gris Klein",
            "path": "/music/Birds In Row/Gris Klein",
            "year": "2022",
            "track_count": 1,
            "has_cover": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Birds In Row",
            "album": "Gris Klein",
            "filename": "01 - Noah.flac",
            "title": "Noah",
            "path": "/music/Birds In Row/Gris Klein/01 - Noah.flac",
            "duration": 175.0,
        }
    )


def _insert_remote_catalog_items(*, stale_track: bool = False) -> tuple[str, str]:
    from crate.db.tx import transaction_scope

    node_uid = str(uuid.uuid4())
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    rows = [
        (artist_uid, "artist", "High Vis", None, None, None, None, False),
        (album_uid, "album", "Blending", "High Vis", None, "2022", None, False),
        (
            track_uid,
            "track",
            "Talk For Hours",
            "High Vis",
            "Blending",
            "2022",
            183,
            stale_track,
        ),
    ]
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
        for (
            remote_entity_uid,
            entity_type,
            title,
            artist,
            album,
            year,
            duration,
            stale,
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
                            deleted_at,
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
                            CASE WHEN :stale THEN NOW() ELSE NULL END,
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
                    "stale": stale,
                    "availability_json": json.dumps({"catalog": True, "stream": True}),
                    "raw_json": json.dumps({"fixture": True}),
                },
            )
    return node_uid, track_uid


def test_resolve_global_track_playback_prefers_local_source(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.federation.global_playback import resolve_global_track_playback
    from crate.federation.global_reconciliation import reconcile_local_catalog

    _seed_local_track(pg_db)
    reconcile_local_catalog()
    track_uid = search_global_catalog("Noah", 10)["tracks"][0]["global_track_uid"]

    selection = resolve_global_track_playback(track_uid)

    assert selection["kind"] == "local"
    assert selection["local_track_id"]
    assert selection["local_track_entity_uid"]


def test_resolve_global_track_playback_selects_healthy_remote_source(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.federation.global_playback import resolve_global_track_playback
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    node_uid, remote_track_uid = _insert_remote_catalog_items()
    reconcile_remote_catalog()
    track_uid = search_global_catalog("Talk For Hours", 10)["tracks"][0][
        "global_track_uid"
    ]

    selection = resolve_global_track_playback(track_uid)

    assert selection == {
        "kind": "remote",
        "node_uid": node_uid,
        "remote_entity_uid": remote_track_uid,
    }


def test_resolve_global_track_playback_rejects_stale_remote_source(pg_db):
    from crate.db.queries.global_catalog import search_global_catalog
    from crate.db.tx import transaction_scope
    from crate.federation.global_playback import NoPlayableGlobalTrack
    from crate.federation.global_playback import resolve_global_track_playback
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    node_uid, remote_track_uid = _insert_remote_catalog_items()
    reconcile_remote_catalog()
    track_uid = search_global_catalog("Talk For Hours", 10)["tracks"][0][
        "global_track_uid"
    ]
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_sources
                SET source_stale = TRUE
                WHERE node_uid = CAST(:node_uid AS uuid)
                  AND remote_entity_uid = :remote_entity_uid
                  AND entity_type = 'track'
                """
            ),
            {"node_uid": node_uid, "remote_entity_uid": remote_track_uid},
        )

    with pytest.raises(NoPlayableGlobalTrack):
        resolve_global_track_playback(track_uid)


def test_catalog_track_playback_endpoint_uses_local_playback_payload(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_track_playback",
            lambda uid: {
                "kind": "local",
                "local_track_id": 12,
                "local_track_entity_uid": "track-local-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.get_track_delivery_row_by_entity_uid",
            lambda entity_uid: {"entity_uid": entity_uid, "id": 12},
        )
        monkeypatch.setattr(
            "crate.api.catalog._playback_payload_for_track",
            lambda track, delivery, **_kwargs: {
                "stream_url": f"/api/tracks/by-entity/{track['entity_uid']}/stream",
                "requested_policy": delivery,
                "effective_policy": delivery,
                "source": {"format": "flac"},
                "delivery": {"format": "flac"},
                "transcoded": False,
                "cache_hit": False,
                "preparing": False,
                "task_id": None,
                "variant_id": None,
                "variant_status": None,
                "content_origin": "local",
            },
        )
        monkeypatch.setattr(
            "crate.playback_provenance.issue_playback_session",
            lambda **_kwargs: "playback-session",
        )

        response = test_app.get(
            f"/api/catalog/tracks/{uuid.uuid4()}/playback?delivery=balanced"
        )

    assert response.status_code == 200
    assert response.json()["stream_url"] == "/api/tracks/by-entity/track-local-1/stream"
    assert response.json()["requested_policy"] == "balanced"


def test_catalog_track_playback_endpoint_creates_remote_ticket(test_app):
    captured: dict = {}
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_track_playback",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-a",
                "remote_entity_uid": "remote-track-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_remote_playback",
            lambda node_uid, remote_entity_uid, request, **kwargs: (
                captured.update(kwargs)
                or {
                    "stream_url": "/api/federation/remote/streams/ticket-1",
                    "expires_at": "2026-07-10T10:00:00Z",
                    "delivery_policy": "data_saver",
                    "playback_session": "session-token",
                    "content_origin": "remote",
                }
            ),
        )

        response = test_app.get(
            f"/api/catalog/tracks/{uuid.uuid4()}/playback?delivery=data_saver"
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["stream_url"] == "/api/federation/remote/streams/ticket-1"
    assert captured["requested_policy"] == "data_saver"
    assert payload["requested_policy"] == "data_saver"
    assert payload["effective_policy"] == "data_saver"
    assert payload["source"]["format"] == "remote"


def test_catalog_track_playback_endpoint_preserves_remote_quality(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_track_playback",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-a",
                "remote_entity_uid": "remote-track-1",
                "quality": {
                    "format": "flac",
                    "bitrate": 949,
                    "sample_rate": 44100,
                    "bit_depth": 16,
                    "size_bytes": 31767318,
                },
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_remote_playback",
            lambda node_uid, remote_entity_uid, request, **_kwargs: {
                "stream_url": "/api/federation/remote/streams/ticket-1",
                "expires_at": "2026-07-10T10:00:00Z",
                "delivery_policy": "balanced",
                "playback_session": "session-token",
                "content_origin": "remote",
            },
        )

        response = test_app.get(
            f"/api/catalog/tracks/{uuid.uuid4()}/playback?delivery=balanced"
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"]["format"] == "flac"
    assert payload["source"]["bitrate"] == 949
    assert payload["source"]["sample_rate"] == 44100
    assert payload["source"]["bit_depth"] == 16
    assert payload["source"]["bytes"] == 31767318


def test_catalog_track_stream_endpoint_redirects_to_resolved_stream(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_track_playback",
            lambda uid: {
                "kind": "remote",
                "node_uid": "node-a",
                "remote_entity_uid": "remote-track-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_remote_playback",
            lambda node_uid, remote_entity_uid, request, **_kwargs: {
                "stream_url": "/api/federation/remote/streams/ticket-1",
                "expires_at": "2026-07-10T10:00:00Z",
                "delivery_policy": "balanced",
                "playback_session": "session-token",
                "content_origin": "remote",
            },
        )

        response = test_app.get(
            f"/api/catalog/tracks/{uuid.uuid4()}/stream?delivery=balanced",
            follow_redirects=False,
        )

    assert response.status_code == 307
    assert response.headers["location"] == "/api/federation/remote/streams/ticket-1"


def test_catalog_track_eq_features_endpoint_delegates_to_local_track(test_app):
    global_uid = str(uuid.uuid4())

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_track_info",
            lambda uid: {
                "global_track_uid": uid,
                "local_track_id": 12,
                "local_track_entity_uid": "track-local-1",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.api_eq_features_by_entity_uid",
            lambda request, entity_uid: {
                "energy": 0.7,
                "loudness": -8.0,
                "dynamicRange": 9.5,
                "brightness": 0.4,
                "danceability": None,
                "valence": None,
                "acousticness": None,
                "instrumentalness": None,
            },
        )

        response = test_app.get(f"/api/catalog/tracks/{global_uid}/eq-features")

    assert response.status_code == 200
    assert response.json()["energy"] == 0.7


def test_catalog_track_effective_eq_endpoint_returns_flat_for_remote_only_track(
    test_app,
):
    global_uid = str(uuid.uuid4())

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_track_info",
            lambda uid: {
                "global_track_uid": uid,
                "local_track_id": None,
                "local_track_entity_uid": None,
            },
        )

        response = test_app.get(f"/api/catalog/tracks/{global_uid}/eq")

    assert response.status_code == 200
    payload = response.json()
    assert payload["trackId"] == 0
    assert payload["gains"] == [0.0] * 10
    assert payload["source"] == "unavailable"


def test_catalog_track_info_endpoint_returns_remote_global_metadata(test_app):
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_track_info",
            lambda uid: {
                "global_track_uid": uid,
                "local_track_id": None,
                "local_track_entity_uid": None,
                "title": "Drop Me Out",
                "artist": "High Vis",
                "album": "Guided Tour",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_source",
            lambda **_kwargs: {"kind": "local"},
        )

        response = test_app.get(f"/api/catalog/tracks/{uuid.uuid4()}/info")

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "Drop Me Out"
    assert payload["artist"] == "High Vis"
    assert payload["album"] == "Guided Tour"
    assert payload["entity_uid"] is None


def test_catalog_track_info_endpoint_hydrates_remote_track_info_facet(test_app):
    global_uid = str(uuid.uuid4())

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_track_info",
            lambda uid: {
                "global_track_uid": uid,
                "local_track_id": None,
                "local_track_entity_uid": None,
                "entity_uid": None,
                "title": "69 Guns",
                "artist": "Rival Schools",
                "album": "Found",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_source",
            lambda **kwargs: {
                "kind": "remote",
                "entity_type": kwargs["entity_type"],
                "global_entity_uid": kwargs["global_entity_uid"],
                "node_uid": "node-b",
                "remote_entity_uid": "remote-track-1",
                "source_revision": "rev-1",
                "facet": kwargs["facet"],
                "facet_payload": {"available": True, "revision": "rev-1"},
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.get_or_fetch_remote_json_facet",
            lambda selection, request: {
                "format": "FLAC",
                "bitrate": 920,
                "sample_rate": 44100,
                "energy": 0.72,
                "genre": "Post-hardcore",
                "node_uid": "node-b",
                "remote_entity_uid": "remote-track-1",
                "path": "/music/Rival Schools/Found/69 Guns.flac",
            },
        )

        response = test_app.get(f"/api/catalog/tracks/{global_uid}/info")

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "69 Guns"
    assert payload["format"] == "FLAC"
    assert payload["bitrate"] == 920
    assert payload["energy"] == 0.72
    assert payload["genre"] == "Post-hardcore"
    assert "node_uid" not in payload
    assert "remote_entity_uid" not in payload
    assert "path" not in payload


def test_catalog_track_genre_endpoint_uses_remote_track_info_facet(test_app):
    global_uid = str(uuid.uuid4())

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "crate.api.catalog.get_global_track_info",
            lambda uid: {
                "global_track_uid": uid,
                "local_track_id": None,
                "local_track_entity_uid": None,
                "entity_uid": None,
                "title": "Talk For Hours",
                "artist": "High Vis",
                "album": "Blending",
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.get_global_track_genres",
            lambda _uid: None,
        )
        monkeypatch.setattr(
            "crate.api.catalog.resolve_global_source",
            lambda **kwargs: {
                "kind": "remote",
                "entity_type": kwargs["entity_type"],
                "global_entity_uid": kwargs["global_entity_uid"],
                "node_uid": "node-b",
                "remote_entity_uid": "remote-track-1",
                "source_revision": "rev-1",
                "facet": kwargs["facet"],
                "facet_payload": {"available": True, "revision": "rev-1"},
            },
        )
        monkeypatch.setattr(
            "crate.api.catalog.get_or_fetch_remote_json_facet",
            lambda selection, request: {"genre": "Nordic Icecore"},
        )

        response = test_app.get(f"/api/catalog/tracks/{global_uid}/genre")

    assert response.status_code == 200
    payload = response.json()
    assert payload["primary"] == {
        "slug": "nordic-icecore",
        "name": "Nordic Icecore",
        "canonical": False,
    }
    assert payload["topLevel"] is None
    assert payload["source"] == "track"
    assert payload["preset"] is None


def test_catalog_track_genre_does_not_mask_canonical_query_failures(monkeypatch):
    from types import SimpleNamespace

    from crate.api import catalog

    monkeypatch.setattr(catalog, "_require_auth", lambda _request: {"id": 1})

    def fail(_global_track_uid):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(catalog, "get_global_track_genres", fail)

    with pytest.raises(RuntimeError, match="database unavailable"):
        catalog.catalog_track_genre(SimpleNamespace(), str(uuid.uuid4()))
