"""Tests for jam room sync playback and Redis-backed pub/sub hub."""

import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest


class _FakeRedis:
    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.store: dict[str, str] = {}
        self.published: list[tuple[str, str]] = []

    async def set(
        self, key: str, value: str, *, nx: bool = False, ex: int | None = None
    ):
        del ex
        if self.fail:
            raise RuntimeError("redis down")
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def get(self, key: str):
        if self.fail:
            raise RuntimeError("redis down")
        return self.store.get(key)

    async def delete(self, key: str):
        if self.fail:
            raise RuntimeError("redis down")
        self.store.pop(key, None)
        return 1

    async def expire(self, key: str, ttl: int):
        del ttl
        if self.fail:
            raise RuntimeError("redis down")
        return key in self.store

    async def publish(self, channel: str, payload: str):
        if self.fail:
            raise RuntimeError("redis down")
        self.published.append((channel, payload))
        return 1


@pytest.fixture(autouse=True)
def reset_jam_runtime_state():
    from crate.api import jam

    jam._sync_clocks.clear()
    jam._local_heartbeat_owners.clear()
    yield
    jam._sync_clocks.clear()
    jam._local_heartbeat_owners.clear()


class TestJamRoomCRUD:
    """Basic CRUD operations on jam rooms still work with new architecture."""

    def test_room_has_current_track_distinguishes_idle_from_explicit_pause(self):
        from crate.api import jam

        assert jam._room_has_current_track(None) is False
        assert jam._room_has_current_track({"track": None, "playing": False}) is False
        assert (
            jam._room_has_current_track({"track": {"id": "track-1"}, "playing": False})
            is True
        )

    def test_create_and_get_room(self, pg_db):
        host = pg_db.create_user("jam-dj@test.com")
        room = pg_db.create_jam_room(host["id"], "Friday Night Spin")

        assert room["host_user_id"] == host["id"]
        assert room["name"] == "Friday Night Spin"
        assert room["status"] == "active"

    def test_room_listing_counts_only_active_members(self, pg_db):
        from sqlalchemy import text

        from crate.db.tx import transaction_scope

        host = pg_db.create_user("jam-active-host@test.com")
        guest = pg_db.create_user("jam-stale-guest@test.com")
        room = pg_db.create_jam_room(host["id"], "Presence Room")
        pg_db.upsert_jam_room_member(room["id"], guest["id"], role="collab")

        stale_seen_at = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE jam_room_members
                    SET last_seen_at = :last_seen_at
                    WHERE room_id = :room_id AND user_id = :user_id
                    """
                ),
                {
                    "last_seen_at": stale_seen_at,
                    "room_id": room["id"],
                    "user_id": guest["id"],
                },
            )

        listed_room = next(
            item
            for item in pg_db.list_jam_rooms_for_user(host["id"])
            if item["id"] == room["id"]
        )
        fetched_room = pg_db.get_jam_room(room["id"])

        assert listed_room["is_member"] is True
        assert listed_room["member_count"] == 1
        assert fetched_room is not None
        assert fetched_room["member_count"] == 1
        assert room["visibility"] == "private"
        assert room["is_permanent"] is False

        fetched = pg_db.get_jam_room(room["id"])
        assert fetched["id"] == room["id"]

    def test_queue_mode_is_persisted_and_updated(self, pg_db):
        host = pg_db.create_user("jam-mode-host@test.com")
        room = pg_db.create_jam_room(host["id"], "Auto Room", queue_mode="auto")

        assert room["queue_mode"] == "auto"
        assert pg_db.get_jam_room(room["id"])["queue_mode"] == "auto"

        updated = pg_db.update_jam_room_settings(room["id"], queue_mode="manual")
        assert updated is not None
        assert updated["queue_mode"] == "manual"

    def test_auto_dj_prime_is_enqueued_instead_of_running_in_the_api(self, monkeypatch):
        from crate.api import jam

        room = {"id": "auto-room-1", "queue_mode": "auto_dj"}
        scheduled: list[tuple[str, dict, str]] = []

        monkeypatch.setattr(jam, "get_jam_room", lambda room_id: room)
        monkeypatch.setattr(
            jam,
            "create_task_dedup",
            lambda task_type, params, *, dedup_key: (
                scheduled.append((task_type, params, dedup_key)) or "task-1"
            ),
        )

        assert jam._prime_auto_dj_room(room) == room
        assert scheduled == [
            (
                "prime_jam_auto_dj",
                {"room_id": "auto-room-1"},
                "jam-auto-dj:auto-room-1",
            )
        ]

    def test_visibility_and_permanence_are_listable(self, pg_db):
        host = pg_db.create_user("public-jam-host@test.com")
        guest = pg_db.create_user("public-jam-guest@test.com")
        outsider = pg_db.create_user("public-jam-outsider@test.com")
        public_room = pg_db.create_jam_room(
            host["id"],
            "Open Room",
            visibility="public",
            is_permanent=True,
        )
        private_room = pg_db.create_jam_room(host["id"], "Invite Room")
        pg_db.upsert_jam_room_member(private_room["id"], guest["id"], role="collab")

        guest_rooms = {
            room["id"]: room for room in pg_db.list_jam_rooms_for_user(guest["id"])
        }
        outsider_rooms = {
            room["id"]: room for room in pg_db.list_jam_rooms_for_user(outsider["id"])
        }

        assert public_room["id"] in guest_rooms
        assert private_room["id"] in guest_rooms
        assert public_room["id"] in outsider_rooms
        assert private_room["id"] not in outsider_rooms
        assert guest_rooms[public_room["id"]]["visibility"] == "public"
        assert guest_rooms[public_room["id"]]["is_permanent"] is True

    def test_public_room_metadata_is_searchable(self, pg_db):
        host = pg_db.create_user("search-room-host@test.com")
        guest = pg_db.create_user("search-room-guest@test.com")
        matching = pg_db.create_jam_room(
            host["id"],
            "Haunted Signals",
            visibility="public",
            is_permanent=True,
            description="Post-punk, cold wave and 90s guitar music.",
            tags=["post-punk", "90s"],
        )
        pg_db.create_jam_room(
            host["id"],
            "Morning Ambient",
            visibility="public",
            is_permanent=True,
            tags=["ambient"],
        )

        post_punk_rooms = pg_db.list_jam_rooms_for_user(guest["id"], query="post-punk")
        nineties_rooms = pg_db.list_jam_rooms_for_user(guest["id"], query="90s")

        assert [room["id"] for room in post_punk_rooms] == [matching["id"]]
        assert [room["id"] for room in nineties_rooms] == [matching["id"]]
        assert (
            post_punk_rooms[0]["description"]
            == "Post-punk, cold wave and 90s guitar music."
        )
        assert post_punk_rooms[0]["tags"] == ["post-punk", "90s"]

    def test_room_members_and_roles(self, pg_db):
        host = pg_db.create_user("jam-master@test.com")
        guest = pg_db.create_user("jam-buddy@test.com")
        room = pg_db.create_jam_room(host["id"], "Collab Room")

        pg_db.upsert_jam_room_member(room["id"], guest["id"], role="collab")

        members = pg_db.get_jam_room_members(room["id"])
        assert len(members) == 2  # host auto-joined + guest
        roles = {m["role"] for m in members}
        assert roles == {"host", "collab"}

    def test_disconnected_members_are_removed_from_room_presence_but_can_rejoin(
        self, pg_db
    ):
        from crate.db.jam_members import (
            mark_jam_room_member_offline,
            touch_jam_room_member,
        )

        host = pg_db.create_user("jam-presence-host@test.com")
        guest = pg_db.create_user("jam-presence-guest@test.com")
        room = pg_db.create_jam_room(host["id"], "Presence Room")
        pg_db.upsert_jam_room_member(room["id"], guest["id"], role="collab")

        assert {
            member["user_id"] for member in pg_db.get_jam_room_members(room["id"])
        } == {
            host["id"],
            guest["id"],
        }

        assert mark_jam_room_member_offline(room["id"], guest["id"])
        assert [
            member["user_id"]
            for member in pg_db.get_jam_room_members(room["id"], active_only=True)
        ] == [host["id"]]

        assert touch_jam_room_member(room["id"], guest["id"])
        assert {
            member["user_id"]
            for member in pg_db.get_jam_room_members(room["id"], active_only=True)
        } == {host["id"], guest["id"]}

    def test_invite_flow(self, pg_db):
        host = pg_db.create_user("invite-master@test.com")
        pg_db.create_user("invite-joiner@test.com")
        room = pg_db.create_jam_room(host["id"], "Invite Room")

        invite = pg_db.create_jam_room_invite(room["id"], host["id"])
        assert invite["room_id"] == room["id"]
        assert invite["token"]

        # Consume invite
        consumed = pg_db.consume_jam_room_invite(invite["token"])
        assert consumed is not None
        assert consumed["room_id"] == room["id"]


class TestJamSyncClock:
    """Server-side playback clock for synchronized listening."""

    def test_sync_payload_projects_position_at_a_server_timestamp(self):
        """A sync message must carry the server timestamp used for its position."""
        from crate.api import jam

        clock = {
            "track": {"id": "track-1"},
            "position_ms": 10000.0,
            "playing": True,
            "clock_started_at": 100.0,
        }

        payload = jam._build_sync_clock_payload(clock, now_ms=100250.0)

        assert payload["server_time_ms"] == 100250.0
        assert payload["position_ms"] == 10250.0

    def test_sync_payload_does_not_advance_a_paused_clock(self):
        """A paused sync remains exact even when it is sent later."""
        from crate.api import jam

        clock = {
            "track": {"id": "track-1"},
            "position_ms": 10000.0,
            "playing": False,
            "clock_started_at": 100.0,
        }

        payload = jam._build_sync_clock_payload(clock, now_ms=100250.0)

        assert payload["server_time_ms"] == 100250.0
        assert payload["position_ms"] == 10000.0

    def test_set_and_get_clock_roundtrips(self, monkeypatch):
        """Write a clock, read it back, verify compute_expected_position."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())
        room_id = "clock-room"
        track = {"id": "track-1", "title": "Dark Horse", "artist": "Converge"}

        before = datetime.now(timezone.utc).timestamp()
        clock = asyncio.run(
            jam._set_sync_clock(room_id, track=track, position_ms=30000.0, playing=True)
        )
        after = datetime.now(timezone.utc).timestamp()

        assert clock["track"] == track
        assert clock["position_ms"] == 30000.0
        assert clock["playing"] is True
        assert before <= clock["clock_started_at"] <= after

        stored = asyncio.run(jam._get_sync_clock(room_id))
        assert stored is not None
        assert stored["track"] == track
        assert stored["position_ms"] == 30000.0

        time.sleep(0.05)
        expected = asyncio.run(jam._compute_expected_position(stored))
        assert expected >= stored["position_ms"] + 40  # at least 40ms passed

        asyncio.run(
            jam._set_sync_clock(
                room_id, track=track, position_ms=expected, playing=False
            )
        )

        paused = asyncio.run(jam._get_sync_clock(room_id))
        assert paused is not None
        assert paused["playing"] is False

        time.sleep(0.05)
        paused_expected = asyncio.run(jam._compute_expected_position(paused))
        assert paused_expected == paused["position_ms"]

        asyncio.run(jam._clear_sync_clock(room_id))
        assert asyncio.run(jam._get_sync_clock(room_id)) is None

    def test_compute_expected_position_when_paused(self, monkeypatch):
        """Paused clock returns exact position, not computed."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())
        room_id = "paused-room"

        asyncio.run(
            jam._set_sync_clock(
                room_id, track={"id": "t-1"}, position_ms=45000.0, playing=False
            )
        )
        stored = asyncio.run(jam._get_sync_clock(room_id))
        assert stored is not None
        assert asyncio.run(jam._compute_expected_position(stored)) == 45000.0

    def test_clock_advances_while_playing(self, monkeypatch):
        """While playing, position increases with wall clock time."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())
        room_id = "play-room"

        asyncio.run(
            jam._set_sync_clock(
                room_id, track={"id": "t-2"}, position_ms=10000.0, playing=True
            )
        )
        time.sleep(0.1)

        stored = asyncio.run(jam._get_sync_clock(room_id))
        assert stored is not None
        expected = asyncio.run(jam._compute_expected_position(stored))
        assert expected >= 10080.0

    def test_seek_resets_clock_position(self, monkeypatch):
        """Seek event resets the clock to a new position."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())
        room_id = "seek-room"

        asyncio.run(
            jam._set_sync_clock(
                room_id, track={"id": "t-3"}, position_ms=60000.0, playing=True
            )
        )
        asyncio.run(
            jam._set_sync_clock(
                room_id, track={"id": "t-3"}, position_ms=120000.0, playing=True
            )
        )

        stored = asyncio.run(jam._get_sync_clock(room_id))
        assert stored is not None
        assert stored["position_ms"] == 120000.0


class TestJamEndToEnd:
    """End-to-end room lifecycle: create, join, events, end."""

    def test_full_room_lifecycle(self, pg_db):
        """Create room, add member, emit events, end room, verify cleanup."""
        host = pg_db.create_user("e2e-host@test.com")
        guest = pg_db.create_user("e2e-guest@test.com")
        room = pg_db.create_jam_room(host["id"], "E2E Test Room")

        # Guest joins
        pg_db.upsert_jam_room_member(room["id"], guest["id"], role="collab")

        # Emit some events
        pg_db.append_jam_room_event(
            room["id"],
            "queue_add",
            {
                "track": {"id": "x", "title": "Song 1", "artist": "Artist 1"},
                "index": 0,
            },
            guest["id"],
        )

        pg_db.append_jam_room_event(
            room["id"],
            "play",
            {
                "track": {"id": "x", "title": "Song 1", "artist": "Artist 1"},
                "position": 0,
                "playing": True,
            },
            host["id"],
        )

        events = pg_db.list_jam_room_events(room["id"], limit=50)
        assert [event["event_type"] for event in events] == ["queue_add", "play"]
        assert events[0]["username"] == guest["username"]
        assert events[1]["username"] == host["username"]

        # End room
        ended_at = datetime.now(timezone.utc).isoformat()
        updated = pg_db.update_jam_room_state(
            room["id"], status="ended", ended_at=ended_at
        )
        assert updated is not None
        assert updated["status"] == "ended"

        # Room still fetchable after ending
        still_there = pg_db.get_jam_room(room["id"])
        assert still_there is not None
        assert still_there["status"] == "ended"

    def test_room_activity_events_include_actor_profile(self, pg_db):
        host = pg_db.create_user(
            "diego@test.com",
            name="Diego",
            username="diego",
            avatar="https://example.test/diego.jpg",
        )
        room = pg_db.create_jam_room(host["id"], "Profile Room")

        event = pg_db.append_jam_room_event(
            room["id"],
            "queue_add",
            {
                "track": {"id": "song-1", "title": "Song 1", "artist": "Artist 1"},
            },
            host["id"],
        )
        events = pg_db.list_jam_room_events(room["id"], limit=10)
        members = pg_db.get_jam_room_members(room["id"])

        assert event["display_name"] == "Diego"
        assert event["avatar"] == "https://example.test/diego.jpg"
        assert events[0]["display_name"] == "Diego"
        assert events[0]["avatar"] == "https://example.test/diego.jpg"
        assert members[0]["display_name"] == "Diego"
        assert members[0]["avatar"] == "https://example.test/diego.jpg"

    def test_cleanup_purges_old_ended_rooms(self, pg_db):
        """Ended rooms older than max_age_days are purged with cascade."""
        host = pg_db.create_user("purge@test.com")
        room = pg_db.create_jam_room(host["id"], "To Be Purged")
        old_ended = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        pg_db.update_jam_room_state(room["id"], status="ended", ended_at=old_ended)

        deleted = pg_db.cleanup_ended_jam_rooms(max_age_days=30)
        assert deleted == 1
        assert pg_db.get_jam_room(room["id"]) is None

    def test_cleanup_keeps_permanent_ended_rooms(self, pg_db):
        """Permanent rooms are retained even if they have been ended."""
        host = pg_db.create_user("permanent-purge@test.com")
        room = pg_db.create_jam_room(host["id"], "Permanent Room", is_permanent=True)
        old_ended = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        pg_db.update_jam_room_state(room["id"], status="ended", ended_at=old_ended)

        deleted = pg_db.cleanup_ended_jam_rooms(max_age_days=30)

        assert deleted == 0
        assert pg_db.get_jam_room(room["id"]) is not None

    def test_permanent_ended_rooms_stay_visible_and_reopenable(self, pg_db):
        host = pg_db.create_user("permanent-visible@test.com")
        outsider = pg_db.create_user("permanent-outsider@test.com")
        private_room = pg_db.create_jam_room(
            host["id"], "Private Permanent", is_permanent=True
        )
        public_room = pg_db.create_jam_room(
            host["id"],
            "Public Permanent",
            visibility="public",
            is_permanent=True,
        )
        ended_at = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        pg_db.update_jam_room_state(
            private_room["id"], status="ended", ended_at=ended_at
        )
        pg_db.update_jam_room_state(
            public_room["id"], status="ended", ended_at=ended_at
        )

        host_rooms = {
            room["id"]: room for room in pg_db.list_jam_rooms_for_user(host["id"])
        }
        outsider_rooms = {
            room["id"]: room for room in pg_db.list_jam_rooms_for_user(outsider["id"])
        }

        assert host_rooms[private_room["id"]]["status"] == "ended"
        assert host_rooms[public_room["id"]]["status"] == "ended"
        assert private_room["id"] not in outsider_rooms
        assert public_room["id"] in outsider_rooms

        reopened = pg_db.reactivate_permanent_jam_room(private_room["id"])

        assert reopened is not None
        assert reopened["status"] == "active"
        assert reopened["ended_at"] is None

    def test_delete_jam_room_removes_room_and_related_rows(self, pg_db):
        host = pg_db.create_user("room-delete@test.com")
        room = pg_db.create_jam_room(host["id"], "Disposable Room")
        invite = pg_db.create_jam_room_invite(room["id"], host["id"])
        pg_db.append_jam_room_event(
            room["id"],
            "queue_add",
            {
                "track": {"id": "song-1", "title": "Song 1", "artist": "Artist 1"},
            },
            host["id"],
        )

        assert pg_db.delete_jam_room(room["id"]) is True

        assert pg_db.get_jam_room(room["id"]) is None
        assert pg_db.consume_jam_room_invite(invite["token"]) is None
        assert pg_db.list_jam_room_events(room["id"], limit=10) == []


class TestJamSyncClockEdgeCases:
    """Sync clock edge cases."""

    def test_no_clock_for_nonexistent_room(self, monkeypatch):
        """Getting clock for a room that never had one returns None."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())
        result = asyncio.run(jam._get_sync_clock("nonexistent-room-id"))
        assert result is None

    def test_clear_nonexistent_clock_is_noop(self, monkeypatch):
        """Clearing a clock that doesn't exist should not error."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())
        asyncio.run(jam._clear_sync_clock("nonexistent-room-id"))

    def test_multiple_rooms_have_independent_clocks(self, monkeypatch):
        """Each room's clock is independent."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis())

        asyncio.run(
            jam._set_sync_clock(
                "room-a", track={"id": "a"}, position_ms=1000.0, playing=True
            )
        )
        asyncio.run(
            jam._set_sync_clock(
                "room-b", track={"id": "b"}, position_ms=5000.0, playing=False
            )
        )

        clock_a = asyncio.run(jam._get_sync_clock("room-a"))
        clock_b = asyncio.run(jam._get_sync_clock("room-b"))

        assert clock_a is not None
        assert clock_b is not None
        assert clock_a["track"]["id"] == "a"
        assert clock_b["track"]["id"] == "b"
        assert clock_a["position_ms"] == 1000.0
        assert clock_b["position_ms"] == 5000.0

    def test_clock_uses_local_fallback_when_redis_fails(self, monkeypatch):
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis(fail=True))

        asyncio.run(
            jam._set_sync_clock(
                "fallback-room", track={"id": "x"}, position_ms=1200.0, playing=False
            )
        )
        stored = asyncio.run(jam._get_sync_clock("fallback-room"))

        assert stored is not None
        assert stored["track"]["id"] == "x"
        assert stored["position_ms"] == 1200.0


