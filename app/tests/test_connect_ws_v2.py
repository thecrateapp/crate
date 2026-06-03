from __future__ import annotations

import asyncio
from datetime import datetime, timezone


class _FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, data) -> None:
        self.sent.append(data)


def test_connect_ws_ticket_is_signed_scoped_and_one_time(monkeypatch, request):
    from crate.db.repositories import connect_ws_tickets
    from crate.db.repositories.connect_ws_tickets import (
        clear_connect_ws_ticket_cache_for_tests,
        create_ws_ticket,
        validate_ws_ticket,
    )

    request.addfinalizer(clear_connect_ws_ticket_cache_for_tests)
    clear_connect_ws_ticket_cache_for_tests()
    monkeypatch.setenv("CRATE_CONNECT_WS_TICKET_SECRET", "connect-secret")
    monkeypatch.setattr(connect_ws_tickets, "get_redis", lambda: None)

    created = create_ws_ticket(42, device_id="desktop-1")
    validated = validate_ws_ticket(created["ticket"])

    assert created["ws_url"].startswith("/api/me/connect/ws?ticket=")
    assert validated is not None
    assert validated["user_id"] == 42
    assert validated["device_id"] == "desktop-1"
    assert validated["jti"]


def test_connect_ws_ticket_rejects_replay(monkeypatch, request):
    from crate.db.repositories import connect_ws_tickets
    from crate.db.repositories.connect_ws_tickets import (
        clear_connect_ws_ticket_cache_for_tests,
        create_ws_ticket,
        validate_ws_ticket,
    )

    request.addfinalizer(clear_connect_ws_ticket_cache_for_tests)
    clear_connect_ws_ticket_cache_for_tests()
    monkeypatch.setenv("CRATE_CONNECT_WS_TICKET_SECRET", "connect-secret")
    monkeypatch.setattr(connect_ws_tickets, "get_redis", lambda: None)

    created = create_ws_ticket(7, device_id="phone")
    first = validate_ws_ticket(created["ticket"])
    second = validate_ws_ticket(created["ticket"])

    assert first is not None
    assert first["user_id"] == 7
    assert first["device_id"] == "phone"
    assert second is None


def test_connect_hub_sends_and_broadcasts_locally(monkeypatch):
    from crate.db.repositories import connect_ws_hub
    from crate.db.repositories.connect_ws_hub import ConnectHub

    monkeypatch.setattr(connect_ws_hub, "get_redis", lambda: None)

    async def scenario():
        hub = ConnectHub(enable_pubsub=False)
        first = _FakeSocket()
        second = _FakeSocket()
        await hub.connect(
            1,
            "instance-a",
            first,
            device_id="device-a",
            device_label="Chrome",
        )
        await hub.connect(1, "instance-b", second, device_id="device-b")

        assert await hub.send_to_instance(1, "instance-a", {"type": "ping"}) is True
        await hub.broadcast_to_user(1, {"type": "state"}, exclude_instance="instance-a")
        snapshot = hub.connected_instances_snapshot(1)

        assert first.sent == [{"type": "ping"}]
        assert second.sent == [{"type": "state"}]
        assert hub.get_connected_instances(1) == {"instance-a", "instance-b"}
        assert hub.get_instance_meta(1, "instance-a").device_label == "Chrome"
        assert snapshot["instances"][0]["instance_id"] in {
            "instance-a",
            "instance-b",
        }

    asyncio.run(scenario())


def test_connect_hub_delivers_cross_worker_fanout(monkeypatch):
    from crate.db.repositories import connect_ws_hub
    from crate.db.repositories.connect_ws_hub import ConnectHub

    monkeypatch.setattr(connect_ws_hub, "get_redis", lambda: None)

    async def scenario():
        hub = ConnectHub(worker_id="worker-a", enable_pubsub=False)
        first = _FakeSocket()
        second = _FakeSocket()
        await hub.connect(1, "instance-a", first, device_id="device-a")
        await hub.connect(1, "instance-b", second, device_id="device-b")

        await hub._deliver_fanout_envelope(
            1,
            {
                "worker_id": "worker-b",
                "target_instance_id": "instance-b",
                "message": {"type": "targeted"},
            },
        )
        await hub._deliver_fanout_envelope(
            1,
            {
                "worker_id": "worker-b",
                "exclude_instance": "instance-b",
                "message": {"type": "broadcast"},
            },
        )
        await hub._deliver_fanout_envelope(
            1,
            {
                "worker_id": "worker-a",
                "message": {"type": "self-echo"},
            },
        )

        assert first.sent == [{"type": "broadcast"}]
        assert second.sent == [{"type": "targeted"}]

    asyncio.run(scenario())


