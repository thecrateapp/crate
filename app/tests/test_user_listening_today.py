"""Live "listened today" counter."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from crate.db.repositories import user_listening_today as today_counter
from tests.conftest import PG_AVAILABLE


class FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, float]] = {}
        self.ttls: dict[str, int] = {}

    def pipeline(self, transaction: bool = False):
        return self

    def hincrbyfloat(self, key, field, amount):
        bucket = self.hashes.setdefault(key, {})
        bucket[field] = bucket.get(field, 0) + amount

    def hincrby(self, key, field, amount):
        self.hincrbyfloat(key, field, amount)

    def expire(self, key, seconds):
        self.ttls[key] = seconds

    def execute(self):
        return []

    def hgetall(self, key):
        return {field: str(value) for field, value in self.hashes.get(key, {}).items()}


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_counts_plays_for_the_local_day(pg_db, monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(today_counter, "get_redis", lambda: fake)
    local_today = datetime.now(ZoneInfo("UTC")).date()

    today_counter.add_listening_today(1, local_today, 180)
    today_counter.add_listening_today(1, local_today, 90)
    today_counter.add_listening_today(1, date(2001, 1, 1), 600)

    assert today_counter.get_listening_today(1) == {
        "day": local_today.isoformat(),
        "timezone": "UTC",
        "minutes": 4.5,
        "plays": 2,
    }
    assert set(fake.ttls.values()) == {48 * 3600}


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_falls_back_to_zero_without_redis_or_projections(pg_db, monkeypatch):
    monkeypatch.setattr(today_counter, "get_redis", lambda: None)

    payload = today_counter.get_listening_today(1)

    assert (payload["minutes"], payload["plays"]) == (0, 0)


def test_counter_writes_are_best_effort(monkeypatch):
    class BrokenRedis(FakeRedis):
        def execute(self):
            raise ConnectionError("redis down")

    monkeypatch.setattr(today_counter, "get_redis", lambda: BrokenRedis())

    today_counter.add_listening_today(1, date(2026, 10, 8), 60)