class TestJamWebSocketAuth:
    def test_accepts_listen_cookie(self, monkeypatch):
        from crate.api import jam
        from crate.api.auth import COOKIE_NAME_LISTEN

        class FakeWebSocket:
            query_params = {}
            headers = {}
            cookies = {COOKIE_NAME_LISTEN: "valid-token"}

        monkeypatch.setattr(
            jam,
            "verify_jwt",
            lambda token: (
                {"user_id": 42, "sid": "session-1"} if token == "valid-token" else None
            ),
        )
        monkeypatch.setattr(
            jam,
            "get_session",
            lambda session_id: {
                "id": session_id,
                "user_id": 42,
                "revoked_at": None,
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
            },
        )

        assert jam._auth_ws(FakeWebSocket())["user_id"] == 42

    def test_rejects_revoked_session(self, monkeypatch):
        from fastapi import HTTPException
        from crate.api import jam
        from crate.api.auth import COOKIE_NAME_LISTEN

        class FakeWebSocket:
            query_params = {}
            headers = {}
            cookies = {COOKIE_NAME_LISTEN: "valid-token"}

        monkeypatch.setattr(
            jam, "verify_jwt", lambda token: {"user_id": 42, "sid": "session-1"}
        )
        monkeypatch.setattr(
            jam,
            "get_session",
            lambda session_id: {
                "id": session_id,
                "user_id": 42,
                "revoked_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
            },
        )

        with pytest.raises(HTTPException):
            jam._auth_ws(FakeWebSocket())


