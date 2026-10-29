"""Radio lease failures preserve committed batches and remain retryable."""

import json
import os
from contextlib import contextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from crate import radio_continuation, radio_engine


@pytest.fixture(scope="module")
def redis_server():
    from redis import Redis

    url = os.environ.get("CRATE_TEST_RADIO_REDIS_URL")
    if url:
        client = Redis.from_url(url)
        client.ping()
        yield client
        client.close()
        return

    from testcontainers.redis import RedisContainer

    with RedisContainer("redis:7-alpine") as container:
        client = container.get_client()
        yield client
        client.close()


@pytest.fixture
def radio_store(redis_server, monkeypatch):
    session_id = str(uuid4())
    lock_factory = redis_server.lock

    def short_lock(name, **kwargs):
        return lock_factory(name, **{**kwargs, "blocking_timeout": 0.05, "sleep": 0.01})

    monkeypatch.setattr(redis_server, "lock", short_lock)
    monkeypatch.setattr(radio_engine, "_redis", lambda: redis_server)
    monkeypatch.setattr(radio_engine, "_apply_buffer_context", lambda *_args: None)
    generated = []

    def generate(session, count):
        generated.append(session["track_count"])
        return [{"track_id": session["track_count"] + 1, "title": "Next"}]

    monkeypatch.setattr(radio_engine, "_generate_batch", generate)
    yield SimpleNamespace(
        redis=redis_server,
        session_id=session_id,
        key=f"radio:session:{session_id}",
        generated=generated,
    )
    keys = list(redis_server.scan_iter(f"radio:session:{session_id}*"))
    if keys:
        redis_server.delete(*keys)


def _seed(store, **overrides):
    session = {
        "id": store.session_id,
        "user_id": 42,
        "track_count": 20,
        "batch_index": 0,
        "revision": 1,
        "initial_target": [0.2, 0.8],
        "current_target": [0.2, 0.8],
        "liked_vectors": [],
        "disliked_vectors": [],
        **overrides,
    }
    store.redis.setex(store.key, 60, json.dumps(session))
    return session


def _cached(store, index):
    result = {
        "session_id": store.session_id,
        "tracks": [{"track_id": 91, "title": "Committed"}],
        "status": "ok",
        "exhausted": False,
        "batch_index": index,
        "revision": 1,
    }
    store.redis.setex(f"{store.key}:batch:{index}", 60, json.dumps(result))
    return result


def _assert_retry(result, cursor):
    assert result["tracks"] == []
    assert result["status"] == "retryable_empty"
    assert result["exhausted"] is False
    assert result["batch_index"] == cursor


def _assert_domain_error(error):
    assert type(error).__name__ == "RadioLeaseLost"
    assert isinstance(error, radio_continuation.RadioLeaseLost)


def test_session_lock_translates_real_acquisition_timeout(radio_store):
    with (
        radio_store.redis.lock(f"{radio_store.key}:lock", timeout=5),
        pytest.raises(Exception) as caught,
        radio_continuation.session_lock(radio_store.session_id),
    ):
        pytest.fail("the contending writer must not enter")

    _assert_domain_error(caught.value)


def test_session_lock_translates_real_release_not_owned(radio_store):
    with (
        pytest.raises(Exception) as caught,
        radio_continuation.session_lock(radio_store.session_id) as lease,
    ):
        radio_store.redis.delete(lease.name)

    _assert_domain_error(caught.value)


def test_session_lock_preserves_unrelated_body_errors(radio_store):
    failure = ValueError("invalid synthetic candidate")
    with (
        pytest.raises(ValueError) as caught,
        radio_continuation.session_lock(radio_store.session_id),
    ):
        raise failure

    assert caught.value is failure
    assert radio_store.redis.get(f"{radio_store.key}:lock") is None


def test_session_lock_preserves_unrelated_body_error_after_lease_loss(radio_store):
    failure = ValueError("invalid synthetic candidate after lease loss")
    with (
        pytest.raises(ValueError) as caught,
        radio_continuation.session_lock(radio_store.session_id) as lease,
    ):
        radio_store.redis.delete(lease.name)
        raise failure

    assert caught.value is failure


def test_next_batch_preserves_unrelated_body_error_after_lease_loss(
    radio_store, monkeypatch
):
    original = _seed(radio_store)
    failure = ValueError("invalid synthetic batch after lease loss")

    def generate(_session, _count):
        radio_store.redis.delete(f"{radio_store.key}:lock")
        raise failure

    monkeypatch.setattr(radio_engine, "_generate_batch", generate)

    with pytest.raises(ValueError) as caught:
        radio_continuation.next_batch(radio_store.session_id, user_id=42, batch_index=1)

    assert caught.value is failure
    assert json.loads(radio_store.redis.get(radio_store.key)) == original
    assert radio_store.redis.get(f"{radio_store.key}:batch:1") is None


