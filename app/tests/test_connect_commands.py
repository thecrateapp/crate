from __future__ import annotations

from uuid import uuid4

import pytest


def test_connect_transfer_updates_active_session_and_enqueues_device_commands(
    pg_db, monkeypatch
):
    monkeypatch.setattr("crate.db.repositories.connect.get_redis", lambda: None)

    from crate.db.repositories.connect import (
        acknowledge_connect_command,
        get_active_session,
        read_connect_commands,
        reset_process_command_bus_for_tests,
        transfer_playback,
    )
    from crate.db.repositories.playback_state import (
        upsert_device,
        upsert_playback_state,
    )

    reset_process_command_bus_for_tests()
    user = pg_db.create_user("connect-transfer@test.com")
    user_id = user["id"]
    source_session_id = str(uuid4())

    upsert_device(
        user_id,
        device_id="phone",
        device_label="Phone",
        capabilities={"can_play": True, "can_receive_commands": True},
    )
    upsert_device(
        user_id,
        device_id="desktop",
        device_label="Desktop",
        capabilities={"can_play": True, "can_receive_commands": True},
    )
    upsert_playback_state(
        user_id,
        device_id="phone",
        snapshot_kind="structural",
        status="playing",
        playback_session_id=source_session_id,
        track_entity_uid="11111111-1111-1111-1111-111111111111",
        title="Transfer Track",
        artist="Artist",
        album="Album",
        position_ms=12_000,
        duration_ms=180_000,
        queue=[
            {
                "track_entity_uid": "11111111-1111-1111-1111-111111111111",
                "title": "Transfer Track",
                "artist": "Artist",
            }
        ],
    )

    result = transfer_playback(
        user_id,
        source_device_id="phone",
        target_device_id="desktop",
        start_playing=True,
    )

    session = get_active_session(user_id)
    assert session is not None
    assert session["active_device_id"] == "phone"
    assert session["status"] == "playing"
    assert result["session"]["playback_session_id"] == session["playback_session_id"]

    target_commands = read_connect_commands(user_id, device_id="desktop")
    assert len(target_commands) == 1
    assert target_commands[0]["type"] == "transfer_in"
    assert target_commands[0]["playback_session_id"] == str(
        target_commands[0]["payload"]["target_playback_session_id"]
    )
    assert target_commands[0]["payload"]["source_device_id"] == "phone"
    assert target_commands[0]["payload"]["state"]["title"] == "Transfer Track"
    assert target_commands[0]["payload"]["state"]["position_ms"] >= 12_000

    source_commands = read_connect_commands(user_id, device_id="phone")
    assert source_commands == []

    acknowledge_connect_command(
        user_id,
        device_id="desktop",
        command_id=target_commands[0]["command_id"],
        status="success",
    )

    session = get_active_session(user_id)
    assert session is not None
    assert session["active_device_id"] == "desktop"
    assert session["status"] == "playing"
    source_commands = read_connect_commands(user_id, device_id="phone")
    assert len(source_commands) == 1
    assert source_commands[0]["type"] == "transfer_out"
    assert source_commands[0]["playback_session_id"] == source_session_id
    assert source_commands[0]["payload"]["target_device_id"] == "desktop"


def test_connect_transfer_requires_command_capable_target(pg_db, monkeypatch):
    monkeypatch.setattr("crate.db.repositories.connect.get_redis", lambda: None)

    from crate.db.repositories.connect import (
        ConnectDeviceUnavailable,
        reset_process_command_bus_for_tests,
        transfer_playback,
    )
    from crate.db.repositories.playback_state import (
        upsert_device,
        upsert_playback_state,
    )

    reset_process_command_bus_for_tests()
    user = pg_db.create_user("connect-capability@test.com")
    user_id = user["id"]

    upsert_device(
        user_id,
        device_id="phone",
        capabilities={"can_play": True, "can_receive_commands": True},
    )
    upsert_device(
        user_id,
        device_id="speakerless",
        capabilities={"can_play": True, "can_receive_commands": False},
    )
    upsert_playback_state(
        user_id,
        device_id="phone",
        status="paused",
        title="Paused Track",
    )

    with pytest.raises(ConnectDeviceUnavailable):
        transfer_playback(
            user_id,
            source_device_id="phone",
            target_device_id="speakerless",
            start_playing=False,
        )


