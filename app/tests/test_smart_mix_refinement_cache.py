"""Redis helpers of Smart Mix refinements: never PostgreSQL (SM4.PR2, SM3-D5)."""

from __future__ import annotations

import json
import uuid

import pytest

from crate.db import cache_store

PLAN_PREFIX = f"cache:{cache_store.SMART_MIX_PLAN_CACHE_PREFIX}"
REFINED_PREFIX = f"cache:{cache_store.SMART_MIX_REFINED_PLAN_CACHE_PREFIX}"


class FakePipeline:
    def __init__(self, redis: "FakeRedis") -> None:
        self.redis = redis
        self.calls: list[tuple] = []

    def __getattr__(self, name):
        def queue(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self

        return queue

    def execute(self):
        self.redis.pipeline_executions += 1
        return [getattr(self.redis, name)(*a, **k) for name, a, k in self.calls]


class FakeRedis:
    """The few Redis commands the helpers use, in memory."""

    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self.ttls: dict[str, int] = {}
        self.mget_calls: list[list[str]] = []
        self.pipeline_executions = 0

    def mget(self, keys):
        self.mget_calls.append(list(keys))
        return [self.values.get(key) for key in keys]

    def get(self, key):
        return self.values.get(key)

    def setex(self, key, ttl, value):
        self.values[key] = value
        self.ttls[key] = int(ttl)

    def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)

    def sadd(self, key, *members):
        self.values.setdefault(key, set()).update(members)  # type: ignore[union-attr]

    def spop(self, key, count):
        members = self.values.get(key) or set()
        popped = [members.pop() for _ in range(min(count, len(members)))]  # type: ignore[union-attr]
        return popped

    def expire(self, key, ttl, nx=False):
        if not nx or key not in self.ttls:
            self.ttls[key] = int(ttl)
        return True

    def incrby(self, key, amount):
        self.values[key] = int(self.values.get(key) or 0) + amount
        return self.values[key]

    def pipeline(self, transaction=True):
        return FakePipeline(self)


@pytest.fixture
def redis(monkeypatch) -> FakeRedis:
    fake = FakeRedis()
    monkeypatch.setattr(cache_store, "get_redis", lambda: fake)

    def fail(*_args, **_kwargs):
        raise AssertionError("refinement caches must not use PostgreSQL")

    monkeypatch.setattr(cache_store, "read_scope", fail)
    monkeypatch.setattr(cache_store, "transaction_scope", fail)
    return fake


def _key() -> str:
    return uuid.uuid4().hex * 2


def test_plans_and_refinements_read_in_one_mget(redis):
    plan, refined, pending, missing = (_key() for _ in range(4))
    redis.values[f"{PLAN_PREFIX}{plan}"] = json.dumps({"mode": "beatmatch"})
    redis.values[f"{REFINED_PREFIX}{refined}"] = json.dumps({"status": "ready"})
    redis.values[f"{REFINED_PREFIX}{pending}"] = json.dumps({"status": "pending"})

    plans, refinements = cache_store.get_smart_mix_plan_and_refinement_caches(
        [plan, missing], [refined, pending, missing]
    )

    assert plans == {plan: {"mode": "beatmatch"}}
    assert refinements == {
        refined: {"status": "ready"},
        pending: {"status": "pending"},
    }
    assert len(redis.mget_calls) == 1
    # A terminal refinement is kept in memory; a pending one is read again.
    cache_store.get_smart_mix_plan_and_refinement_caches([plan], [refined, pending])
    assert redis.mget_calls[-1] == [f"{REFINED_PREFIX}{pending}"]


def test_refined_plan_writes_set_their_ttl(redis):
    ready, pending = _key(), _key()

    cache_store.set_smart_mix_refined_plan_caches({ready: {"status": "ready"}})
    cache_store.set_smart_mix_refined_plan_caches(
        {pending: {"status": "pending"}},
        ttl_seconds=cache_store.SMART_MIX_REFINEMENT_PENDING_TTL_SECONDS,
    )
    cache_store.delete_smart_mix_refined_plan_caches([pending])

    assert json.loads(redis.values[f"{REFINED_PREFIX}{ready}"]) == {"status": "ready"}
    assert redis.ttls[f"{REFINED_PREFIX}{ready}"] == (
        cache_store.SMART_MIX_REFINED_PLAN_CACHE_TTL_SECONDS
    )
    assert f"{REFINED_PREFIX}{pending}" not in redis.values
    assert redis.pipeline_executions == 2


def test_gate_is_cached_and_invalidated(redis):
    cache_store.delete_smart_mix_refinement_gate()
    assert cache_store.get_smart_mix_refinement_gate() is None
    cache_store.set_smart_mix_refinement_gate({"enabled": True})
    assert cache_store.get_smart_mix_refinement_gate() == {"enabled": True}
    cache_store.delete_smart_mix_refinement_gate()
    assert cache_store.get_smart_mix_refinement_gate() is None


def test_budget_marker_follows_the_configuration(redis):
    cache_store.set_smart_mix_refinement_budget_marker("a" * 64, ttl_seconds=60)

    assert cache_store.smart_mix_refinement_budget_exhausted("a" * 64)
    assert not cache_store.smart_mix_refinement_budget_exhausted("b" * 64)


def test_reads_are_recorded_and_drained(redis):
    keys = [_key() for _ in range(3)]
    cache_store.record_smart_mix_refinement_reads(keys)
    cache_store.record_smart_mix_refinement_reads(keys[:1])

    drained = cache_store.pop_smart_mix_refinement_reads(10)

    assert sorted(drained) == sorted(keys)
    assert cache_store.pop_smart_mix_refinement_reads(10) == []


def test_quota_counts_per_user_within_window(redis):
    consume = cache_store.consume_smart_mix_refinement_quota

    assert consume(7, 60, limit=64, window_seconds=60) == 60
    assert consume(7, 10, limit=64, window_seconds=60) == 4
    assert consume(7, 1, limit=64, window_seconds=60) == 0
    assert consume(8, 3, limit=64, window_seconds=60) == 3


def test_quota_allows_when_redis_is_down(monkeypatch):
    monkeypatch.setattr(cache_store, "get_redis", lambda: None)

    assert (
        cache_store.consume_smart_mix_refinement_quota(
            7, 5, limit=64, window_seconds=60
        )
        == 5
    )