def test_connect_player_state_updates_are_versioned(monkeypatch):
    from crate.db.repositories import connect_state
    from crate.db.repositories.connect_state import (
        ConnectStaleState,
        reset_player_state_cache_for_tests,
        set_player_state,
        update_player_state,
    )

    reset_player_state_cache_for_tests()
    monkeypatch.setattr(connect_state, "get_redis", lambda: None)

    initial = set_player_state(1, {"status": "paused", "version": 0})
    updated = update_player_state(
        1,
        {"status": "playing", "position_ms": 1200},
        expected_version=initial["version"],
    )

    assert updated["version"] == 1
    assert updated["status"] == "playing"
    assert updated["position_ms"] == 1200
    assert "position_updated_at" in updated

    try:
        update_player_state(1, {"status": "paused"}, expected_version=0)
    except ConnectStaleState:
        pass
    else:
        raise AssertionError("Expected stale PlayerState update to fail")


def test_connect_update_queue_extracts_current_track_fields():
    from crate.api.connect_ws import _updates_from_message
    from crate.api.schemas.connect_ws import ConnectClientMessage

    updates = _updates_from_message(
        ConnectClientMessage(
            type="update_queue",
            payload={
                "current_index": 1,
                "queue": [
                    {"title": "One", "artist": "Band"},
                    {
                        "album": "Album",
                        "album_cover": "/cover.jpg",
                        "artist": "Artist",
                        "duration": 123.4,
                        "path": "artist/album/track.flac",
                        "title": "Two",
                        "track_entity_uid": "track-uid",
                        "track_id": 42,
                    },
                ],
                "queue_revision": "rev-1",
                "repeat_mode": "all",
                "shuffle": True,
            },
        )
    )

    assert updates["current_index"] == 1
    assert updates["track"] == {
        "album": "Album",
        "album_cover": "/cover.jpg",
        "artist": "Artist",
        "duration_ms": 123400,
        "entity_uid": "track-uid",
        "id": 42,
        "path": "artist/album/track.flac",
        "title": "Two",
    }
    assert updates["title"] == "Two"
    assert updates["duration_ms"] == 123400
    assert updates["repeat"] == "all"
    assert updates["shuffle"] is True


def test_connect_update_snapshot_is_single_versioned_state_update():
    from crate.api.connect_ws import _updates_from_message
    from crate.api.schemas.connect_ws import ConnectClientMessage

    updates = _updates_from_message(
        ConnectClientMessage(
            type="update_snapshot",
            payload={
                "album": "Album",
                "album_cover": "/cover.jpg",
                "artist": "Artist",
                "current_index": 0,
                "duration_ms": 180000,
                "position_ms": 5500,
                "queue": [],
                "queue_revision": "rev-light",
                "repeat_mode": "off",
                "shuffle": False,
                "status": "playing",
                "title": "Track",
                "track_entity_uid": "track-uid",
                "track_id": 10,
            },
        )
    )

    assert updates["status"] == "playing"
    assert updates["position_ms"] == 5500
    assert updates["queue_revision"] == "rev-light"
    assert updates["track"] == {
        "album": "Album",
        "album_cover": "/cover.jpg",
        "artist": "Artist",
        "duration_ms": 180000,
        "entity_uid": "track-uid",
        "id": 10,
        "path": None,
        "title": "Track",
    }


def test_connect_state_update_echoes_next_version_to_sender(monkeypatch, request):
    from crate.api.connect_ws import handle_message
    from crate.api.schemas.connect_ws import ConnectClientMessage
    from crate.db.repositories import connect_state, connect_ws_hub
    from crate.db.repositories.connect_state import (
        reset_player_state_cache_for_tests,
        set_player_state,
    )
    from crate.db.repositories.connect_ws_hub import ConnectHub

    request.addfinalizer(reset_player_state_cache_for_tests)
    reset_player_state_cache_for_tests()
    monkeypatch.setattr(connect_state, "get_redis", lambda: None)
    monkeypatch.setattr(connect_ws_hub, "get_redis", lambda: None)

    async def scenario():
        hub = ConnectHub(enable_pubsub=False)
        socket = _FakeSocket()
        await hub.connect(1, "instance-a", socket, device_id="device-a")
        set_player_state(
            1,
            {
                "active_device_id": "device-a",
                "active_instance_id": "instance-a",
                "position_ms": 0,
                "session_id": "11111111-1111-1111-1111-111111111111",
                "status": "playing",
                "version": 0,
            },
        )

        await handle_message(
            1,
            "instance-a",
            "device-a",
            ConnectClientMessage(
                type="update_position",
                payload={"position_ms": 1234},
                version=0,
            ),
            hub,
        )

        assert socket.sent[-1]["type"] == "player_state_update"
        assert socket.sent[-1]["version"] == 1
        assert socket.sent[-1]["payload"]["position_ms"] == 1234

    asyncio.run(scenario())


