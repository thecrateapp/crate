"""Indexed batches remain stable across retries and competing consumers."""

import json
from uuid import uuid4
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from fnmatch import fnmatchcase

import pytest

from crate import radio_engine

SESSION_ID = "11111111-1111-4111-8111-111111111111"
OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222"
SESSION_KEY = f"radio:session:{SESSION_ID}"
OTHER_SESSION_KEY = f"radio:session:{OTHER_SESSION_ID}"


class MemoryRedis:
    def __init__(self):
        self.values = {}
        self.locks = {}
        self.guard = threading.Lock()

    def get(self, key):
        return self.values.get(key)

    def delete(self, *keys):
        return sum(self.values.pop(key, None) is not None for key in keys)

    def scan_iter(self, match=None, **_kwargs):
        for key in tuple(self.values):
            if match is None or fnmatchcase(key, match):
                yield key

    def setex(self, key, ttl, value):
        self.values[key] = value

    @contextmanager
    def lock(self, name, **kwargs):
        from redis.exceptions import LockError

        with self.guard:
            lock = self.locks.setdefault(name, threading.Lock())
        blocking_timeout = kwargs.get("blocking_timeout")
        acquired = (
            lock.acquire(timeout=blocking_timeout)
            if blocking_timeout is not None
            else lock.acquire()
        )
        if not acquired:
            raise LockError("Unable to acquire lock within the time specified")
        try:
            yield type("Lease", (), {"owned": lambda self: True, "name": name})()
        finally:
            lock.release()

    def pipeline(self, **kwargs):
        return MemoryPipeline(self)


class MemoryPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.pending = []
        self.watched = {}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.pending.clear()

    def watch(self, *keys):
        self.watched = {key: self.redis.get(key) for key in keys}

    def multi(self):
        pass

    def set(self, key, value, **kwargs):
        self.pending.append(("set", key, value, kwargs.get("ex")))

    def delete(self, *keys):
        self.pending.append(("delete", keys, None, None))

    def execute(self):
        from redis.exceptions import WatchError

        with self.redis.guard:
            if any(self.redis.get(key) != value for key, value in self.watched.items()):
                raise WatchError("watched lease changed")
            result = []
            for operation, key, value, ttl in self.pending:
                if operation == "set":
                    self.redis.setex(key, ttl, value)
                    result.append(True)
                else:
                    result.append(self.redis.delete(*key))
            self.pending.clear()
            return result


@pytest.fixture
def batches(monkeypatch):
    redis = MemoryRedis()
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis)
    generated = []

    def generate(session, count):
        time.sleep(0.005)
        generated.append(session["track_count"])
        return [{"track_id": session["track_count"] + 1, "title": "Next"}]

    monkeypatch.setattr(radio_engine, "_generate_batch", generate)
    monkeypatch.setattr(radio_engine, "_apply_buffer_context", lambda *args: None)
    redis.setex(
        SESSION_KEY,
        86400,
        json.dumps({"id": SESSION_ID, "user_id": 42, "track_count": 20}),
    )
    return redis, generated


def test_repeated_index_and_restart_only_generate_once(batches):
    from crate.radio_continuation import next_batch

    redis, generated = batches
    first = next_batch(SESSION_ID, user_id=42, batch_index=1, count=5)
    second = next_batch(SESSION_ID, user_id=42, batch_index=1, count=5)
    assert first == second
    assert first["batch_index"] == 1
    assert first["status"] == "ok"
    assert generated == [20]
    assert json.loads(redis.get(SESSION_KEY))["track_count"] == 21


def test_concurrent_same_index_is_atomic(batches):
    from crate.radio_continuation import next_batch

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: next_batch(SESSION_ID, user_id=42, batch_index=1, count=5),
                range(2),
            )
        )
    assert results[0] == results[1]
    assert batches[1] == [20]


def test_foreign_user_and_expired_session_cannot_read_a_cached_batch(batches):
    from crate.radio_continuation import next_batch

    redis, _ = batches
    next_batch(SESSION_ID, user_id=42, batch_index=1, count=5)
    assert next_batch(SESSION_ID, user_id=7, batch_index=1)["status"] == "exhausted"
    redis.delete(SESSION_KEY)
    assert next_batch(SESSION_ID, user_id=42, batch_index=1)["status"] == "exhausted"


def test_out_of_order_index_does_not_advance(batches):
    from crate.radio_continuation import next_batch

    assert (
        next_batch(SESSION_ID, user_id=42, batch_index=3)["status"] == "retryable_empty"
    )
    assert batches[1] == []


