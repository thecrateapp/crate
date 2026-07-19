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