def test_connect_volume_command_is_directed_to_active_instance(monkeypatch, request):
    from crate.api.connect_ws import handle_message
    from crate.api.schemas.connect_ws import ConnectClientMessage
    from crate.db.repositories import connect_state, connect_ws_hub
    from crate.db.repositories.connect_state import (
        reset_player_state_cache_for_tests,
        set_player_state,
    )
    from crate.db.repositories.connect_ws_hub import ConnectHub

    request.addfinalizer(reset_player_state_cache_for_tests)
    reset_player_state_cache_for_tests()
    monkeypatch.setattr(connect_state, "get_redis", lambda: None)
    monkeypatch.setattr(connect_ws_hub, "get_redis", lambda: None)

    async def scenario():
        hub = ConnectHub(enable_pubsub=False)
        active_socket = _FakeSocket()
        controller_socket = _FakeSocket()
        await hub.connect(1, "instance-a", active_socket, device_id="device-a")
        await hub.connect(1, "instance-b", controller_socket, device_id="device-b")
        set_player_state(
            1,
            {
                "active_device_id": "device-a",
                "active_instance_id": "instance-a",
                "session_id": "11111111-1111-1111-1111-111111111111",
                "status": "playing",
                "version": 4,
            },
        )

        await handle_message(
            1,
            "instance-b",
            "device-b",
            ConnectClientMessage(
                type="volume",
                payload={"volume": 0.42},
                version=4,
            ),
            hub,
        )

        assert active_socket.sent[-1] == {
            "type": "volume",
            "payload": {"volume": 0.42},
            "version": 4,
        }
        assert controller_socket.sent == []

    asyncio.run(scenario())


def test_connect_transfer_incoming_includes_pending_state_version(monkeypatch, request):
    from crate.api.connect_ws import handle_message
    from crate.api.schemas.connect_ws import ConnectClientMessage
    from crate.db.repositories import connect_state, connect_ws_hub
    from crate.db.repositories.connect_state import (
        reset_player_state_cache_for_tests,
        set_player_state,
    )
    from crate.db.repositories.connect_ws_hub import ConnectHub

    request.addfinalizer(reset_player_state_cache_for_tests)
    reset_player_state_cache_for_tests()
    monkeypatch.setattr(connect_state, "get_redis", lambda: None)
    monkeypatch.setattr(connect_ws_hub, "get_redis", lambda: None)

    async def scenario():
        hub = ConnectHub(enable_pubsub=False)
        source_socket = _FakeSocket()
        target_socket = _FakeSocket()
        await hub.connect(1, "instance-a", source_socket, device_id="device-a")
        await hub.connect(1, "instance-b", target_socket, device_id="device-b")
        set_player_state(
            1,
            {
                "active_device_id": "device-a",
                "active_instance_id": "instance-a",
                "queue": [{"title": "Track", "artist": "Artist"}],
                "session_id": "11111111-1111-1111-1111-111111111111",
                "status": "playing",
                "version": 4,
            },
        )

        await handle_message(
            1,
            "instance-b",
            "device-b",
            ConnectClientMessage(
                type="transfer_request",
                payload={"target_instance_id": "instance-b"},
                version=4,
            ),
            hub,
        )

        assert target_socket.sent[-1]["type"] == "transfer_incoming"
        assert target_socket.sent[-1]["version"] == 5
        assert target_socket.sent[-1]["payload"]["state"]["version"] == 5
        assert target_socket.sent[-1]["payload"]["state"]["transfer_state"] == "pending"

    asyncio.run(scenario())


def test_connect_ws_endpoint_performs_ticketed_hello(test_app, monkeypatch, request):
    from crate.api import connect_ws
    from crate.db.repositories import connect_ws_tickets
    from crate.db.repositories.connect_ws_tickets import (
        clear_connect_ws_ticket_cache_for_tests,
    )

    request.addfinalizer(clear_connect_ws_ticket_cache_for_tests)
    clear_connect_ws_ticket_cache_for_tests()
    monkeypatch.setenv("CRATE_CONNECT_WS_TICKET_SECRET", "connect-secret")
    monkeypatch.setattr(connect_ws_tickets, "get_redis", lambda: None)
    monkeypatch.setattr(connect_ws, "upsert_device", lambda *args, **kwargs: {})
    monkeypatch.setattr(connect_ws, "mark_device_present", lambda *args, **kwargs: {})
    monkeypatch.setattr(
        connect_ws,
        "get_player_state",
        lambda user_id: {
            "session_id": "11111111-1111-1111-1111-111111111111",
            "active_instance_id": "instance-a",
            "status": "playing",
            "position_ms": 0,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "version": 3,
        },
    )

    response = test_app.post(
        "/api/me/connect/ws-ticket", json={"device_id": "device-a"}
    )
    assert response.status_code == 200
    ticket = response.json()["ticket"]

    with test_app.websocket_connect(f"/api/me/connect/ws?ticket={ticket}") as ws:
        server_hello = ws.receive_json()
        assert server_hello["type"] == "hello"
        ws.send_json(
            {
                "type": "hello",
                "payload": {
                    "device_id": "device-a",
                    "playback_instance_id": "instance-a",
                    "device_label": "Chrome",
                    "capabilities": {"can_play": True},
                },
            }
        )
        connected = ws.receive_json()
        player_state = ws.receive_json()

    assert connected["type"] == "connected_instances"
    assert connected["payload"]["active_instance_id"] == "instance-a"
    assert player_state["type"] == "player_state"
    assert player_state["version"] == 3
