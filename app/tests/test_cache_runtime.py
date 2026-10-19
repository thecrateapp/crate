import json

from crate.db.cache_runtime import _mask_url_secret


def test_mask_url_secret_hides_redis_password():
    assert (
        _mask_url_secret("redis://:super-secret@crate-redis:6379/0")
        == "redis://***@crate-redis:6379/0"
    )


def test_mask_url_secret_preserves_passwordless_urls():
    assert _mask_url_secret("redis://localhost:6379/0") == "redis://localhost:6379/0"


class _RedisPipeline:
    def __init__(self, raw: str, pttl_ms: int):
        self.raw = raw
        self.pttl_ms = pttl_ms

    def get(self, _key: str):
        return self

    def pttl(self, _key: str):
        return self

    def execute(self):
        return [self.raw, self.pttl_ms]


class _RedisWithTTL:
    def __init__(self, value, pttl_ms: int):
        self.raw = json.dumps(value)
        self.pttl_ms = pttl_ms

    def pipeline(self, transaction: bool = False):
        assert transaction is False
        return _RedisPipeline(self.raw, self.pttl_ms)


def test_redis_hit_never_populates_l1_beyond_remaining_redis_ttl(monkeypatch):
    from crate.db import cache_runtime, cache_store

    cache_runtime._mem_cache.clear()
    monkeypatch.setattr(
        cache_store, "get_redis", lambda: _RedisWithTTL({"ok": True}, 80_000)
    )
    monkeypatch.setattr(cache_runtime.time, "time", lambda: 1_000.0)

    assert cache_store.get_cache("key", max_age_seconds=120) == {"ok": True}
    expires_at, _value = cache_runtime._mem_cache["key"]
    assert expires_at == 1_080.0


def test_near_expiry_redis_hit_is_not_reinserted_into_l1(monkeypatch):
    from crate.db import cache_runtime, cache_store

    cache_runtime._mem_cache.clear()
    monkeypatch.setattr(cache_store, "get_redis", lambda: _RedisWithTTL("value", 0))

    assert cache_store.get_cache("key") == "value"
    assert "key" not in cache_runtime._mem_cache


def test_persistent_redis_key_clamps_l1_to_requested_max_age(monkeypatch):
    from crate.db import cache_runtime, cache_store

    cache_runtime._mem_cache.clear()
    monkeypatch.setattr(cache_store, "get_redis", lambda: _RedisWithTTL("value", -1))
    monkeypatch.setattr(cache_runtime.time, "time", lambda: 2_000.0)

    assert cache_store.get_cache("key", max_age_seconds=45) == "value"
    expires_at, _value = cache_runtime._mem_cache["key"]
    assert expires_at == 2_045.0


def test_l1_hit_respects_stricter_requested_max_age(monkeypatch):
    from crate.db import cache_runtime, cache_store

    cache_runtime._mem_cache.clear()
    monkeypatch.setattr(cache_runtime.time, "time", lambda: 1_000.0)
    cache_runtime._mem_set("key", {"value": "stale"}, ttl=300)
    monkeypatch.setattr(cache_runtime.time, "time", lambda: 1_011.0)
    monkeypatch.setattr(cache_store, "get_redis", lambda: None)
    monkeypatch.setattr(
        cache_store,
        "read_scope",
        lambda: (_ for _ in ()).throw(RuntimeError("no persistent fallback")),
    )

    assert cache_store.get_cache("key", max_age_seconds=10) is None


class _FakeRedisPipeline:
    def __init__(self, redis: "_FakeRedis") -> None:
        self.redis = redis
        self.commands: list[tuple[str, int, str]] = []

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.commands.append((key, ttl, value))

    def execute(self) -> None:
        self.redis.pipeline_executions += 1
        for key, _ttl, value in self.commands:
            self.redis.values[key] = value


class _FakeRedis:
    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values = dict(values or {})
        self.mget_calls: list[list[str]] = []
        self.pipeline_executions = 0

    def mget(self, keys: list[str]) -> list[str | None]:
        self.mget_calls.append(list(keys))
        return [self.values.get(key) for key in keys]

    def pipeline(self, transaction: bool = True) -> _FakeRedisPipeline:
        return _FakeRedisPipeline(self)


def _forbid_postgres(monkeypatch, cache_store) -> None:
    def fail(*_args, **_kwargs):
        raise AssertionError("plan cache must not use PostgreSQL")

    monkeypatch.setattr(cache_store, "read_scope", fail)
    monkeypatch.setattr(cache_store, "transaction_scope", fail)


def test_smart_mix_plan_caches_read_a_batch_in_one_redis_round_trip(monkeypatch):
    import json
    import uuid

    from crate.db import cache_store

    first, second, missing = (uuid.uuid4().hex for _ in range(3))
    prefix = f"cache:{cache_store.SMART_MIX_PLAN_CACHE_PREFIX}"
    redis = _FakeRedis(
        {
            f"{prefix}{first}": json.dumps({"mode": "adaptive"}),
            f"{prefix}{second}": json.dumps({"mode": "beatmatch"}),
        }
    )
    monkeypatch.setattr(cache_store, "get_redis", lambda: redis)
    _forbid_postgres(monkeypatch, cache_store)

    found = cache_store.get_smart_mix_plan_caches([first, second, missing])

    assert found == {first: {"mode": "adaptive"}, second: {"mode": "beatmatch"}}
    assert len(redis.mget_calls) == 1
    assert cache_store.get_smart_mix_plan_caches([first, second]) == {
        first: {"mode": "adaptive"},
        second: {"mode": "beatmatch"},
    }
    assert len(redis.mget_calls) == 1


def test_smart_mix_plan_caches_write_a_batch_in_one_pipeline(monkeypatch):
    import json
    import uuid

    from crate.db import cache_store

    first, second = (uuid.uuid4().hex for _ in range(2))
    redis = _FakeRedis()
    monkeypatch.setattr(cache_store, "get_redis", lambda: redis)
    _forbid_postgres(monkeypatch, cache_store)

    cache_store.set_smart_mix_plan_caches(
        {first: {"mode": "adaptive"}, second: {"mode": "beatmatch"}}
    )

    prefix = f"cache:{cache_store.SMART_MIX_PLAN_CACHE_PREFIX}"
    assert redis.pipeline_executions == 1
    assert json.loads(redis.values[f"{prefix}{second}"]) == {"mode": "beatmatch"}


def test_smart_mix_plan_caches_skip_postgres_when_redis_is_down(monkeypatch):
    import uuid

    from crate.db import cache_store

    key = uuid.uuid4().hex
    monkeypatch.setattr(cache_store, "get_redis", lambda: None)
    _forbid_postgres(monkeypatch, cache_store)

    assert cache_store.get_smart_mix_plan_caches([key]) == {}
    cache_store.set_smart_mix_plan_caches({key: {"mode": "adaptive"}})
    assert cache_store.get_smart_mix_plan_caches([key]) == {key: {"mode": "adaptive"}}
