import json
import threading
import time


def test_bounded_dispatcher_coalesces_overflow_to_full_invalidation():
    from crate.db.cache_invalidation import BoundedInvalidationDispatcher

    handled: list[tuple[str, ...]] = []
    dispatcher = BoundedInvalidationDispatcher(handled.append, max_pending=1)

    assert dispatcher.submit(("library",)) is True
    assert dispatcher.submit(("artist:7",)) is False

    dispatcher.start()
    assert dispatcher.wait_until_idle(timeout=1.0) is True
    dispatcher.stop()

    assert handled == [("library",), ("*",)]
    assert dispatcher.stats()["coalesced"] == 1


def test_remote_invalidation_evicts_only_matching_local_prefixes(monkeypatch):
    from crate.db import cache_invalidation, cache_runtime

    cache_runtime._mem_cache.clear()
    cache_runtime._mem_cache.update(
        {
            "listen:artist_page:high-vis": (99_999_999_999.0, {"artist": 1}),
            "listen:explore_page:punk": (99_999_999_999.0, {"genre": 1}),
            "unrelated": (99_999_999_999.0, {"keep": True}),
        }
    )

    cache_invalidation.apply_remote_invalidation_event(
        json.dumps({"id": 1, "scope": "artist:7"})
    )

    assert "listen:artist_page:high-vis" not in cache_runtime._mem_cache
    assert "listen:explore_page:punk" in cache_runtime._mem_cache
    assert "unrelated" in cache_runtime._mem_cache


def test_full_remote_invalidation_clears_process_l1():
    from crate.db import cache_invalidation, cache_runtime

    cache_runtime._mem_cache["one"] = (99_999_999_999.0, 1)
    cache_runtime._mem_cache["two"] = (99_999_999_999.0, 2)

    cache_invalidation.apply_remote_invalidation_event(
        json.dumps({"id": 2, "scope": "*"})
    )

    assert cache_runtime._mem_cache == {}


def test_broadcast_invalidation_uses_single_bounded_dispatcher(monkeypatch):
    from crate.api import cache_events

    submitted: list[tuple[str, ...]] = []
    calls: list[str] = []
    fake_dispatcher = type(
        "Dispatcher",
        (),
        {
            "submit": lambda self, scopes: (
                calls.append("submit"),
                submitted.append(scopes),
                True,
            )[-1]
        },
    )()
    monkeypatch.setattr(
        cache_events, "_get_invalidation_dispatcher", lambda: fake_dispatcher
    )
    monkeypatch.setattr(
        cache_events,
        "_persist_invalidation_events",
        lambda scopes: calls.append(f"persist:{','.join(scopes)}"),
    )

    before = {thread.ident for thread in threading.enumerate()}
    cache_events.broadcast_invalidation("library", "home:user:7")
    after = {thread.ident for thread in threading.enumerate()}

    assert submitted == [("library", "home:user:7")]
    assert calls == ["persist:library,home:user:7", "submit"]
    assert after == before


def test_wait_for_cache_invalidation_waits_for_existing_dispatcher(monkeypatch):
    from crate.api import cache_events

    timeouts: list[float] = []
    fake_dispatcher = type(
        "Dispatcher",
        (),
        {
            "wait_until_idle": lambda self, *, timeout: (
                timeouts.append(timeout),
                True,
            )[-1]
        },
    )()
    monkeypatch.setattr(cache_events, "_invalidation_dispatcher", fake_dispatcher)

    assert cache_events.wait_for_cache_invalidation(timeout=1.25) is True
    assert timeouts == [1.25]


def test_invalidation_subscriber_reconnects_after_transient_redis_failure(monkeypatch):
    from crate.db import cache_invalidation

    received = threading.Event()
    attempts = 0

    class _PubSub:
        def subscribe(self, _channel):
            return None

        def get_message(self, timeout=1.0):
            del timeout
            if not received.is_set():
                return {
                    "type": "message",
                    "data": json.dumps({"id": 3, "scope": "library"}),
                }
            time.sleep(0.005)
            return None

        def close(self):
            return None

    class _Redis:
        def pubsub(self, ignore_subscribe_messages=True):
            assert ignore_subscribe_messages is True
            return _PubSub()

    def redis_factory():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("transient")
        return _Redis()

    monkeypatch.setattr(
        cache_invalidation,
        "apply_remote_invalidation_event",
        lambda _event: received.set(),
    )
    subscriber = cache_invalidation.CacheInvalidationSubscriber(
        redis_factory,
        "cache-events",
        retry_delay=0.01,
    )

    subscriber.start()
    assert received.wait(1.0) is True
    subscriber.stop()

    assert attempts >= 2


def test_invalidation_subscriber_replays_the_gap_after_reconnect(monkeypatch):
    from crate.db import cache_invalidation

    received: list[int] = []
    finished = threading.Event()

    class _PubSub:
        def __init__(self, messages):
            self.messages = iter(messages)

        def subscribe(self, _channel):
            return None

        def get_message(self, timeout=1.0):
            del timeout
            try:
                message = next(self.messages)
            except StopIteration:
                raise ConnectionError("disconnect")
            if message is None:
                time.sleep(0.005)
                return None
            return {"type": "message", "data": json.dumps(message)}

        def close(self):
            return None

    class _Redis:
        def __init__(self, *, latest, replay, live):
            self.latest = latest
            self.replay = replay
            self.live = live

        def pubsub(self, ignore_subscribe_messages=True):
            assert ignore_subscribe_messages is True
            return _PubSub(self.live)

        def get(self, _key):
            return str(self.latest)

        def lrange(self, _key, _start, _end):
            return [json.dumps(event) for event in reversed(self.replay)]

    clients = iter(
        [
            _Redis(latest=2, replay=[], live=[{"id": 3, "scope": "library"}]),
            _Redis(
                latest=4,
                replay=[{"id": 4, "scope": "history"}],
                live=[{"id": 5, "scope": "home"}, None],
            ),
        ]
    )

    def apply(event):
        payload = event if isinstance(event, dict) else json.loads(event)
        received.append(int(payload["id"]))
        if received == [3, 4, 5]:
            finished.set()

    monkeypatch.setattr(cache_invalidation, "apply_remote_invalidation_event", apply)
    subscriber = cache_invalidation.CacheInvalidationSubscriber(
        lambda: next(clients),
        "cache-events",
        retry_delay=0.01,
    )

    subscriber.start()
    assert finished.wait(1.0) is True
    subscriber.stop()

    assert received == [3, 4, 5]