def test_empty_batch_is_retryable_and_next_index_can_progress(batches, monkeypatch):
    from crate.radio_continuation import next_batch

    monkeypatch.setattr(radio_engine, "_generate_batch", lambda *args: [])
    result = next_batch(SESSION_ID, user_id=42, batch_index=1)
    assert result["status"] == "retryable_empty"
    assert result["exhausted"] is False
    monkeypatch.setattr(
        radio_engine, "_generate_batch", lambda *args: [{"title": "Recovered"}]
    )
    assert (
        next_batch(SESSION_ID, user_id=42, batch_index=2)["tracks"][0]["title"]
        == "Recovered"
    )


def test_batch_cursor_advances_without_a_numeric_revision(batches):
    from crate.radio_continuation import next_batch

    result = next_batch(SESSION_ID, user_id=42, batch_index=1)

    assert result["status"] == "ok"
    assert result["batch_index"] == 1
    assert "revision" not in result
    saved = json.loads(batches[0].get(SESSION_KEY))
    assert saved["batch_index"] == 1
    assert "revision" not in saved
    assert batches[1] == [20]


def test_start_retry_keeps_the_first_batch_and_expiry_does_not_recreate(
    batches, monkeypatch
):
    from crate.radio_continuation import start_batch

    redis, generated = batches
    calls = []
    new_id = str(uuid4())

    def create(*args, **kwargs):
        calls.append(kwargs)
        return (
            {"id": new_id, "user_id": 42, "track_count": 1},
            {"session_id": new_id, "tracks": [{"title": "First"}]},
        )

    monkeypatch.setattr(radio_engine, "_create_radio", create)
    first = start_batch(session_id=new_id, user_id=42)
    assert start_batch(session_id=new_id, user_id=42) == first
    assert len(calls) == 1
    assert start_batch(session_id=new_id, user_id=7)["status"] == "exhausted"
    redis.delete(f"radio:session:{new_id}")
    assert start_batch(session_id=new_id, user_id=42)["status"] == "exhausted"
    assert len(calls) == 1


def test_same_index_in_other_session_is_independent(batches):
    from crate.radio_continuation import next_batch

    redis, _ = batches
    redis.setex(
        OTHER_SESSION_KEY,
        86400,
        json.dumps({"id": OTHER_SESSION_ID, "user_id": 42, "track_count": 100}),
    )
    assert (
        next_batch(SESSION_ID, user_id=42, batch_index=1)["tracks"][0]["track_id"] == 21
    )
    assert (
        next_batch(OTHER_SESSION_ID, user_id=42, batch_index=1)["tracks"][0]["track_id"]
        == 101
    )


def test_buffer_context_uses_last_actual_track_without_changing_the_anchor(monkeypatch):
    from crate.db.queries import radio_continuation

    monkeypatch.setattr(
        radio_continuation,
        "get_buffer_context",
        lambda refs: [
            {
                "track_id": 7,
                "title": "Playing",
                "artist": "A",
                "bliss_vector": [1.0, 0.0],
                "bpm": 120,
            },
            {
                "track_id": 8,
                "title": "Tail",
                "artist": "B",
                "bliss_vector": [0.0, 1.0],
                "bpm": 160,
            },
        ],
    )
    session = {
        "seed_type": "track",
        "seed_vector": [0.5, 0.5],
        "initial_target": [0.5, 0.5],
        "current_target": [0.6, 0.4],
        "used_track_ids": [5],
    }
    radio_engine._apply_buffer_context(session, ["playing", "tail"])
    assert session["current_target"] == pytest.approx([0.54, 0.46])
    assert session["seed_vector"] == [0.5, 0.5]
    assert session["initial_target"] == [0.5, 0.5]
    assert session["used_track_ids"] == [5, 7, 8]
    assert session["recent_tracks"][-1]["bpm"] == 160


def test_proxy_without_resolved_id_cannot_own_a_session(batches):
    from crate.radio_continuation import start_batch, next_batch

    assert (
        start_batch(session_id=str(uuid4()), user_id=None)["status"] == "auth_required"
    )
    assert (
        next_batch(SESSION_ID, user_id=None, batch_index=1)["status"] == "auth_required"
    )
    assert batches[1] == []


def test_seeded_session_id_cannot_overwrite_another_session_lock(batches):
    from crate.radio_continuation import start_batch

    with pytest.raises(ValueError):
        start_batch(session_id=f"{SESSION_ID}:lock", user_id=42)