def test_connect_command_rejects_stale_playback_session(pg_db, monkeypatch):
    monkeypatch.setattr("crate.db.repositories.connect.get_redis", lambda: None)

    from crate.db.repositories.connect import (
        acknowledge_connect_command,
        ConnectStaleCommand,
        get_active_session,
        read_connect_commands,
        reset_process_command_bus_for_tests,
        send_connect_command,
        transfer_playback,
    )
    from crate.db.repositories.playback_state import (
        upsert_device,
        upsert_playback_state,
    )

    reset_process_command_bus_for_tests()
    user = pg_db.create_user("connect-command@test.com")
    user_id = user["id"]

    for device_id in ("phone", "desktop"):
        upsert_device(
            user_id,
            device_id=device_id,
            capabilities={"can_play": True, "can_receive_commands": True},
        )
    upsert_playback_state(
        user_id,
        device_id="phone",
        status="playing",
        title="Command Track",
    )
    transfer_playback(
        user_id,
        source_device_id="phone",
        target_device_id="desktop",
        start_playing=True,
    )
    transfer_command = read_connect_commands(user_id, device_id="desktop")[0]
    acknowledge_connect_command(
        user_id,
        device_id="desktop",
        command_id=transfer_command["command_id"],
        status="success",
    )
    active = get_active_session(user_id)
    assert active is not None

    with pytest.raises(ConnectStaleCommand):
        send_connect_command(
            user_id,
            command_type="pause",
            target_device_id="desktop",
            playback_session_id="00000000-0000-0000-0000-000000000000",
        )

    command = send_connect_command(
        user_id,
        command_type="pause",
        target_device_id="desktop",
        playback_session_id=str(active["playback_session_id"]),
    )

    commands = read_connect_commands(user_id, device_id="desktop")
    assert command["type"] == "pause"
    assert [item["type"] for item in commands] == ["pause"]
    active = get_active_session(user_id)
    assert active is not None
    assert active["status"] == "paused"


def test_connect_commands_survive_process_local_publish_loss(pg_db, monkeypatch):
    monkeypatch.setattr("crate.db.repositories.connect.get_redis", lambda: None)

    from crate.db.repositories.connect import (
        read_connect_commands,
        reset_process_command_bus_for_tests,
        transfer_playback,
    )
    from crate.db.repositories.playback_state import (
        upsert_device,
        upsert_playback_state,
    )

    reset_process_command_bus_for_tests()
    user = pg_db.create_user("connect-outbox@test.com")
    user_id = user["id"]

    for device_id in ("phone", "desktop"):
        upsert_device(
            user_id,
            device_id=device_id,
            capabilities={"can_play": True, "can_receive_commands": True},
        )
    upsert_playback_state(
        user_id,
        device_id="phone",
        status="playing",
        title="Outbox Track",
    )

    result = transfer_playback(
        user_id,
        source_device_id="phone",
        target_device_id="desktop",
        start_playing=True,
    )
    reset_process_command_bus_for_tests()

    commands = read_connect_commands(user_id, device_id="desktop")

    assert [command["type"] for command in commands] == ["transfer_in"]
    assert commands[0]["stream_id"] == result["target_command"]["stream_id"]
    assert commands[0]["payload"]["state"]["title"] == "Outbox Track"


def test_connect_duplicate_command_id_does_not_advance_session_twice(
    pg_db, monkeypatch
):
    monkeypatch.setattr("crate.db.repositories.connect.get_redis", lambda: None)

    from crate.db.repositories.connect import (
        acknowledge_connect_command,
        get_active_session,
        read_connect_commands,
        reset_process_command_bus_for_tests,
        send_connect_command,
        transfer_playback,
    )
    from crate.db.repositories.playback_state import (
        upsert_device,
        upsert_playback_state,
    )

    reset_process_command_bus_for_tests()
    user = pg_db.create_user("connect-dedupe-outbox@test.com")
    user_id = user["id"]

    for device_id in ("phone", "desktop"):
        upsert_device(
            user_id,
            device_id=device_id,
            capabilities={"can_play": True, "can_receive_commands": True},
        )
    upsert_playback_state(
        user_id,
        device_id="phone",
        status="playing",
        title="Dedupe Track",
    )
    transfer_playback(
        user_id,
        source_device_id="phone",
        target_device_id="desktop",
        start_playing=True,
    )
    transfer_command = read_connect_commands(user_id, device_id="desktop")[0]
    acknowledge_connect_command(
        user_id,
        device_id="desktop",
        command_id=transfer_command["command_id"],
        status="success",
    )
    active = get_active_session(user_id)
    assert active is not None

    command_id = str(uuid4())
    first = send_connect_command(
        user_id,
        command_id=command_id,
        command_type="pause",
        target_device_id="desktop",
        playback_session_id=str(active["playback_session_id"]),
    )
    after_first = get_active_session(user_id)
    second = send_connect_command(
        user_id,
        command_id=command_id,
        command_type="pause",
        target_device_id="desktop",
        playback_session_id=str(active["playback_session_id"]),
    )
    after_second = get_active_session(user_id)

    assert first["deduplicated"] is False
    assert second["deduplicated"] is True
    assert second["stream_id"] == first["stream_id"]
    assert after_first is not None
    assert after_second is not None
    assert after_second["command_seq"] == after_first["command_seq"]
    commands = read_connect_commands(user_id, device_id="desktop")
    assert [command["type"] for command in commands] == ["pause"]


