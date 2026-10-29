"""Regression contracts for unified radio endpoints."""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

SESSION_ID = "11111111-1111-4111-8111-111111111111"


class TestRadioApiContracts:
    def test_global_radio_dislike_accepts_a_canonical_track_uid(self, test_app):
        with (
            patch("crate.radio_engine.get_session_user_id", return_value=1),
            patch(
                "crate.radio_engine.radio_feedback",
                return_value={"status": "ok", "effect": "exclusion_added"},
            ) as feedback,
        ):
            resp = test_app.post(
                "/api/radio/feedback",
                json={
                    "session_id": SESSION_ID,
                    "global_track_uid": "global-track-1",
                    "action": "dislike",
                },
            )

        assert resp.status_code == 200
        assert resp.json()["effect"] == "exclusion_added"
        feedback.assert_called_once_with(
            SESSION_ID, None, "dislike", global_track_uid="global-track-1"
        )

    def test_radio_feedback_requires_a_local_or_global_track_reference(self, test_app):
        resp = test_app.post(
            "/api/radio/feedback",
            json={"session_id": SESSION_ID, "action": "dislike"},
        )

        assert resp.status_code == 422

    def test_radio_stations_returns_personalized_station_groups(self, test_app):
        payload = {
            "artist_stations": [
                {
                    "type": "artist",
                    "seed_type": "artist",
                    "seed_value": "7",
                    "seed_label": "Converge",
                    "seed_subtitle": "Artist",
                    "artist_id": 7,
                    "artist_name": "Converge",
                    "title": "Converge Radio",
                    "subtitle": "",
                    "play_count": 44,
                    "minutes_listened": 180,
                }
            ],
            "genre_stations": [
                {
                    "type": "genre",
                    "seed_type": "genre",
                    "seed_value": "hardcore",
                    "seed_label": "hardcore",
                    "seed_subtitle": "Genre",
                    "genre_slug": "hardcore",
                    "genre_name": "hardcore",
                    "cover_url": "/api/genres/hardcore/cover?size=640&format=webp",
                    "title": "hardcore Radio",
                    "subtitle": "",
                    "play_count": 88,
                    "minutes_listened": 320,
                }
            ],
        }

        with patch(
            "crate.api.radio.get_user_radio_stations", return_value=payload
        ) as get_stations:
            resp = test_app.get("/api/radio/stations")

        assert resp.status_code == 200
        assert resp.json() == payload
        get_stations.assert_called_once_with(1)

    def test_artist_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 42,
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": 0.92,
            }
        ]

        with (
            patch(
                "crate.api.radio.get_library_artist_by_id",
                return_value={"id": 7, "name": "Converge", "slug": "converge"},
            ),
            patch("crate.api.radio.generate_artist_radio", return_value=tracks),
            patch(
                "crate.api.radio._enrich_radio_tracks", side_effect=lambda rows: rows
            ),
        ):
            resp = test_app.get("/api/artists/7/radio?limit=25")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "artist"
        assert data["session"]["name"] == "Converge Radio"
        assert data["session"]["seed"]["artist_id"] == 7
        # Tracks may have extra keys added by the serializer (for example path);
        # verify core fields rather than exact equality.
        assert len(data["tracks"]) == len(tracks)
        assert data["tracks"][0]["title"] == tracks[0]["title"]

    def test_track_radio_accepts_track_id_and_returns_tracks(self, test_app):
        tracks = [
            {
                "track_id": 99,
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": None,
            },
            {
                "track_id": 123,
                "track_path": "Botch/We Are the Romans/02 - To Our Friends in the Great White North.flac",
                "title": "To Our Friends in the Great White North",
                "artist": "Botch",
                "album": "We Are the Romans",
                "duration": 181.0,
                "score": 0.88,
            },
        ]

        with (
            patch(
                "crate.api.radio._resolve_track_path",
                return_value="/music/Converge/Jane Doe/01 - Concubine.flac",
            ),
            patch("crate.api.radio.generate_track_radio", return_value=tracks),
            patch(
                "crate.api.radio._enrich_radio_tracks", side_effect=lambda rows: rows
            ),
        ):
            resp = test_app.get("/api/radio/track?track_id=99&limit=50")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "track"
        assert data["session"]["seed"]["track_id"] == 99
        assert (
            data["session"]["seed"]["track_path"]
            == "Converge/Jane Doe/01 - Concubine.flac"
        )
        assert data["tracks"][1]["artist"] == "Botch"

    def test_track_radio_accepts_entity_uid_and_returns_seed_identity(self, test_app):
        tracks = [
            {
                "track_id": 99,
                "track_entity_uid": "123e4567-e89b-12d3-a456-426614174000",
                "track_storage_id": "123e4567-e89b-12d3-a456-426614174099",
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": None,
            },
        ]

        with (
            patch("crate.api.radio.get_cache", return_value=None),
            patch("crate.api.radio.set_cache"),
            patch(
                "crate.api.radio._resolve_track_path",
                return_value="/music/Converge/Jane Doe/01 - Concubine.flac",
            ),
            patch("crate.api.radio.generate_track_radio", return_value=tracks),
            patch(
                "crate.api.radio._enrich_radio_tracks", side_effect=lambda rows: rows
            ),
        ):
            resp = test_app.get(
                "/api/radio/track?entity_uid=123e4567-e89b-12d3-a456-426614174000&limit=50"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert (
            data["session"]["seed"]["track_entity_uid"]
            == "123e4567-e89b-12d3-a456-426614174000"
        )
        assert "track_storage_id" not in data["session"]["seed"]
        assert (
            data["tracks"][0]["track_entity_uid"]
            == "123e4567-e89b-12d3-a456-426614174000"
        )
        assert "track_storage_id" not in data["tracks"][0]

    def test_album_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 10,
                "track_path": "Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 94.0,
                "score": None,
            }
        ]

        with (
            patch(
                "crate.api.radio.get_album_for_radio",
                return_value={
                    "artist": "Converge",
                    "name": "Jane Doe",
                },
            ),
            patch("crate.api.radio.generate_album_radio", return_value=tracks),
            patch(
                "crate.api.radio._enrich_radio_tracks", side_effect=lambda rows: rows
            ),
        ):
            resp = test_app.get("/api/radio/album/5?limit=50")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "album"
        assert data["session"]["seed"]["album_id"] == 5
        assert data["tracks"][0]["album"] == "Jane Doe"

    def test_playlist_radio_returns_session_and_tracks(self, test_app):
        tracks = [
            {
                "track_id": 77,
                "track_path": "Converge/Jane Doe/11 - Jane Doe.flac",
                "title": "Jane Doe",
                "artist": "Converge",
                "album": "Jane Doe",
                "duration": 690.0,
                "score": 0.84,
            }
        ]

        with (
            patch(
                "crate.api.radio.get_playlist_for_radio",
                return_value={
                    "id": 7,
                    "name": "Hardcore",
                    "scope": "system",
                    "user_id": None,
                    "is_active": True,
                },
            ),
            patch("crate.api.radio.generate_playlist_radio", return_value=tracks),
            patch(
                "crate.api.radio._enrich_radio_tracks", side_effect=lambda rows: rows
            ),
        ):
            resp = test_app.get("/api/radio/playlist/7?limit=50")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session"]["type"] == "playlist"
        assert data["session"]["seed"]["playlist_id"] == 7
        assert data["tracks"][0]["title"] == "Jane Doe"

    def test_playlist_radio_hides_inactive_system_playlists(self, test_app):
        with patch(
            "crate.api.radio.get_playlist_for_radio",
            return_value={
                "id": 12,
                "name": "Hidden Editorial",
                "scope": "system",
                "user_id": None,
                "is_active": False,
            },
        ):
            resp = test_app.get("/api/radio/playlist/12?limit=50")

        assert resp.status_code == 404

    def test_radio_endpoints_clamp_limit(self, test_app):
        with patch(
            "crate.api.radio.get_library_artist_by_id",
            return_value={"id": 7, "name": "Converge", "slug": "converge"},
        ):
            resp = test_app.get("/api/artists/7/radio?limit=101")
        assert resp.status_code == 422


