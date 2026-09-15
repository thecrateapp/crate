from __future__ import annotations

from datetime import datetime, timedelta, timezone
import gzip
from types import SimpleNamespace


EXPIRES_AT = datetime.now(timezone.utc) + timedelta(hours=8)
SESSION_ID = "11111111-1111-1111-1111-111111111111"
TRACK_UID = "22222222-2222-2222-2222-222222222222"


def _track(track_id: int = 7) -> dict:
    return {
        "id": track_id,
        "entity_uid": TRACK_UID,
        "path": "Artist/Album/track.flac",
        "title": "Track",
        "artist": "Artist",
        "album": "Album",
        "duration": 185.5,
        "format": "flac",
        "bitrate": 900_000,
        "sample_rate": 44_100,
    }


def _stored_session(**overrides) -> dict:
    value = {
        "session_id": SESSION_ID,
        "user_id": 1,
        "target_device_id": "living-room",
        "protocol_version": 1,
        "receiver_capabilities": {"formats": ["mp3", "aac"]},
        "appearance": {
            "contract_version": 1,
            "skin_id": "crate-red",
            "preferred_mode": "system",
            "resolved_mode": "dark",
            "reduced_motion": False,
        },
        "queue": [
            {
                "item_id": "item-1",
                "track_id": 7,
                "track_entity_uid": TRACK_UID,
                "track_path": "Artist/Album/track.flac",
                "title": "Track",
                "artist": "Artist",
                "album": "Album",
                "duration": 185.5,
                "format": "flac",
                "artwork_url": "https://images.example.test/cover.jpg",
            }
        ],
        "current_index": 0,
        "current_time": 12.5,
        "repeat_mode": "all",
        "shuffle": False,
        "revision": 3,
        "state_seq": 9,
        "created_at": datetime.now(timezone.utc),
        "last_used_at": datetime.now(timezone.utc),
        "expires_at": EXPIRES_AT,
        "revoked_at": None,
    }
    value.update(overrides)
    return value


def test_cast_session_metrics_never_use_lease_or_item_cardinality():
    from crate.api.metrics_middleware import _normalize_path

    assert (
        _normalize_path("/api/cast/sessions/opaque-lease/items/private-item/stream")
        == "/api/cast/sessions/{lease}/items/{item_id}/stream"
    )
    assert (
        _normalize_path("/api/cast/sessions/opaque-lease/items/private-item/spectrum")
        == "/api/cast/sessions/{lease}/items/{item_id}/spectrum"
    )
    assert _normalize_path("/api/cast/sessions/opaque-lease/state") == (
        "/api/cast/sessions/{lease}/state"
    )