def test_connect_memory_command_streams_expire(monkeypatch):
    monkeypatch.setattr("crate.db.repositories.connect.get_redis", lambda: None)

    from crate.db.repositories import connect

    connect.reset_process_command_bus_for_tests()
    command = connect.enqueue_connect_command(
        1,
        target_device_id="desktop",
        command_type="pause",
    )

    assert command["stream_id"]
    assert connect._memory_streams
    for stream_key in list(connect._memory_stream_activity):
        connect._memory_stream_activity[stream_key] = (
            1000 - connect.MEMORY_STREAM_TTL_SECONDS - 1
        )

    connect._cleanup_memory_expired(now=1000)

    assert connect._memory_streams == {}
    assert connect._memory_stream_activity == {}


def test_connect_transfer_api_maps_repository_response(test_app, monkeypatch):
    session_id = str(uuid4())
    command_id = str(uuid4())
    calls: dict[str, object] = {}

    def fake_transfer_playback(user_id, **kwargs):
        calls["user_id"] = user_id
        calls.update(kwargs)
        return {
            "session": {
                "user_id": user_id,
                "playback_session_id": session_id,
                "active_device_id": kwargs["target_device_id"],
                "status": "playing",
                "command_seq": 1,
            },
            "target_command": {
                "command_id": command_id,
                "type": "transfer_in",
                "source_device_id": kwargs["source_device_id"],
                "target_device_id": kwargs["target_device_id"],
                "playback_session_id": session_id,
                "command_seq": 1,
                "payload": {"start_playing": kwargs["start_playing"]},
                "deduplicated": False,
            },
            "source_command": None,
        }

    monkeypatch.setattr("crate.api.connect.transfer_playback", fake_transfer_playback)

    response = test_app.post(
        "/api/me/connect/transfer",
        json={
            "source_device_id": "phone",
            "target_device_id": "desktop",
            "start_playing": True,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session"]["active_device_id"] == "desktop"
    assert data["target_command"]["type"] == "transfer_in"
    assert calls["user_id"] == 1
    assert calls["source_device_id"] == "phone"


def test_connect_commands_poll_api_reads_pending_commands(test_app, monkeypatch):
    command_id = str(uuid4())
    calls: dict[str, object] = {}

    def fake_read_connect_commands(user_id, **kwargs):
        calls["user_id"] = user_id
        calls.update(kwargs)
        return [
            {
                "command_id": command_id,
                "type": "pause",
                "source_device_id": "phone",
                "target_device_id": kwargs["device_id"],
                "playback_session_id": None,
                "command_seq": 2,
                "payload": {},
                "deduplicated": False,
            }
        ]

    monkeypatch.setattr(
        "crate.api.connect.read_connect_commands", fake_read_connect_commands
    )

    response = test_app.get("/api/me/connect/commands?device_id=desktop")

    assert response.status_code == 200
    data = response.json()
    assert data["commands"][0]["command_id"] == command_id
    assert data["commands"][0]["type"] == "pause"
    assert calls == {
        "user_id": 1,
        "device_id": "desktop",
        "last_id": "0-0",
        "limit": 25,
        "block_ms": 0,
    }


def test_connect_session_api_includes_active_playback_state(test_app, monkeypatch):
    session_id = str(uuid4())

    monkeypatch.setattr(
        "crate.api.connect.get_active_session",
        lambda user_id: {
            "user_id": user_id,
            "playback_session_id": session_id,
            "active_device_id": "desktop",
            "status": "playing",
            "command_seq": 3,
            "state_revision": "rev-1",
        },
    )
    monkeypatch.setattr(
        "crate.api.connect.get_device_playback_state",
        lambda user_id, *, device_id: {
            "device_id": device_id,
            "device_label": "Desktop",
            "status": "playing",
            "playback_session_id": session_id,
            "title": "Dark Horse",
            "artist": "Converge",
            "album": "Live in Orlando",
            "position_ms": 13_000,
            "duration_ms": 231_000,
            "current_index": 1,
            "queue_revision": "rev-1",
            "queue": [
                {
                    "track_id": 44,
                    "title": "Dark Horse",
                    "artist": "Converge",
                }
            ],
            "repeat_mode": "off",
            "shuffle": False,
            "playback_rate": 1,
        },
    )

    response = test_app.get("/api/me/connect/session")

    assert response.status_code == 200
    data = response.json()
    assert data["session"]["active_device_id"] == "desktop"
    assert data["state"]["title"] == "Dark Horse"
    assert data["state"]["position_ms"] == 13_000


def test_connect_preferences_are_disabled_by_default_and_user_scoped(pg_db, test_app):
    del pg_db
    response = test_app.get("/api/me/connect/preferences")

    assert response.status_code == 200
    assert response.json() == {"enabled": False}

    response = test_app.put(
        "/api/me/connect/preferences",
        json={"enabled": True},
    )

    assert response.status_code == 200
    assert response.json() == {"enabled": True}
    assert test_app.get("/api/me/connect/preferences").json() == {"enabled": True}
