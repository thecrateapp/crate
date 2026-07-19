import asyncio
import json

from starlette.requests import Request


class _FakeRedis:
    def __init__(self):
        self.next_id = 0
        self.events: list[str] = []
        self.published: list[tuple[str, str]] = []

    def incr(self, _key: str) -> int:
        self.next_id += 1
        return self.next_id

    def lpush(self, _key: str, value: str) -> None:
        self.events.insert(0, value)

    def ltrim(self, _key: str, _start: int, _end: int) -> None:
        return None

    def publish(self, channel: str, value: str) -> None:
        self.published.append((channel, value))


class _UnavailableRedis:
    def incr(self, _key: str) -> int:
        raise ConnectionError("cache redis unavailable")


class _FakePubSub:
    def __init__(self, messages: list[dict]):
        self.messages = list(messages)
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def get_message(
        self, ignore_subscribe_messages: bool = True, timeout: float = 0.0
    ):
        del ignore_subscribe_messages, timeout
        if self.messages:
            return self.messages.pop(0)
        return None

    async def aclose(self) -> None:
        self.closed = True


class _FakeAsyncRedis:
    def __init__(self, pubsub: _FakePubSub):
        self._pubsub = pubsub
        self.closed = False

    def pubsub(self) -> _FakePubSub:
        return self._pubsub

    async def aclose(self) -> None:
        self.closed = True


def _request(*, last_event_id: str | None = None, query: str = "") -> Request:
    headers = []
    if last_event_id is not None:
        headers.append((b"last-event-id", last_event_id.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/cache/events",
            "query_string": query.encode(),
            "headers": headers,
        }
    )


def test_cache_event_resume_id_supports_persisted_client_cursor(monkeypatch):
    from crate.api import cache_events

    monkeypatch.setattr(cache_events, "get_latest_invalidation_event_id", lambda: 99)

    assert cache_events._cache_event_resume_id(_request(last_event_id="42")) == 42
    assert (
        cache_events._cache_event_resume_id(
            _request(last_event_id="42", query="last_event_id=41")
        )
        == 42
    )
    assert cache_events._cache_event_resume_id(_request(query="last_event_id=41")) == 41
    assert cache_events._cache_event_resume_id(_request()) == 99
    assert (
        cache_events._cache_event_resume_id(_request(query="last_event_id=invalid"))
        == 99
    )


def test_should_append_invalidation_domain_event_is_selective():
    from crate.api import cache_events

    assert cache_events._should_append_invalidation_domain_event("library") is True
    assert cache_events._should_append_invalidation_domain_event("home") is True
    assert cache_events._should_append_invalidation_domain_event("artist:7") is True
    assert cache_events._should_append_invalidation_domain_event("playlist:42") is True
    assert cache_events._should_append_invalidation_domain_event("home:user:9") is True

    assert cache_events._should_append_invalidation_domain_event("likes") is False
    assert cache_events._should_append_invalidation_domain_event("follows") is False
    assert cache_events._should_append_invalidation_domain_event("history") is False


def test_do_broadcast_only_publishes_cache_events(monkeypatch):
    from crate.api import cache_events

    fake_redis = _FakeRedis()
    calls: list[str] = []

    monkeypatch.setattr(cache_events, "_get_redis", lambda: fake_redis)
    monkeypatch.setattr(
        cache_events,
        "_clear_backend_cache_for_scopes",
        lambda scopes: calls.append(f"clear:{','.join(scopes)}"),
    )
    cache_events._do_broadcast(["likes", "library", "home:user:7"])

    assert [json.loads(event)["scope"] for event in reversed(fake_redis.events)] == [
        "likes",
        "library",
        "home:user:7",
    ]
    assert [channel for channel, _payload in fake_redis.published] == [
        cache_events._LIVE_CHANNEL,
        cache_events._LIVE_CHANNEL,
        cache_events._LIVE_CHANNEL,
    ]
    assert calls == ["clear:likes,library,home:user:7"]


def test_do_broadcast_still_clears_local_cache_when_cache_redis_is_down(monkeypatch):
    from crate.api import cache_events

    cleared: list[tuple[str, ...]] = []
    monkeypatch.setattr(cache_events, "_get_redis", lambda: _UnavailableRedis())
    monkeypatch.setattr(
        cache_events,
        "_clear_backend_cache_for_scopes",
        lambda scopes: cleared.append(tuple(scopes)),
    )
    cache_events._do_broadcast(["library", "likes"])

    assert cleared == [("library", "likes")]