def test_indexed_radio_contracts_are_named_and_cookie_authenticated(test_app):
    paths = test_app.get("/openapi.json").json()["paths"]
    for path in ("/api/radio/start", "/api/radio/next"):
        operation = paths[path]["post"]
        assert operation["tags"] == ["radio"]
        assert {"cookieAuth": []} in operation["security"]
        assert operation["responses"]["200"]["content"]["application/json"]["schema"][
            "$ref"
        ].endswith("/RadioBatchResponse")


def test_indexed_next_resolves_proxy_identity_and_rejects_missing_id(
    test_app, monkeypatch
):
    from crate.api import radio
    from crate import radio_continuation

    calls = []
    monkeypatch.setattr(
        radio, "_require_auth", lambda _: {"id": None, "email": "proxy@test.invalid"}
    )
    monkeypatch.setattr(radio, "get_user_by_email", lambda _: None)
    monkeypatch.setattr(
        radio_continuation,
        "next_batch",
        lambda *args, **kwargs: (
            calls.append(kwargs)
            or {
                "session_id": SESSION_ID,
                "tracks": [],
                "status": "retryable_empty",
                "exhausted": False,
            }
        ),
    )
    assert (
        test_app.post(
            "/api/radio/next", json={"session_id": SESSION_ID, "batch_index": 1}
        ).status_code
        == 401
    )
    assert calls == []
    monkeypatch.setattr(radio, "get_user_by_email", lambda _: {"id": 7})
    assert (
        test_app.post(
            "/api/radio/next", json={"session_id": SESSION_ID, "batch_index": 1}
        ).status_code
        == 200
    )
    assert calls[0]["user_id"] == 7