def test_leased_pipeline_translates_a_failed_ownership_fence(radio_store):
    lease = SimpleNamespace(name=f"{radio_store.key}:lock", owned=lambda: False)
    with (
        pytest.raises(Exception) as caught,
        radio_continuation.leased_pipeline(lease) as pipe,
    ):
        pipe.set(radio_store.key, "stale")
        pipe.execute()

    _assert_domain_error(caught.value)
    assert radio_store.redis.get(radio_store.key) is None


def test_leased_pipeline_translates_a_real_watch_conflict(radio_store):
    radio_store.redis.set(f"{radio_store.key}:lock", "old-owner")

    def owned():
        radio_store.redis.set(f"{radio_store.key}:lock", "new-owner")
        return True

    lease = SimpleNamespace(name=f"{radio_store.key}:lock", owned=owned)
    with (
        pytest.raises(Exception) as caught,
        radio_continuation.leased_pipeline(lease) as pipe,
    ):
        pipe.set(radio_store.key, "stale")
        pipe.execute()

    _assert_domain_error(caught.value)
    assert radio_store.redis.get(radio_store.key) is None


def test_leased_pipeline_preserves_unrelated_body_errors(radio_store):
    failure = ValueError("invalid synthetic mutation")
    lease = SimpleNamespace(name=f"{radio_store.key}:lock", owned=lambda: True)
    with (
        pytest.raises(ValueError) as caught,
        radio_continuation.leased_pipeline(lease),
    ):
        raise failure

    assert caught.value is failure


@pytest.mark.parametrize("cursor", [0, 3, None], ids=["first", "later", "legacy"])
def test_contending_next_returns_the_last_committed_cursor(radio_store, cursor):
    saved = _seed(radio_store, batch_index=cursor)
    if cursor is None:
        saved.pop("batch_index")
        radio_store.redis.setex(radio_store.key, 60, json.dumps(saved))
    with radio_store.redis.lock(f"{radio_store.key}:lock", timeout=5):
        result = radio_continuation.next_batch(
            radio_store.session_id, user_id=42, batch_index=(cursor or 0) + 1
        )

    _assert_retry(result, cursor or 0)
    assert json.loads(radio_store.redis.get(radio_store.key)) == saved
    assert radio_store.generated == []


def test_contending_start_without_committed_state_returns_minus_one(radio_store):
    with radio_store.redis.lock(f"{radio_store.key}:lock", timeout=5):
        result = radio_continuation.start_batch(
            session_id=radio_store.session_id, user_id=42
        )

    _assert_retry(result, -1)
    assert radio_store.redis.get(radio_store.key) is None
    assert radio_store.redis.get(f"{radio_store.key}:started") is None


@pytest.mark.parametrize("operation,index", [("start", 0), ("next", 1)])
@pytest.mark.parametrize("owner", [42, 99], ids=["owner", "foreign-owner"])
def test_contention_replays_the_requested_committed_batch(
    radio_store, operation, index, owner
):
    _seed(radio_store, batch_index=index, user_id=owner)
    cached = _cached(radio_store, index)
    with radio_store.redis.lock(f"{radio_store.key}:lock", timeout=5):
        if operation == "start":
            result = radio_continuation.start_batch(
                session_id=radio_store.session_id, user_id=42
            )
        else:
            result = radio_continuation.next_batch(
                radio_store.session_id, user_id=42, batch_index=index
            )

    if owner == 42:
        assert result == cached
    else:
        assert result["status"] == "exhausted"
        assert result["tracks"] == []
        assert "Committed" not in json.dumps(result)
    assert radio_store.generated == []


@pytest.mark.parametrize("operation,index", [("start", 0), ("next", 1)])
def test_lost_release_after_commit_replays_tracks_instead_of_skipping_them(
    radio_store, monkeypatch, operation, index
):
    session = _seed(radio_store)
    if operation == "start":
        radio_store.redis.delete(radio_store.key)
        monkeypatch.setattr(
            radio_engine,
            "_create_radio",
            lambda *_args, **_kwargs: (
                {**session, "track_count": 1},
                {"session_id": radio_store.session_id, "tracks": [{"track_id": 1}]},
            ),
        )
    lock_factory = radio_store.redis.lock

    @contextmanager
    def lost_release(name, **kwargs):
        with lock_factory(name, **kwargs) as lease:
            yield lease
            radio_store.redis.delete(name)

    monkeypatch.setattr(radio_store.redis, "lock", lost_release)
    if operation == "start":
        result = radio_continuation.start_batch(
            session_id=radio_store.session_id, user_id=42
        )
    else:
        result = radio_continuation.next_batch(
            radio_store.session_id, user_id=42, batch_index=index
        )

    cached = json.loads(radio_store.redis.get(f"{radio_store.key}:batch:{index}"))
    assert result == cached
    assert result["status"] == "ok"
    assert result["tracks"]
    assert result["batch_index"] == index
    assert json.loads(radio_store.redis.get(radio_store.key))["batch_index"] == index
    assert radio_store.generated == ([] if operation == "start" else [20])