def test_create_cast_session_resolves_queue_and_returns_scoped_urls(
    test_app, monkeypatch
):
    calls: dict[str, object] = {}
    monkeypatch.setenv("CRATE_CAST_RECEIVER_APP_ID", "DEVAPP123")
    monkeypatch.setenv("CRATE_CAST_PUBLIC_BASE_URL", "https://cast-api.example.test")
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr(
        "crate.api.cast._resolve_cast_playback",
        lambda *_args, **_kwargs: SimpleNamespace(preparing=True),
    )

    def fake_create(user_id: int, **kwargs):
        calls["user_id"] = user_id
        calls.update(kwargs)
        return {**_stored_session(**kwargs), "lease": "opaque-lease"}

    monkeypatch.setattr("crate.api.cast.create_cast_session", fake_create)

    response = test_app.post(
        "/api/me/cast/sessions",
        headers={
            "x-forwarded-host": "listen.example.test",
            "x-forwarded-proto": "https",
        },
        json={
            "target_device_id": "living-room",
            "protocol_version": 1,
            "receiver_capabilities": {"formats": ["mp3", "aac"]},
            "appearance": {
                "contract_version": 1,
                "skin_id": "crate-red",
                "preferred_mode": "system",
                "resolved_mode": "dark",
                "reduced_motion": False,
            },
            "items": [
                {
                    "item_id": "item-1",
                    "track_id": 7,
                    "artwork_url": "https://images.example.test/cover.jpg",
                }
            ],
            "current_index": 0,
            "current_time": 12.5,
            "repeat_mode": "all",
            "shuffle": False,
            "revision": 3,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == SESSION_ID
    assert data["lease"] == "opaque-lease"
    assert data["receiver_application_id"] == "DEVAPP123"
    assert data["bootstrap_url"] == (
        "https://cast-api.example.test/api/cast/sessions/opaque-lease"
    )
    assert data["queue"]["items"][0]["stream_url"] == (
        "https://cast-api.example.test/api/cast/sessions/opaque-lease/"
        "items/item-1/stream"
    )
    assert data["queue"]["items"][0]["artwork_url"] == (
        "https://cast-api.example.test/api/cast/sessions/opaque-lease/"
        "items/item-1/artwork"
    )
    assert data["queue"]["items"][0]["spectrum_url"] == (
        "https://cast-api.example.test/api/cast/sessions/opaque-lease/"
        "items/item-1/spectrum"
    )
    assert data["queue"]["items"][0]["content_type"] == "audio/mp4"
    assert calls["user_id"] == 1
    assert calls["queue"][0]["track_id"] == 7
    assert calls["queue"][0]["title"] == "Track"


def test_create_cast_session_rejects_duplicate_items_and_invalid_cursor(test_app):
    duplicate = test_app.post(
        "/api/me/cast/sessions",
        json={
            "items": [
                {"item_id": "same", "track_id": 1},
                {"item_id": "same", "track_id": 2},
            ],
            "current_index": 0,
        },
    )
    invalid_cursor = test_app.post(
        "/api/me/cast/sessions",
        json={"items": [{"item_id": "item-1", "track_id": 1}], "current_index": 1},
    )

    assert duplicate.status_code == 422
    assert invalid_cursor.status_code == 422


def test_cast_session_bootstrap_touches_lease_without_echoing_it(test_app, monkeypatch):
    monkeypatch.setenv("CRATE_CAST_PUBLIC_BASE_URL", "https://cast-api.example.test")
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda lease: _stored_session()
    )

    response = test_app.get("/api/cast/sessions/opaque-lease")

    assert response.status_code == 200
    data = response.json()
    assert "lease" not in data
    assert data["session_id"] == SESSION_ID
    assert data["queue"]["revision"] == 3
    assert data["queue"]["state_seq"] == 9
    assert data["queue"]["current_index"] == 0
    assert data["queue"]["items"][0]["metadata_url"].endswith(
        "/api/cast/sessions/opaque-lease/items/item-1"
    )


def test_cast_session_bootstrap_hints_receiver_supported_source_type(
    test_app, monkeypatch
):
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session",
        lambda _lease: _stored_session(receiver_capabilities={"formats": ["flac"]}),
    )

    response = test_app.get("/api/cast/sessions/opaque-lease")

    assert response.status_code == 200
    assert response.json()["queue"]["items"][0]["content_type"] == "audio/flac"


def test_cast_session_item_rejects_track_outside_captured_queue(test_app, monkeypatch):
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda _lease: _stored_session()
    )

    response = test_app.get("/api/cast/sessions/opaque-lease/items/not-in-queue")

    assert response.status_code == 404


def test_cast_session_item_metadata_and_range_stream_are_receiver_safe(
    tmp_path, test_app, monkeypatch
):
    media_file = tmp_path / "track.m4a"
    media_file.write_bytes(b"0123456789")
    used: list[str] = []
    resolution = SimpleNamespace(
        requested_policy="balanced",
        effective_policy="balanced",
        file_path=media_file,
        media_type="audio/mp4",
        source={"format": "flac"},
        delivery={"format": "m4a", "bitrate": 192},
        transcoded=True,
        preparing=False,
        variant_status=None,
    )
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session",
        lambda lease: used.append(lease) or _stored_session(),
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr(
        "crate.api.cast._resolve_cast_playback", lambda *_args: resolution
    )

    metadata = test_app.get("/api/cast/sessions/opaque-lease/items/item-1")
    stream = test_app.get(
        "/api/cast/sessions/opaque-lease/items/item-1/stream",
        headers={"Origin": "https://receiver.example.test", "Range": "bytes=2-5"},
    )

    assert metadata.status_code == 200
    assert metadata.json()["content_type"] == "audio/mp4"
    assert metadata.json()["title"] == "Track"
    assert metadata.json()["stream_url"].endswith("/items/item-1/stream")
    assert stream.status_code == 206
    assert stream.content == b"2345"
    assert stream.headers["access-control-allow-origin"] == "*"
    assert stream.headers["x-crate-delivery-policy"] == "balanced"
    assert used == ["opaque-lease", "opaque-lease"]


def test_cast_session_artwork_is_scoped_to_the_lease(test_app, monkeypatch):
    used: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda _lease: _stored_session()
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr(
        "crate.api.cast.api_cover",
        lambda artist, album, **_kwargs: used.append((artist, album)) or "cover",
    )

    response = test_app.get("/api/cast/sessions/opaque-lease/items/item-1/artwork")

    assert response.status_code == 200
    assert response.json() == "cover"
    assert used == [("Artist", "Album")]


