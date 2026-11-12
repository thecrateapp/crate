"""Every Redis pub/sub opened for an SSE or WebSocket stream is released.

A pubsub that is never closed keeps its connection out of the API's async Redis
pool for the life of the process. Once the pool is full, every other user of it
fails: the Stack page's watch flag, the snapshot SSE streams, Jam room sync.
"""

import asyncio
import json
import logging

import pytest


class _TrackedPubSub:
    def __init__(self, messages=(), *, subscribe_error: Exception | None = None):
        self.messages = list(messages)
        self.subscribe_error = subscribe_error
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        if self.subscribe_error is not None:
            raise self.subscribe_error
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def listen(self):
        for message in self.messages:
            yield message
        while True:
            await asyncio.sleep(3600)

    async def get_message(self, ignore_subscribe_messages=True, timeout=1.0):
        del ignore_subscribe_messages, timeout
        return self.messages.pop(0) if self.messages else None

    async def aclose(self) -> None:
        self.closed = True


class _PubSubLedger:
    """Stands in for ``open_pubsub``/``close_pubsub`` and counts what is still open."""

    def __init__(self, messages=()):
        self.messages = messages
        self.opened: list[_TrackedPubSub] = []
        self.closed: list[_TrackedPubSub] = []

    async def open_pubsub(self, channel: str):
        pubsub = _TrackedPubSub(self.messages)
        await pubsub.subscribe(channel)
        self.opened.append(pubsub)
        return pubsub

    async def close_pubsub(self, pubsub, channel: str) -> None:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        self.closed.append(pubsub)

    @property
    def still_open(self) -> int:
        return len([p for p in self.opened if p not in self.closed])


def _install_task_stream(monkeypatch, ledger, *, status, events=None):
    from crate.api import events as events_api

    monkeypatch.setattr(events_api, "open_pubsub", ledger.open_pubsub)
    monkeypatch.setattr(events_api, "close_pubsub", ledger.close_pubsub)
    replay = (
        events
        if events is not None
        else [
            {
                "id": 1,
                "event_type": "info",
                "data": {"message": "started"},
                "created_at": "2026-11-12T10:00:00Z",
            }
        ]
    )
    monkeypatch.setattr(
        events_api,
        "get_task_events",
        replay if callable(replay) else (lambda *_a, **_k: list(replay)),
    )
    monkeypatch.setattr(
        events_api,
        "get_task",
        lambda _task_id: {"status": status, "label": "Scan", "result": None},
    )
    return events_api


def _drain(stream, *, limit: int = 20):
    async def run():
        items = []
        async for item in stream:
            items.append(item)
            if len(items) >= limit:
                break
        await stream.aclose()
        return items

    return asyncio.run(run())


# ── events._task_stream_pubsub ──────────────────────────────────────


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
def test_task_stream_for_a_finished_task_closes_its_subscription(monkeypatch, status):
    ledger = _PubSubLedger()
    events_api = _install_task_stream(monkeypatch, ledger, status=status)

    items = _drain(events_api._task_stream_pubsub("done-task", generic=True))

    assert items[-1].startswith("event: task_done\n")
    assert json.loads(items[-1].split("data: ", 1)[1])["status"] == status
    assert len(ledger.opened) == 1
    assert ledger.still_open == 0
    assert ledger.opened[0].closed is True


def test_task_stream_closes_its_subscription_when_the_client_leaves_during_replay(
    monkeypatch,
):
    ledger = _PubSubLedger()
    events_api = _install_task_stream(monkeypatch, ledger, status="running")

    items = _drain(events_api._task_stream_pubsub("busy-task"), limit=1)

    assert len(items) == 1
    assert ledger.still_open == 0


