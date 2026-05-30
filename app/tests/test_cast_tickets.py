from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.streaming.policy import BALANCED_POLICY, ORIGINAL_POLICY


def test_cast_ticket_repository_scopes_expiry_and_revocation(
    pg_db, monkeypatch, request
):
    monkeypatch.setenv("CRATE_CAST_TICKET_SECRET", "cast-test-secret")

    from crate.db.repositories.cast_tickets import (
        clear_cast_ticket_secret_cache_for_tests,
        create_cast_ticket,
        get_cast_ticket,
        revoke_cast_ticket,
        verify_cast_ticket_signature,
    )

    request.addfinalizer(clear_cast_ticket_secret_cache_for_tests)
    clear_cast_ticket_secret_cache_for_tests()
    owner = pg_db.create_user("cast-owner@test.com")
    other = pg_db.create_user("cast-other@test.com")

    created = create_cast_ticket(
        owner["id"],
        track_path="Artist/Album/track.mp3",
        purpose="google_cast",
        expires_in_seconds=900,
        delivery_policy="original",
    )

    token = created["ticket"]
    assert verify_cast_ticket_signature(token) is True
    assert created["delivery_policy"] == ORIGINAL_POLICY
    assert get_cast_ticket(token)["user_id"] == owner["id"]
    assert get_cast_ticket(token, user_id=other["id"]) is None
    assert revoke_cast_ticket(other["id"], token) is False
    assert revoke_cast_ticket(owner["id"], token) is True
    assert get_cast_ticket(token) is None

    expired = create_cast_ticket(
        owner["id"],
        track_path="Artist/Album/expired.mp3",
        purpose="google_cast",
    )
    assert expired["delivery_policy"] == "auto"
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE cast_stream_tickets
                SET expires_at = :expires_at
                WHERE ticket_id = :ticket_id
                """
            ),
            {
                "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
                "ticket_id": expired["ticket_id"],
            },
        )

    assert get_cast_ticket(expired["ticket"]) is None
    assert get_cast_ticket(expired["ticket"], include_expired=True) is not None


def test_cast_ticket_secret_is_cached(monkeypatch, request):
    from crate.db.repositories.cast_tickets import (
        _ticket_secret,
        clear_cast_ticket_secret_cache_for_tests,
    )

    request.addfinalizer(clear_cast_ticket_secret_cache_for_tests)
    clear_cast_ticket_secret_cache_for_tests()
    monkeypatch.setenv("CRATE_CAST_TICKET_SECRET", "first-secret")
    assert _ticket_secret() == "first-secret"

    monkeypatch.setenv("CRATE_CAST_TICKET_SECRET", "second-secret")
    assert _ticket_secret() == "first-secret"

    clear_cast_ticket_secret_cache_for_tests()
    assert _ticket_secret() == "second-secret"


def test_cast_ticket_api_creates_auto_receiver_safe_urls(test_app, monkeypatch):
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    track_entity_uid = "11111111-1111-1111-1111-111111111111"
    calls: dict[str, object] = {}

    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_entity_uid",
        lambda _entity_uid: {
            "id": 7,
            "entity_uid": track_entity_uid,
            "path": "Artist/Album/track.flac",
        },
    )

    def fake_create_cast_ticket(user_id: int, **kwargs):
        calls["user_id"] = user_id
        calls.update(kwargs)
        return {
            "ticket": "signed-ticket",
            "expires_at": expires_at,
            "delivery_policy": kwargs["delivery_policy"],
        }

    monkeypatch.setattr("crate.api.cast.create_cast_ticket", fake_create_cast_ticket)

    response = test_app.post(
        "/api/me/cast/tickets",
        json={
            "track_entity_uid": track_entity_uid,
            "purpose": "google_cast",
            "target_device_id": "kitchen-chromecast",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["stream_url"] == ("http://testserver/api/cast/stream/signed-ticket")
    assert data["metadata_url"] == ("http://testserver/api/cast/media/signed-ticket")
    assert data["delivery_policy"] == "auto"
    assert calls["user_id"] == 1
    assert calls["target_device_id"] == "kitchen-chromecast"


def test_cast_ticket_api_accepts_track_path(test_app, monkeypatch):
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    calls: dict[str, object] = {}

    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_path",
        lambda path: {
            "id": 11,
            "entity_uid": "22222222-2222-2222-2222-222222222222",
            "path": path,
        },
    )

    def fake_create_cast_ticket(user_id: int, **kwargs):
        calls["user_id"] = user_id
        calls.update(kwargs)
        return {
            "ticket": "signed-path-ticket",
            "expires_at": expires_at,
            "delivery_policy": kwargs["delivery_policy"],
        }

    monkeypatch.setattr("crate.api.cast.create_cast_ticket", fake_create_cast_ticket)

    response = test_app.post(
        "/api/me/cast/tickets",
        json={
            "track_path": "Artist/Album/path-only.flac",
            "purpose": "google_cast",
        },
    )

    assert response.status_code == 200
    assert calls["track_id"] == 11
    assert calls["track_path"] == "Artist/Album/path-only.flac"
    assert response.json()["delivery_policy"] == "auto"


def test_cast_media_and_stream_use_original_for_cast_safe_source(tmp_path, monkeypatch):
    track_file = tmp_path / "track.mp3"
    track_file.write_bytes(b"0123456789")
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    ticket_payload = {
        "track_id": 7,
        "track_entity_uid": "11111111-1111-1111-1111-111111111111",
        "purpose": "google_cast",
        "delivery_policy": "auto",
        "expires_at": expires_at,
    }
    track = {
        "id": 7,
        "entity_uid": ticket_payload["track_entity_uid"],
        "title": "Track",
        "artist": "Artist",
        "album": "Album",
        "duration": 1.5,
        "format": "mp3",
        "path": "Artist/Album/track.mp3",
    }
    policies: list[str] = []
    used: list[str] = []

    def fake_resolve(_track, policy, enqueue=True):
        policies.append(policy)
        return _resolution(track_file, source_format="mp3", requested_policy=policy)

    monkeypatch.setattr(
        "crate.api.cast.get_cast_ticket", lambda _ticket: ticket_payload
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _id: track
    )
    monkeypatch.setattr(
        "crate.api.cast.resolve_playback",
        fake_resolve,
    )
    monkeypatch.setattr(
        "crate.api.cast.mark_cast_ticket_used", lambda ticket: used.append(ticket)
    )

    with _unauthenticated_client() as client:
        media_response = client.get("/api/cast/media/signed-ticket")
        assert media_response.status_code == 200
        media = media_response.json()
        assert media["stream_url"] == "http://testserver/api/cast/stream/signed-ticket"
        assert media["content_type"] == "audio/mpeg"
        assert media["duration_ms"] == 1500
        assert media["requested_policy"] == ORIGINAL_POLICY

        stream_response = client.get(
            "/api/cast/stream/signed-ticket", headers={"Range": "bytes=0-3"}
        )
        assert stream_response.status_code == 206
        assert stream_response.content == b"0123"
        assert stream_response.headers["accept-ranges"] == "bytes"
        assert stream_response.headers["x-crate-delivery-policy"] == ORIGINAL_POLICY
    assert policies == [ORIGINAL_POLICY, ORIGINAL_POLICY]
    assert used == ["signed-ticket", "signed-ticket"]


def test_cast_media_uses_original_when_receiver_declares_source_format(
    tmp_path, test_app, monkeypatch
):
    track_file = tmp_path / "track.flac"
    track_file.write_bytes(b"flac")
    policies: list[str] = []
    ticket_payload = {
        "track_id": 7,
        "purpose": "google_cast",
        "delivery_policy": "auto",
        "receiver_capabilities": {"formats": ["flac"]},
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    track = {
        "id": 7,
        "title": "Lossless",
        "artist": "Artist",
        "album": "Album",
        "format": "flac",
        "path": "Artist/Album/track.flac",
    }

    def fake_resolve(_track, policy, enqueue=True):
        policies.append(policy)
        return _resolution(
            track_file,
            source_format="flac",
            requested_policy=policy,
            media_type="audio/flac",
        )

    monkeypatch.setattr(
        "crate.api.cast.get_cast_ticket", lambda _ticket: ticket_payload
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _id: track
    )
    monkeypatch.setattr("crate.api.cast.resolve_playback", fake_resolve)
    monkeypatch.setattr("crate.api.cast.mark_cast_ticket_used", lambda _ticket: None)

    response = test_app.get("/api/cast/media/signed-ticket")

    assert response.status_code == 200
    assert response.json()["requested_policy"] == ORIGINAL_POLICY
    assert policies == [ORIGINAL_POLICY]


def test_cast_stream_waits_for_unsafe_original_fallback(
    tmp_path, test_app, monkeypatch
):
    track_file = tmp_path / "track.flac"
    track_file.write_bytes(b"flac")
    policies: list[str] = []
    ticket_payload = {
        "track_id": 7,
        "purpose": "google_cast",
        "delivery_policy": "auto",
        "receiver_capabilities": {},
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    resolution = _resolution(
        track_file,
        source_format="flac",
        effective_policy="original",
        preparing=True,
        delivery={"fallback": True, "format": "m4a", "bitrate": 192},
    )

    monkeypatch.setattr(
        "crate.api.cast.get_cast_ticket", lambda _ticket: ticket_payload
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id",
        lambda _id: {"id": 7, "path": "Artist/Album/track.flac"},
    )

    def fake_resolve(_track, policy, enqueue=True):
        policies.append(policy)
        return resolution

    monkeypatch.setattr("crate.api.cast.resolve_playback", fake_resolve)

    response = test_app.get("/api/cast/stream/signed-ticket")

    assert response.status_code == 425
    assert response.headers["retry-after"] == "5"
    assert policies == [BALANCED_POLICY]


def _resolution(
    file_path,
    *,
    source_format: str,
    requested_policy: str = BALANCED_POLICY,
    effective_policy: str = "original",
    preparing: bool = False,
    delivery: dict | None = None,
    media_type: str | None = None,
):
    return SimpleNamespace(
        requested_policy=requested_policy,
        effective_policy=effective_policy,
        file_path=file_path,
        media_type=media_type
        or ("audio/mpeg" if file_path.suffix == ".mp3" else "audio/flac"),
        source={"format": source_format},
        delivery=delivery or {"format": source_format, "bitrate": 128},
        transcoded=False,
        preparing=preparing,
        variant_status="pending" if preparing else None,
    )


@contextmanager
def _unauthenticated_client():
    mock_config = {
        "library_path": "/tmp/test_crate_library",
        "audio_extensions": [".flac", ".mp3", ".m4a"],
        "exclude_dirs": [],
    }

    async def _no_user(self, request):
        return None

    with (
        patch("crate.api._deps.load_config", return_value=mock_config),
        patch("crate.db.init_db"),
        patch("crate.api.cache_events.broadcast_invalidation"),
        patch("crate.api.auth.AuthMiddleware.resolve_user", _no_user),
    ):
        from crate.api import create_app

        with TestClient(create_app()) as client:
            yield client