@pytest.mark.parametrize("new_owner", [42, 99], ids=["same-owner", "foreign-owner"])
def test_late_next_rereads_the_winning_state_without_overwriting_it(
    radio_store, monkeypatch, new_owner
):
    previous = _seed(radio_store)
    newer = {**previous, "batch_index": 3, "track_count": 80, "user_id": new_owner}

    def late_generation(_session, _count):
        radio_store.redis.set(f"{radio_store.key}:lock", "winning-lease", ex=5)
        radio_store.redis.setex(radio_store.key, 60, json.dumps(newer))
        return [{"track_id": 21, "title": "Uncommitted"}]

    monkeypatch.setattr(radio_engine, "_generate_batch", late_generation)
    result = radio_continuation.next_batch(
        radio_store.session_id, user_id=42, batch_index=1
    )

    if new_owner == 42:
        _assert_retry(result, 3)
    else:
        assert result["status"] == "exhausted"
        assert result["tracks"] == []
        assert result.get("batch_index") != 3
    assert json.loads(radio_store.redis.get(radio_store.key)) == newer
    assert radio_store.redis.get(f"{radio_store.key}:batch:1") is None
    assert radio_store.redis.get(f"{radio_store.key}:started") is None


def test_late_start_does_not_report_its_uncommitted_zero_cursor(
    radio_store, monkeypatch
):
    session = _seed(radio_store)
    radio_store.redis.delete(radio_store.key)

    def late_create(*_args, **_kwargs):
        radio_store.redis.delete(f"{radio_store.key}:lock")
        return session, {"session_id": radio_store.session_id, "tracks": []}

    monkeypatch.setattr(radio_engine, "_create_radio", late_create)
    result = radio_continuation.start_batch(
        session_id=radio_store.session_id, user_id=42
    )

    _assert_retry(result, -1)
    assert radio_store.redis.get(radio_store.key) is None
    assert radio_store.redis.get(f"{radio_store.key}:batch:0") is None
    assert radio_store.redis.get(f"{radio_store.key}:started") is None


@pytest.mark.parametrize("operation", ["next", "feedback", "delete"])
def test_nonindexed_writers_propagate_the_domain_lease_error(radio_store, operation):
    _seed(radio_store)
    with (
        radio_store.redis.lock(f"{radio_store.key}:lock", timeout=5),
        pytest.raises(Exception) as caught,
    ):
        if operation == "next":
            radio_engine.next_tracks(radio_store.session_id, 1)
        elif operation == "feedback":
            radio_engine.radio_feedback(radio_store.session_id, 7, "like")
        else:
            radio_engine._delete_session(radio_store.session_id)

    _assert_domain_error(caught.value)


def test_feedback_persists_to_database_after_releasing_the_redis_lock(
    radio_store, monkeypatch
):
    _seed(radio_store)
    monkeypatch.setattr(
        radio_engine, "get_track_bliss_vector", lambda _track_id: [0.9, 0.1]
    )
    persisted = []

    def persist(**kwargs):
        probe = radio_store.redis.lock(f"{radio_store.key}:lock", timeout=5)
        acquired = probe.acquire(blocking=False)
        assert acquired, "database feedback persistence must run outside the lease"
        try:
            saved = json.loads(radio_store.redis.get(radio_store.key))
            assert saved["liked_vectors"] == [[0.9, 0.1]]
            persisted.append(kwargs)
        finally:
            probe.release()

    monkeypatch.setattr(radio_engine, "persist_radio_feedback", persist)

    result = radio_engine.radio_feedback(radio_store.session_id, 7, "like")

    assert result["effect"] == "target_shifted"
    assert len(persisted) == 1
    assert persisted[0]["track_id"] == 7
    assert persisted[0]["action"] == "like"


def test_feedback_does_not_persist_to_database_after_a_failed_fence(
    radio_store, monkeypatch
):
    original = _seed(radio_store)
    persisted = []

    def vector(_track_id):
        radio_store.redis.set(f"{radio_store.key}:lock", "winning-lease", ex=5)
        return [0.9, 0.1]

    monkeypatch.setattr(radio_engine, "get_track_bliss_vector", vector)
    monkeypatch.setattr(
        radio_engine,
        "persist_radio_feedback",
        lambda **kwargs: persisted.append(kwargs),
    )

    with pytest.raises(Exception) as caught:
        radio_engine.radio_feedback(radio_store.session_id, 7, "like")

    _assert_domain_error(caught.value)
    assert persisted == []
    assert json.loads(radio_store.redis.get(radio_store.key)) == original