def test_task_stream_closes_its_subscription_before_falling_back_to_polling(
    monkeypatch,
):
    ledger = _PubSubLedger()
    calls = {"n": 0}

    def flaky_events(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("database hiccup")
        return []

    events_api = _install_task_stream(
        monkeypatch, ledger, status="completed", events=flaky_events
    )

    items = _drain(events_api._task_stream_pubsub("hiccup-task"))

    assert items[-1].startswith("event: task_done\n")
    assert ledger.still_open == 0


def test_task_stream_for_a_running_task_closes_its_subscription_on_task_done(
    monkeypatch,
):
    ledger = _PubSubLedger(
        [
            {
                "type": "message",
                "data": json.dumps(
                    {"event_type": "task_done", "data": {"status": "completed"}}
                ),
            }
        ]
    )
    events_api = _install_task_stream(monkeypatch, ledger, status="running")

    items = _drain(events_api._task_stream_pubsub("live-task"))

    assert items[-1].startswith("event: task_done\n")
    assert ledger.still_open == 0


# ── redis_sse helpers ───────────────────────────────────────────────


class _FakeAsyncRedis:
    def __init__(self, pubsub):
        self._pubsub = pubsub

    def pubsub(self):
        return self._pubsub


@pytest.fixture
def redis_sse(monkeypatch):
    from crate.api import redis_sse as module

    module._reset_pubsub_tracking_for_tests()
    recorded: list[tuple[str, float, dict]] = []
    monkeypatch.setattr(
        module,
        "record_later",
        lambda name, value, tags=None: recorded.append((name, value, tags or {})),
    )
    module.recorded = recorded
    yield module
    module._reset_pubsub_tracking_for_tests()


def test_open_pubsub_releases_the_connection_when_subscribe_fails(
    monkeypatch, redis_sse, caplog
):
    pubsub = _TrackedPubSub(subscribe_error=ConnectionError("Too many connections"))
    monkeypatch.setattr(redis_sse, "get_async_redis", lambda: _FakeAsyncRedis(pubsub))

    with caplog.at_level(logging.WARNING, logger=redis_sse.__name__):
        with pytest.raises(ConnectionError):
            asyncio.run(redis_sse.open_pubsub("crate:sse:task:x"))

    assert pubsub.closed is True
    assert redis_sse.open_pubsub_count() == 0
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "crate:sse:task:x" in warnings[0].getMessage()
    assert ("sse.pubsub.open_failures", 1.0, {"reason": "pool_exhausted"}) in (
        redis_sse.recorded
    )


def test_open_pubsub_failure_warnings_are_rate_limited(monkeypatch, redis_sse, caplog):
    clock = {"now": 1000.0}
    monkeypatch.setattr(redis_sse.time, "monotonic", lambda: clock["now"])

    def failing_redis():
        return _FakeAsyncRedis(_TrackedPubSub(subscribe_error=OSError("refused")))

    monkeypatch.setattr(redis_sse, "get_async_redis", failing_redis)

    async def fail_many(count):
        for _ in range(count):
            with pytest.raises(OSError):
                await redis_sse.open_pubsub("crate:sse:global")

    with caplog.at_level(logging.WARNING, logger=redis_sse.__name__):
        asyncio.run(fail_many(5))
        clock["now"] += redis_sse.FAILURE_LOG_INTERVAL_SECONDS
        asyncio.run(fail_many(1))

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 2
    assert "4 similar failures" in warnings[1]
    reasons = [tags["reason"] for name, _v, tags in redis_sse.recorded]
    assert reasons == ["redis_error"] * 6


def test_open_and_close_pubsub_track_open_subscriptions(monkeypatch, redis_sse):
    pubsubs = [_TrackedPubSub(), _TrackedPubSub()]
    monkeypatch.setattr(
        redis_sse, "get_async_redis", lambda: _FakeAsyncRedis(pubsubs.pop(0))
    )

    async def run():
        first = await redis_sse.open_pubsub("a")
        second = await redis_sse.open_pubsub("b")
        assert redis_sse.open_pubsub_count() == 2
        await redis_sse.close_pubsub(first, "a")
        await redis_sse.close_pubsub(first, "a")
        assert redis_sse.open_pubsub_count() == 1
        await redis_sse.close_pubsub(second, "b")
        return first, second

    first, second = asyncio.run(run())

    assert first.closed and second.closed
    assert redis_sse.open_pubsub_count() == 0
    gauge = [
        value for name, value, _t in redis_sse.recorded if name == "sse.pubsub.open"
    ]
    assert gauge == [1.0, 2.0, 1.0, 0.0]


def test_close_pubsub_releases_the_connection_when_unsubscribe_fails(redis_sse):
    class BrokenUnsubscribe(_TrackedPubSub):
        async def unsubscribe(self, channel):
            raise ConnectionError("connection reset")

    pubsub = BrokenUnsubscribe()

    asyncio.run(redis_sse.close_pubsub(pubsub, "crate:sse:global"))

    assert pubsub.closed is True


# ── stack._mark_live_watched ────────────────────────────────────────


def test_mark_live_watched_failure_is_a_rate_limited_warning(monkeypatch, caplog):
    from crate.api import redis_sse, stack

    redis_sse._reset_pubsub_tracking_for_tests()

    class FullPool:
        async def set(self, *_args, **_kwargs):
            raise ConnectionError("Too many connections")

    monkeypatch.setattr(stack, "get_async_redis", lambda: FullPool())

    async def run():
        await stack._mark_live_watched()
        await stack._mark_live_watched()

    with caplog.at_level(logging.WARNING):
        asyncio.run(run())

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "watched" in warnings[0].getMessage()
    redis_sse._reset_pubsub_tracking_for_tests()


# ── jam.jam_room_ws ─────────────────────────────────────────────────


class _FakeWebSocket:
    def __init__(self, *, fail_send: bool):
        self.fail_send = fail_send
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000, reason=None):
        return None

    async def send_text(self, _text):
        if self.fail_send:
            raise RuntimeError("client went away")

    async def send_json(self, _payload):
        if self.fail_send:
            raise RuntimeError("client went away")

    async def receive_text(self):
        from fastapi import WebSocketDisconnect

        raise WebSocketDisconnect()