def test_legacy_shaped_start_does_not_expose_a_private_playlist(test_app, monkeypatch):
    from crate.api import radio

    monkeypatch.setattr(
        radio,
        "get_playlist_for_radio",
        lambda _: {"scope": "user", "user_id": 999, "name": "Private"},
    )
    monkeypatch.setattr(radio, "_require_auth", lambda _: {"id": 1, "role": "user"})
    response = test_app.post(
        "/api/radio/start", json={"seed_type": "playlist", "seed_value": "42"}
    )
    assert response.status_code == 403
    assert "Private" not in response.text


def test_native_seeded_descriptor_cannot_use_a_redis_internal_key(test_app):
    response = test_app.post(
        "/api/playback/continuation-token",
        json={
            "descriptor": {
                "kind": "seeded_radio",
                "seedType": "album",
                "seedId": "42",
                "sessionId": f"{SESSION_ID}:lock",
            }
        },
    )
    assert response.status_code == 422


def _contended_radio_store(monkeypatch, session_id, *, existing=True, user_id=1):
    from crate import radio_engine

    from tests.test_radio_continuation_contract import MemoryRedis

    redis = MemoryRedis()
    lock_factory = redis.lock
    monkeypatch.setattr(
        redis,
        "lock",
        lambda name, **kwargs: lock_factory(
            name, **{**kwargs, "blocking_timeout": 0.01}
        ),
    )
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    if existing:
        redis.setex(
            f"radio:session:{session_id}",
            60,
            json.dumps(
                {
                    "id": session_id,
                    "user_id": user_id,
                    "track_count": 20,
                    "batch_index": 3,
                    "revision": 1,
                }
            ),
        )
    return redis


@pytest.mark.parametrize("operation", ["next", "feedback", "delete"])
def test_legacy_radio_lease_failure_returns_conflict_with_retry_after(
    test_app, monkeypatch, operation
):
    session_id = str(uuid4())
    redis = _contended_radio_store(monkeypatch, session_id)
    with redis.lock(f"radio:session:{session_id}:lock", timeout=5):
        if operation == "next":
            response = test_app.post(
                "/api/radio/next", json={"session_id": session_id, "count": 1}
            )
        elif operation == "feedback":
            response = test_app.post(
                "/api/radio/feedback",
                json={"session_id": session_id, "track_id": 7, "action": "like"},
            )
        else:
            response = test_app.delete(f"/api/radio/session/{session_id}")

    assert response.status_code == 409
    assert response.headers["retry-after"] == "1"


@pytest.mark.parametrize("operation,cursor", [("start", -1), ("next", 3)])
def test_indexed_radio_contention_returns_a_retryable_committed_cursor(
    test_app, monkeypatch, operation, cursor
):
    session_id = str(uuid4())
    redis = _contended_radio_store(
        monkeypatch, session_id, existing=operation == "next"
    )
    payload = {"session_id": session_id, "count": 1}
    if operation == "next":
        payload["batch_index"] = 4
    with redis.lock(f"radio:session:{session_id}:lock", timeout=5):
        response = test_app.post(f"/api/radio/{operation}", json=payload)

    assert response.status_code == 200
    assert response.json()["tracks"] == []
    assert response.json()["status"] == "retryable_empty"
    assert response.json()["exhausted"] is False
    assert response.json()["batch_index"] == cursor