class TestJamSerialization:
    def test_json_payload_serializes_uuid_and_datetime(self):
        from crate.api import jam

        room_id = uuid4()
        now = datetime.now(timezone.utc)

        payload = jam._json_payload(
            {
                "room": {
                    "id": room_id,
                    "created_at": now,
                },
            }
        )

        assert payload == {
            "room": {
                "id": str(room_id),
                "created_at": now.isoformat(),
            },
        }


class TestJamResilience:
    """Error paths for WebSocket and Redis must not crash the hub."""

    def test_broadcast_skips_broken_peer(self):
        """If send_json fails, the peer is removed so others keep receiving."""
        import asyncio
        from crate.api import jam

        class BrokenWebSocket:
            async def send_json(self, payload):
                raise RuntimeError("socket closed")

            async def send_text(self, payload):
                pass

            async def close(self, *, code, reason=""):
                pass

        class OKWebSocket:
            sent: list[dict] = []

            async def send_json(self, payload):
                self.sent.append(payload)

            async def send_text(self, payload):
                pass

            async def close(self, *, code, reason=""):
                pass

        broken_peer = jam._JamPeer(BrokenWebSocket())
        ok_ws = OKWebSocket()
        ok_peer = jam._JamPeer(ok_ws)

        async def _test():
            await jam._local_hub.connect("room-1", broken_peer)
            await jam._local_hub.connect("room-1", ok_peer)
            await jam._local_hub.broadcast("room-1", {"type": "test"})
            peers = jam._local_hub._rooms.get("room-1", set())
            assert broken_peer not in peers
            assert ok_peer in peers
            assert len(ok_ws.sent) == 1
            await jam._local_hub.disconnect("room-1", ok_peer)

        asyncio.run(_test())

    def test_broadcast_to_room_fallback_when_redis_fails(self, monkeypatch):
        """Redis publish failure must fall back to local broadcast without raising."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis(fail=True))

        async def _test():
            await jam._broadcast_to_room("room-fb", {"type": "test"})

        asyncio.run(_test())

    def test_broadcast_to_room_does_not_duplicate_origin_delivery(self, monkeypatch):
        """A Redis-backed event must not also be sent directly to its origin."""
        import asyncio
        from crate.api import jam

        redis = _FakeRedis()
        monkeypatch.setattr(jam, "get_async_redis", lambda: redis)

        class WebSocket:
            def __init__(self):
                self.sent: list[dict] = []

            async def send_json(self, payload):
                self.sent.append(payload)

            async def send_text(self, payload):
                del payload

            async def close(self, *, code, reason=""):
                del code, reason

        peer = jam._JamPeer(WebSocket())
        peer.distributed = True

        async def _test():
            await jam._broadcast_to_room(
                "room-direct",
                {"type": "play_next"},
            )

        asyncio.run(_test())

        assert len(redis.published) == 1
        assert peer.websocket.sent == []

    def test_close_room_suppresses_peer_errors(self):
        """Closing a room must succeed even if individual peers are already dead."""
        import asyncio
        from crate.api import jam

        class BrokenWebSocket:
            async def close(self, *, code, reason=""):
                raise RuntimeError("already closed")

            async def send_json(self, payload):
                pass

            async def send_text(self, payload):
                pass

        peer = jam._JamPeer(BrokenWebSocket())

        async def _test():
            await jam._local_hub.connect("room-close", peer)
            await jam._local_hub.close_room("room-close")
            assert "room-close" not in jam._local_hub._rooms

        asyncio.run(_test())

    def test_heartbeat_lock_fallback_when_redis_fails(self, monkeypatch):
        """Heartbeat lock operations must fall back to in-memory owners when Redis is down."""
        import asyncio
        from crate.api import jam

        monkeypatch.setattr(jam, "get_async_redis", lambda: _FakeRedis(fail=True))

        async def _test():
            acquired = await jam._acquire_heartbeat_lock("room-hb", "owner-1")
            assert acquired is True
            renewed = await jam._renew_heartbeat_lock("room-hb", "owner-1")
            assert renewed is True
            await jam._release_heartbeat_lock("room-hb", "owner-1")
            assert jam._local_heartbeat_owners.get("room-hb") is None

        asyncio.run(_test())