def _install_jam(monkeypatch, *, open_pubsub):
    from crate.api import jam

    room = {"id": "room-1", "status": "active", "host_user_id": 7}
    monkeypatch.setattr(jam, "_auth_ws", lambda _ws: {"user_id": 7})
    monkeypatch.setattr(jam, "get_jam_room", lambda _room_id: room)
    monkeypatch.setattr(jam, "is_jam_room_member", lambda *_a: True)
    monkeypatch.setattr(jam, "get_jam_room_member", lambda *_a: {"user_id": 7})
    monkeypatch.setattr(jam, "touch_jam_room_member", lambda *_a: None)
    monkeypatch.setattr(jam, "mark_jam_room_member_offline", lambda *_a: None)
    monkeypatch.setattr(jam, "_serialize_room", lambda *_a, **_k: {})
    monkeypatch.setattr(jam, "_room_sync_clock_seed", lambda _room: None)

    async def no_clock(_room_id):
        return None

    async def no_presence(_room_id):
        return None

    async def no_lock(*_args):
        return False

    monkeypatch.setattr(jam, "_get_sync_clock", no_clock)
    monkeypatch.setattr(jam, "_broadcast_room_presence", no_presence)
    monkeypatch.setattr(jam, "_acquire_heartbeat_lock", no_lock)
    monkeypatch.setattr(jam, "open_pubsub", open_pubsub)
    hub = jam._LocalJamHub()
    monkeypatch.setattr(jam, "_local_hub", hub)
    return jam, hub


def test_jam_socket_releases_its_subscription_when_setup_fails(monkeypatch):
    ledger = _PubSubLedger()
    jam, hub = _install_jam(monkeypatch, open_pubsub=ledger.open_pubsub)
    monkeypatch.setattr(jam, "close_pubsub", ledger.close_pubsub)

    async def run():
        try:
            await jam.jam_room_ws(_FakeWebSocket(fail_send=True), "room-1")
        except RuntimeError:
            pass

    asyncio.run(run())

    assert len(ledger.opened) == 1
    assert ledger.still_open == 0
    assert not hub._rooms.get("room-1")


def test_jam_socket_falls_back_to_local_mode_when_the_pool_is_full(monkeypatch):
    class MaxConnectionsError(Exception):
        pass

    async def full_pool(_channel):
        raise MaxConnectionsError("Too many connections")

    jam, hub = _install_jam(monkeypatch, open_pubsub=full_pool)

    asyncio.run(jam.jam_room_ws(_FakeWebSocket(fail_send=False), "room-1"))

    assert not hub._rooms.get("room-1")
