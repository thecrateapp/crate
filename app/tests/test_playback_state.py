from datetime import datetime, timedelta, timezone


def test_playback_state_resume_candidate_projects_live_position_and_sanitizes_queue(
    pg_db,
):
    from crate.db.repositories.playback_state import (
        get_resume_candidate,
        list_devices,
        upsert_device,
        upsert_playback_state,
    )

    user = pg_db.create_user("connect-resume@test.com")
    user_id = user["id"]

    upsert_device(
        user_id,
        device_id="phone",
        device_label="Phone",
        capabilities={"can_play": True},
    )
    upsert_playback_state(
        user_id,
        device_id="phone",
        snapshot_kind="structural",
        status="paused",
        track_entity_uid="11111111-1111-1111-1111-111111111111",
        title="Paused",
        artist="Artist",
        position_ms=10_000,
        duration_ms=200_000,
        queue=[
            {
                "entity_uid": "11111111-1111-1111-1111-111111111111",
                "title": "Paused",
                "artist": "Artist",
                "stream_url": "/api/tracks/1/stream?token=secret",
                "token": "secret",
            }
        ],
    )

    upsert_device(
        user_id,
        device_id="desktop",
        device_label="Desktop",
        capabilities={"can_play": True},
    )
    upsert_playback_state(
        user_id,
        device_id="desktop",
        snapshot_kind="structural",
        status="playing",
        track_entity_uid="22222222-2222-2222-2222-222222222222",
        title="Live",
        artist="Artist",
        position_ms=1_000,
        duration_ms=200_000,
        queue=[
            {
                "track_entity_uid": "22222222-2222-2222-2222-222222222222",
                "title": "Live",
                "artist": "Artist",
                "playback_url": "/api/tracks/2/playback?token=secret",
            }
        ],
    )

    devices = list_devices(user_id)
    assert [device["device_id"] for device in devices] == ["desktop", "phone"]

    candidate = get_resume_candidate(user_id, device_id="phone")
    assert candidate is not None
    assert candidate["device_id"] == "desktop"
    assert candidate["position_ms"] >= 1_000
    assert candidate["queue"] == [
        {
            "track_entity_uid": "22222222-2222-2222-2222-222222222222",
            "title": "Live",
            "artist": "Artist",
        }
    ]


def test_project_live_position_does_not_mutate_input():
    from crate.db.repositories.playback_state import project_live_position

    state = {
        "status": "playing",
        "position_ms": 1000,
        "duration_ms": 200000,
        "playback_rate": 1,
        "updated_at": datetime.now(timezone.utc) - timedelta(seconds=2),
    }

    projected = project_live_position(state)

    assert projected is not state
    assert projected["position_ms"] >= 1000
    assert state["position_ms"] == 1000


