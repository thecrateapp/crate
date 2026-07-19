from __future__ import annotations

import asyncio
from contextlib import contextmanager

from crate.db import cache_musicbrainz


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.expirations: dict[str, int] = {}
        self.scan_calls: list[tuple[int, str, int]] = []

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self.values[key] = value
        if ex is not None:
            self.expirations[key] = ex

    def scan(self, cursor: int, *, match: str, count: int):
        self.scan_calls.append((cursor, match, count))
        return 0, ["mb:artist:one", "mb:artist:two", "cache:other"]

    def ttl(self, key: str) -> int:
        return {
            "mb:artist:one": -1,
            "mb:artist:two": 3600,
            "cache:other": -1,
        }[key]

    def expire(self, key: str, ttl: int) -> None:
        self.expirations[key] = ttl


def test_set_mb_cache_writes_redis_with_a_bounded_ttl(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(cache_musicbrainz, "get_redis", lambda: redis)
    monkeypatch.setattr(cache_musicbrainz, "_mem_set", lambda *args, **kwargs: None)

    cache_musicbrainz.set_mb_cache("artist:high-vis", {"mbid": "mb-1"})

    assert redis.expirations["mb:artist:high-vis"] == 30 * 24 * 60 * 60


def test_postgres_rehydration_restores_redis_with_a_bounded_ttl(monkeypatch):
    redis = FakeRedis()

    class Result:
        def mappings(self):
            return self

        def first(self):
            return {"value_json": {"mbid": "mb-2"}}

    class Session:
        def execute(self, *_args, **_kwargs):
            return Result()

    @contextmanager
    def fake_read_scope():
        yield Session()

    monkeypatch.setattr(cache_musicbrainz, "get_redis", lambda: redis)
    monkeypatch.setattr(cache_musicbrainz, "_mem_get", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(cache_musicbrainz, "_mem_set", lambda *args, **kwargs: None)
    monkeypatch.setattr(cache_musicbrainz, "read_scope", fake_read_scope)

    assert cache_musicbrainz.get_mb_cache("artist:poison-the-well") == {"mbid": "mb-2"}
    assert redis.expirations["mb:artist:poison-the-well"] == 30 * 24 * 60 * 60


def test_repair_mb_cache_ttls_only_expires_immortal_musicbrainz_keys():
    redis = FakeRedis()

    repaired = cache_musicbrainz.repair_mb_cache_ttls(redis)

    assert repaired == 1
    assert redis.expirations == {
        "mb:artist:one": 30 * 24 * 60 * 60,
    }
    assert redis.scan_calls == [(0, "mb:*", 100)]


def test_api_runs_legacy_ttl_repair_off_the_event_loop(monkeypatch):
    from crate import api

    calls: list[object] = []

    async def fake_to_thread(function, *args, **kwargs):
        calls.append((function, args, kwargs))
        return 4

    monkeypatch.setattr(api.asyncio, "to_thread", fake_to_thread)

    repaired = asyncio.run(api._repair_musicbrainz_cache_ttls())

    assert repaired == 4
    assert calls == [(cache_musicbrainz.repair_mb_cache_ttls, (), {})]