def test_cast_session_stream_reports_preparing_with_retry_after(test_app, monkeypatch):
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda _lease: _stored_session()
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )

    def preparing(*_args):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=425,
            detail="Cast playback variant is preparing",
            headers={"Retry-After": "5"},
        )

    monkeypatch.setattr("crate.api.cast._resolve_cast_playback", preparing)

    response = test_app.get("/api/cast/sessions/opaque-lease/items/item-1/stream")

    assert response.status_code == 425
    assert response.headers["retry-after"] == "5"


def test_cast_session_queue_update_returns_conflict_snapshot(test_app, monkeypatch):
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr(
        "crate.api.cast.update_cast_session_queue",
        lambda *_args, **_kwargs: {
            **_stored_session(revision=5),
            "mutation_status": "conflict",
        },
    )

    response = test_app.patch(
        f"/api/me/cast/sessions/{SESSION_ID}",
        json={
            "expected_revision": 3,
            "mutation_id": "mutation-1",
            "items": [{"item_id": "item-1", "track_id": 7}],
            "repeat_mode": "off",
            "shuffle": False,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "QUEUE_REVISION_CONFLICT"
    assert response.json()["detail"]["queue"]["revision"] == 5


def test_cast_session_queue_update_and_revoke_are_owner_scoped(test_app, monkeypatch):
    calls: list[tuple] = []

    def fake_update(*args, **kwargs):
        calls.append((args, kwargs))
        return {
            **_stored_session(revision=4),
            "mutation_status": "applied",
        }

    monkeypatch.setattr("crate.api.cast.update_cast_session_queue", fake_update)
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr(
        "crate.api.cast.revoke_cast_session",
        lambda user_id, session_id: calls.append((user_id, session_id)) or True,
    )

    updated = test_app.patch(
        f"/api/me/cast/sessions/{SESSION_ID}",
        json={
            "expected_revision": 3,
            "mutation_id": "mutation-1",
            "items": [{"item_id": "item-1", "track_id": 7}],
            "repeat_mode": "off",
            "shuffle": False,
        },
    )
    revoked = test_app.delete(f"/api/me/cast/sessions/{SESSION_ID}")

    assert updated.status_code == 200
    assert updated.json()["mutation_status"] == "applied"
    assert revoked.status_code == 200
    assert revoked.json() == {"ok": True}
    assert calls[-1] == (1, SESSION_ID)


def test_sender_queue_update_cannot_overwrite_receiver_cursor(test_app):
    response = test_app.patch(
        f"/api/me/cast/sessions/{SESSION_ID}",
        json={
            "expected_revision": 3,
            "mutation_id": "mutation-1",
            "items": [{"item_id": "item-1", "track_id": 7}],
            "current_index": 0,
            "current_time": 20,
        },
    )

    assert response.status_code == 422


def test_receiver_updates_state_with_monotonic_sequence(test_app, monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_update(lease: str, **kwargs):
        calls.append((lease, kwargs))
        return _stored_session(
            state_seq=kwargs["state_seq"],
            current_index=kwargs["current_index"],
            current_time=kwargs["current_time"],
        )

    monkeypatch.setattr("crate.api.cast.update_cast_session_state", fake_update)

    response = test_app.post(
        "/api/cast/sessions/opaque-lease/state",
        headers={"Origin": "https://receiver.example.test"},
        json={"state_seq": 10, "current_index": 0, "current_time": 42.5},
    )

    assert response.status_code == 200
    assert response.json()["queue"]["state_seq"] == 10
    assert calls == [
        (
            "opaque-lease",
            {"state_seq": 10, "current_index": 0, "current_time": 42.5},
        )
    ]
    assert response.headers["access-control-allow-origin"] == "*"


def test_receiver_records_idempotent_play_checkpoint(test_app, monkeypatch):
    calls: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda _lease: _stored_session()
    )

    def fake_record(*args, **kwargs):
        calls.append((args, kwargs))
        return 44

    monkeypatch.setattr("crate.api.cast.record_play_event", fake_record)

    response = test_app.post(
        "/api/cast/sessions/opaque-lease/checkpoints",
        json={
            "client_event_id": "receiver-event-1",
            "item_id": "item-1",
            "started_at": "2026-09-15T00:00:00Z",
            "ended_at": "2026-09-15T00:03:00Z",
            "played_seconds": 180,
            "track_duration_seconds": 185.5,
            "completion_ratio": 0.97,
            "was_completed": True,
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "id": 44}
    assert calls[0][0] == (1,)
    assert calls[0][1]["client_event_id"] == (f"cast:{SESSION_ID}:receiver-event-1")
    assert calls[0][1]["track_id"] == 7
    assert calls[0][1]["play_source_type"] == "cast"
    assert calls[0][1]["app_platform"] == "cast_receiver"


def test_cast_session_public_routes_allow_receiver_cors_preflight(test_app):
    response = test_app.options(
        "/api/cast/sessions/opaque-lease/items/item-1/stream",
        headers={
            "Origin": "https://receiver.example.test",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Range",
        },
    )

    assert response.status_code in {200, 204}
    assert response.headers["access-control-allow-origin"] == "*"
    assert "range" in response.headers["access-control-allow-headers"].lower()

    write_response = test_app.options(
        "/api/cast/sessions/opaque-lease/state",
        headers={
            "Origin": "https://receiver.example.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert "post" in write_response.headers["access-control-allow-methods"].lower()
    assert (
        "content-type" in write_response.headers["access-control-allow-headers"].lower()
    )


def _prepare_spectrum_request(tmp_path, monkeypatch, artifact: dict) -> None:
    source = tmp_path / "track.flac"
    source.write_bytes(b"audio-source")
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda _lease: _stored_session()
    )
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr(
        "crate.api.cast.resolve_source_path", lambda _track: source, raising=False
    )
    monkeypatch.setattr(
        "crate.api.cast.source_fingerprint",
        lambda _track, _source: "a" * 64,
        raising=False,
    )
    monkeypatch.setattr(
        "crate.api.cast.ensure_cast_spectrum_request",
        lambda _track_id, _fingerprint: dict(artifact),
        raising=False,
    )


def test_cast_session_spectrum_serves_ready_immutable_artifact_with_etag(
    tmp_path, test_app, monkeypatch
):
    artifact_file = tmp_path / "spectrum.crsp.gz"
    artifact_file.write_bytes(gzip.compress(b"CRSP-payload", mtime=0))
    _prepare_spectrum_request(
        tmp_path,
        monkeypatch,
        {
            "status": "ready",
            "artifact_path": "cast-spectrum/aa/spectrum.crsp.gz",
            "artifact_etag": "etag-1",
            "should_enqueue": False,
        },
    )
    monkeypatch.setattr(
        "crate.api.cast.resolve_data_file", lambda _path: artifact_file, raising=False
    )

    response = test_app.get(
        "/api/cast/sessions/opaque-lease/items/item-1/spectrum",
        headers={"Origin": "https://receiver.example.test"},
    )
    not_modified = test_app.get(
        "/api/cast/sessions/opaque-lease/items/item-1/spectrum",
        headers={"If-None-Match": 'W/"etag-1"'},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.crate.cast-spectrum"
    )
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["etag"] == '"etag-1"'
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
    exposed = response.headers["access-control-expose-headers"].lower()
    assert "etag" in exposed
    assert "content-encoding" in exposed
    assert not_modified.status_code == 304
    assert not_modified.content == b""


def test_cast_session_spectrum_lazily_queues_once_and_reports_generation_state(
    tmp_path, test_app, monkeypatch
):
    queued: list[tuple[str, dict, str]] = []
    _prepare_spectrum_request(
        tmp_path,
        monkeypatch,
        {"status": "pending", "should_enqueue": True},
    )

    def create_task(task_type: str, params: dict, dedup_key: str):
        queued.append((task_type, params, dedup_key))
        return "task-1"

    monkeypatch.setattr("crate.api.cast.create_task_dedup", create_task, raising=False)

    response = test_app.get("/api/cast/sessions/opaque-lease/items/item-1/spectrum")

    assert response.status_code == 202
    assert response.headers["retry-after"] == "2"
    assert response.json() == {"status": "pending", "retry_after": 2}
    assert queued == [
        (
            "generate_cast_spectrum",
            {"track_id": 7, "source_fingerprint": "a" * 64},
            f"7:{'a' * 64}",
        )
    ]


def test_cast_session_spectrum_reports_existing_generation_without_requeue(
    tmp_path, test_app, monkeypatch
):
    _prepare_spectrum_request(
        tmp_path,
        monkeypatch,
        {"status": "generating", "should_enqueue": False},
    )
    monkeypatch.setattr(
        "crate.api.cast.create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("generating artefact must not be requeued")
        ),
        raising=False,
    )

    response = test_app.get("/api/cast/sessions/opaque-lease/items/item-1/spectrum")

    assert response.status_code == 425
    assert response.headers["retry-after"] == "2"


def test_cast_session_spectrum_rejects_items_outside_scoped_queue(
    test_app, monkeypatch
):
    monkeypatch.setattr(
        "crate.api.cast.touch_cast_session", lambda _lease: _stored_session()
    )

    response = test_app.get(
        "/api/cast/sessions/opaque-lease/items/not-in-queue/spectrum"
    )

    assert response.status_code == 404