def test_playback_state_resume_candidate_ignores_other_users_and_revoked_devices(pg_db):
    from crate.db.repositories.playback_state import (
        get_resume_candidate,
        revoke_device,
        upsert_device,
        upsert_playback_state,
    )

    owner = pg_db.create_user("connect-owner@test.com")
    other = pg_db.create_user("connect-other@test.com")

    upsert_device(owner["id"], device_id="owner-phone", device_label="Owner")
    upsert_playback_state(
        owner["id"],
        device_id="owner-phone",
        status="paused",
        title="Owner Track",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    upsert_device(other["id"], device_id="other-phone", device_label="Other")
    upsert_playback_state(
        other["id"],
        device_id="other-phone",
        status="playing",
        title="Other Track",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )

    candidate = get_resume_candidate(owner["id"], device_id="new-device")
    assert candidate is not None
    assert candidate["title"] == "Owner Track"

    assert revoke_device(owner["id"], "owner-phone") is True
    assert get_resume_candidate(owner["id"], device_id="new-device") is None


def test_playback_state_revoke_device_revokes_matching_auth_sessions(pg_db):
    from crate.db.repositories.auth_sessions import create_session, get_session
    from crate.db.repositories.playback_state import revoke_device, upsert_device

    user = pg_db.create_user("connect-device-revoke@test.com")
    user_id = user["id"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=1)

    create_session(
        "session-phone",
        user_id,
        expires_at,
        app_id="listen-web",
        device_fingerprint="listen:phone",
    )
    create_session(
        "session-other",
        user_id,
        expires_at,
        app_id="listen-web",
        device_fingerprint="listen:other",
    )
    upsert_device(
        user_id,
        device_id="listen:phone",
        device_label="Phone",
        session_id="session-phone",
    )

    assert revoke_device(user_id, "listen:phone") is True

    assert get_session("session-phone")["revoked_at"] is not None
    assert get_session("session-other")["revoked_at"] is None


def test_playback_state_presence_marks_only_recent_devices_active(pg_db, monkeypatch):
    presence_cache: dict[str, object] = {}

    def fake_get_cache(key, max_age_seconds=None):
        return presence_cache.get(key)

    def fake_set_cache(key, value, ttl=None):
        presence_cache[key] = value

    monkeypatch.setattr(
        "crate.db.repositories.playback_state.get_cache", fake_get_cache
    )
    monkeypatch.setattr(
        "crate.db.repositories.playback_state.set_cache", fake_set_cache
    )

    from crate.db.repositories.playback_state import (
        list_devices,
        mark_device_present,
        upsert_device,
    )

    user = pg_db.create_user("connect-presence@test.com")
    user_id = user["id"]

    upsert_device(user_id, device_id="phone", device_label="Phone")
    mark_device_present(user_id, device_id="desktop", device_label="Desktop")

    devices = {device["device_id"]: device for device in list_devices(user_id)}
    assert devices["desktop"]["active"] is True
    assert devices["phone"]["active"] is False


def test_playback_state_device_checkpoint_preserves_connect_capabilities(pg_db):
    from crate.db.repositories.playback_state import list_devices, upsert_device

    user = pg_db.create_user("connect-capabilities@test.com")
    user_id = user["id"]

    upsert_device(
        user_id,
        device_id="phone",
        device_label="Phone",
        capabilities={
            "can_play": True,
            "can_receive_commands": True,
            "can_set_volume": True,
        },
    )

    upsert_device(
        user_id,
        device_id="phone",
        device_label="Phone",
        app_platform="listen-web",
        capabilities=None,
        touch_presence=False,
    )

    [device] = list_devices(user_id)
    assert device["capabilities"] == {
        "can_play": True,
        "can_receive_commands": True,
        "can_set_volume": True,
    }


def test_playback_state_api_upserts_current_device_and_checkpoint(
    monkeypatch, test_app
):
    calls: dict[str, object] = {}

    def fake_upsert_device(user_id, **kwargs):
        calls["device"] = {"user_id": user_id, **kwargs}
        return {
            "device_id": kwargs["device_id"],
            "device_label": kwargs.get("device_label"),
            "capabilities": kwargs.get("capabilities") or {},
            "active": True,
        }

    def fake_upsert_playback_state(user_id, **kwargs):
        calls["state"] = {"user_id": user_id, **kwargs}
        return {
            "device_id": kwargs["device_id"],
            "status": kwargs["status"],
            "title": kwargs["title"],
            "artist": kwargs["artist"],
            "album": kwargs["album"],
            "position_ms": kwargs["position_ms"],
            "duration_ms": kwargs["duration_ms"],
            "current_index": kwargs["current_index"],
            "queue_revision": kwargs["queue_revision"],
            "queue": kwargs["queue"],
            "play_source": kwargs["play_source"],
            "repeat_mode": kwargs["repeat_mode"],
            "shuffle": kwargs["shuffle"],
            "playback_rate": kwargs["playback_rate"],
        }

    def fake_mark_device_present(user_id, **kwargs):
        calls["presence"] = {"user_id": user_id, **kwargs}
        return {
            "device_id": kwargs["device_id"],
            "device_label": kwargs.get("device_label"),
            "capabilities": kwargs.get("capabilities") or {},
            "active": True,
        }

    monkeypatch.setattr("crate.api.playback_state.upsert_device", fake_upsert_device)
    monkeypatch.setattr(
        "crate.api.playback_state.upsert_playback_state",
        fake_upsert_playback_state,
    )
    monkeypatch.setattr(
        "crate.api.playback_state.mark_device_present",
        fake_mark_device_present,
    )
    monkeypatch.setattr(
        "crate.api.playback_state.sync_active_playback_claim",
        lambda *args, **kwargs: calls.setdefault("claim", (args, kwargs)),
    )

    presence_response = test_app.post(
        "/api/me/devices/current/presence",
        json={
            "device_id": "listen-device",
            "device_label": "Web Listen",
            "device_type": "web",
            "app_platform": "listen-web",
            "capabilities": {"can_play": True},
        },
    )

    assert presence_response.status_code == 200
    assert calls["presence"]["device_label"] == "Web Listen"  # type: ignore[index]

    response = test_app.put(
        "/api/me/playback-state/current",
        headers={
            "X-Device-Fingerprint": "listen-device",
            "X-Device-Label": "Web Listen",
        },
        json={
            "device_id": "listen-device",
            "snapshot_kind": "structural",
            "status": "paused",
            "title": "Track",
            "artist": "Artist",
            "album": "Album",
            "position_ms": 42000,
            "duration_ms": 180000,
            "current_index": 0,
            "queue_revision": "rev-1",
            "queue": [
                {
                    "track_entity_uid": "33333333-3333-3333-3333-333333333333",
                    "title": "Track",
                    "artist": "Artist",
                }
            ],
            "play_source": {"type": "album", "name": "Album", "id": 7},
            "repeat_mode": "off",
            "shuffle": False,
        },
    )

    assert response.status_code == 200
    assert calls["device"]["device_label"] == "Web Listen"  # type: ignore[index]
    assert calls["device"]["touch_presence"] is False  # type: ignore[index]
    assert calls["state"]["user_id"] == 1  # type: ignore[index]
    assert calls["state"]["queue"] == [  # type: ignore[index]
        {
            "track_entity_uid": "33333333-3333-3333-3333-333333333333",
            "title": "Track",
            "artist": "Artist",
            "album": "",
        }
    ]
    assert calls["claim"][0] == (1,)  # type: ignore[index]


def test_playback_state_api_only_claims_playing_checkpoints_when_explicit(
    monkeypatch, test_app
):
    calls: dict[str, list[object]] = {"claims": []}

    def fake_upsert_device(user_id, **kwargs):
        return {
            "device_id": kwargs["device_id"],
            "device_label": kwargs.get("device_label"),
            "capabilities": {},
            "active": True,
        }

    def fake_upsert_playback_state(user_id, **kwargs):
        return {
            "device_id": kwargs["device_id"],
            "status": kwargs["status"],
            "title": kwargs["title"],
            "artist": kwargs["artist"],
            "album": kwargs["album"],
            "position_ms": kwargs["position_ms"],
            "duration_ms": kwargs["duration_ms"],
            "current_index": kwargs["current_index"],
            "queue_revision": kwargs["queue_revision"],
            "queue": kwargs["queue"],
            "play_source": kwargs["play_source"],
            "repeat_mode": kwargs["repeat_mode"],
            "shuffle": kwargs["shuffle"],
            "playback_rate": kwargs["playback_rate"],
        }

    def fake_claim(user_id, **kwargs):
        calls["claims"].append({"user_id": user_id, **kwargs})

    monkeypatch.setattr("crate.api.playback_state.upsert_device", fake_upsert_device)
    monkeypatch.setattr(
        "crate.api.playback_state.upsert_playback_state",
        fake_upsert_playback_state,
    )
    monkeypatch.setattr(
        "crate.api.playback_state.sync_active_playback_claim", fake_claim
    )

    base_payload = {
        "device_id": "listen-device",
        "snapshot_kind": "light",
        "status": "playing",
        "title": "Track",
        "artist": "Artist",
        "album": "Album",
        "position_ms": 42_000,
        "current_index": 0,
        "queue_revision": "rev-1",
        "repeat_mode": "off",
        "shuffle": False,
    }

    response = test_app.put("/api/me/playback-state/current", json=base_payload)
    assert response.status_code == 200
    assert calls["claims"] == []

    response = test_app.put(
        "/api/me/playback-state/current",
        json={**base_payload, "claim_active": True},
    )

    assert response.status_code == 200
    assert calls["claims"] == [
        {
            "user_id": 1,
            "device_id": "listen-device",
            "status": "playing",
            "state_revision": "rev-1",
        }
    ]