def test_global_fallback_excludes_buffer_by_local_and_canonical_identity():
    rows = [
        {"global_track_uid": "g1", "entity_uid": "e1", "track_id": 1},
        {"global_track_uid": "g2", "entity_uid": "e2", "track_id": 2},
        {"global_track_uid": "g3", "entity_uid": "e3", "track_id": 3},
    ]
    session = {
        "radio_profile": "global_catalog",
        "global_tracks": rows,
        "global_cursor": 0,
        "global_source_exhausted": True,
    }
    radio_engine._apply_buffer_context(session, ["e1", "2"])
    assert [
        row["global_track_uid"]
        for row in radio_engine._generate_global_batch(session, 3)
    ] == ["g3"]


@pytest.mark.parametrize("writer", ["indexed", "next", "feedback", "delete"])
@pytest.mark.parametrize("lost_after_owned_check", [False, True])
def test_expired_writer_cannot_overwrite_or_delete_a_newer_session(
    monkeypatch, writer, lost_after_owned_check, batches
):
    from types import SimpleNamespace
    from crate import radio_continuation

    redis, _ = batches
    session_key = SESSION_KEY
    old = {
        "id": SESSION_ID,
        "user_id": 42,
        "track_count": 20,
        "batch_index": 0,
        "initial_target": [1.0, 0.0],
        "liked_vectors": [],
        "disliked_vectors": [],
    }
    newer = {**old, "track_count": 40, "batch_index": 2}
    redis.setex(session_key, 86400, json.dumps(old))
    lease_name = session_key + ":lock"
    redis.setex(lease_name, 60, "first-owner")
    lost = [False]

    def supersede():
        redis.setex(session_key, 86400, json.dumps(newer))
        lost[0] = True

    def owned():
        if lost_after_owned_check:
            redis.setex(lease_name, 60, "next-owner")
            return True
        return not lost[0]

    @contextmanager
    def session_lock(_session_id):
        if writer == "delete":
            supersede()
        yield SimpleNamespace(name=lease_name, owned=owned)

    monkeypatch.setattr(radio_continuation, "session_lock", session_lock)
    monkeypatch.setattr(radio_engine, "_apply_buffer_context", lambda *_args: None)

    def generate(_session, _count):
        supersede()
        return [{"title": "Late result"}]

    def vector(_track_id):
        supersede()
        return [0.0, 1.0]

    monkeypatch.setattr(radio_engine, "_generate_batch", generate)
    monkeypatch.setattr(radio_engine, "get_track_bliss_vector", vector)
    persisted = []
    monkeypatch.setattr(
        radio_engine,
        "persist_radio_feedback",
        lambda **kwargs: persisted.append(kwargs),
    )
    if writer == "indexed":
        result = radio_continuation.next_batch(SESSION_ID, user_id=42, batch_index=1)
        assert result["status"] == "retryable_empty"
        assert result["exhausted"] is False
        assert result["tracks"] == []
        assert result["batch_index"] == 2
    else:
        with pytest.raises(Exception) as caught:
            if writer == "next":
                radio_engine.next_tracks(SESSION_ID, count=1)
            elif writer == "feedback":
                radio_engine.radio_feedback(SESSION_ID, 7, "like")
            else:
                radio_engine._delete_session(SESSION_ID)
        assert type(caught.value).__name__ == "RadioLeaseLost"
        assert isinstance(caught.value, radio_continuation.RadioLeaseLost)
    assert json.loads(redis.get(session_key)) == newer
    assert redis.get(session_key + ":batch:1") is None
    assert redis.get(session_key + ":started") is None
    assert persisted == []


def test_delete_session_commits_tombstone_and_deletion_together(batches):
    redis, _ = batches
    assert radio_engine._delete_session(SESSION_ID) is True
    assert redis.get(SESSION_KEY) is None
    assert redis.get(f"{SESSION_KEY}:started") in ("1", b"1")


def test_memory_lock_respects_blocking_timeout_and_releases_after_error():
    from redis.exceptions import LockError

    redis = MemoryRedis()
    with (
        redis.lock("synthetic-lock", blocking_timeout=0.01),
        pytest.raises(LockError),
        redis.lock("synthetic-lock", blocking_timeout=0.01),
    ):
        pytest.fail("contending test lock must not enter")
    with redis.lock("synthetic-lock", blocking_timeout=0.01) as lease:
        assert lease.owned()