def test_invalidation_stream_replays_events_and_switches_to_pubsub(monkeypatch):
    from crate.api import cache_events

    fake_pubsub = _FakePubSub(
        [
            {"type": "message", "data": json.dumps({"id": 2, "scope": "history"})},
            {"type": "message", "data": json.dumps({"id": 3, "scope": "library"})},
        ]
    )
    fake_redis = _FakeAsyncRedis(fake_pubsub)

    async def _open_live_invalidation_pubsub():
        await fake_pubsub.subscribe(cache_events._LIVE_CHANNEL)
        return fake_redis, fake_pubsub

    monkeypatch.setattr(
        cache_events, "_open_live_invalidation_pubsub", _open_live_invalidation_pubsub
    )
    monkeypatch.setattr(
        cache_events,
        "get_invalidation_events_since",
        lambda last_id: [{"id": 2, "scope": "history"}] if last_id == 1 else [],
    )

    async def _collect():
        stream = cache_events._invalidation_stream(1)
        replay = await anext(stream)
        live = await anext(stream)
        await stream.aclose()
        return replay, live

    replay, live = asyncio.run(_collect())

    assert replay == "id: 2\ndata: history\n\n"
    assert live == "id: 3\ndata: library\n\n"
    assert fake_pubsub.subscribed == [cache_events._LIVE_CHANNEL]
    assert fake_pubsub.unsubscribed == [cache_events._LIVE_CHANNEL]
    assert fake_pubsub.closed is True
    assert fake_redis.closed is True


def test_artist_invalidation_clears_listen_artist_page_cache(monkeypatch):
    from crate.api import cache_events

    deleted_prefixes: list[str] = []
    marked: list[tuple[str | None, str | None]] = []

    monkeypatch.setattr(
        "crate.db.cache_store.delete_cache_prefix",
        lambda prefix: deleted_prefixes.append(prefix),
    )
    monkeypatch.setattr(
        "crate.db.ui_snapshot_store.mark_ui_snapshots_stale",
        lambda scope=None, subject_key=None, scope_prefix=None: marked.append(
            (scope or scope_prefix, subject_key)
        ),
    )

    cache_events._clear_backend_cache_for_scopes(["artist:52"])

    assert "artist:52" in deleted_prefixes
    assert "listen:artist_page:" in deleted_prefixes
    assert ("home:", None) in marked


def test_library_invalidation_clears_listen_browse_and_explore_cache(monkeypatch):
    from crate.api import cache_events

    deleted_prefixes: list[str] = []

    monkeypatch.setattr(
        "crate.db.cache_store.delete_cache_prefix",
        lambda prefix: deleted_prefixes.append(prefix),
    )
    monkeypatch.setattr(
        "crate.db.ui_snapshot_store.mark_ui_snapshots_stale",
        lambda scope=None, subject_key=None, scope_prefix=None: None,
    )

    cache_events._clear_backend_cache_for_scopes(["library"])

    assert "listen:browse_filters:" in deleted_prefixes
    assert "listen:explore_page:" in deleted_prefixes


def test_full_invalidation_clears_all_cache_tiers_and_marks_snapshots_stale(
    monkeypatch,
):
    from crate.api import cache_events

    deleted_prefixes: list[str] = []
    marked: list[tuple[str | None, str | None]] = []
    l1_clears: list[bool] = []
    monkeypatch.setattr(
        "crate.db.cache_store.delete_cache_prefix",
        lambda prefix: deleted_prefixes.append(prefix),
    )
    monkeypatch.setattr(
        "crate.db.ui_snapshot_store.mark_ui_snapshots_stale",
        lambda scope=None, subject_key=None, scope_prefix=None: marked.append(
            (scope if scope is not None else scope_prefix, subject_key)
        ),
    )
    monkeypatch.setattr(
        "crate.db.cache_runtime._mem_clear", lambda: l1_clears.append(True)
    )

    cache_events._clear_backend_cache_for_scopes(["*"])

    assert l1_clears == [True]
    assert deleted_prefixes == [""]
    assert marked == [("", None)]


def test_home_user_invalidation_marks_home_snapshot_stale(monkeypatch):
    from crate.api import cache_events

    marked: list[tuple[str | None, str | None]] = []

    monkeypatch.setattr(
        "crate.db.cache_store.delete_cache_prefix",
        lambda _prefix: None,
    )
    monkeypatch.setattr(
        "crate.db.ui_snapshot_store.mark_ui_snapshots_stale",
        lambda scope=None, subject_key=None, scope_prefix=None: marked.append(
            (scope or scope_prefix, subject_key)
        ),
    )

    cache_events._clear_backend_cache_for_scopes(["home:user:7"])

    assert ("home:discovery", "7") in marked


def test_jam_mutations_invalidate_jam_scope():
    from crate.api import cache_events

    assert cache_events._match_invalidation_scopes("/api/jam/rooms") == ["jam"]
    assert cache_events._match_invalidation_scopes("/api/jam/rooms/abc/end") == ["jam"]


def test_admin_auth_mutations_invalidate_readplane_identity_cache():
    from crate.api import cache_events

    assert cache_events._match_invalidation_scopes(
        "/api/admin/auth/users/7/sessions/revoke-all"
    ) == ["auth"]
    assert cache_events._match_invalidation_scopes("/api/admin/auth/users/7/role") == [
        "auth"
    ]
