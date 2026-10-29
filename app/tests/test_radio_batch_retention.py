"""Redis batch retention and session deletion commit behind the same lease."""

import json
from uuid import uuid4

import pytest
from crate import radio_continuation, radio_engine

from tests.test_radio_lease_recovery import _cached, _seed, radio_store, redis_server

__all__ = ["radio_store", "redis_server"]


def _record_transactions(store, monkeypatch, *, lose_lease=False):
    transactions = []
    pipeline_factory = store.redis.pipeline

    def pipeline(*args, **kwargs):
        pipe = pipeline_factory(*args, **kwargs)
        execute = pipe.execute

        def execute_recorded(*args, **kwargs):
            transactions.append([command for command, _options in pipe.command_stack])
            if lose_lease:
                store.redis.set(f"{store.key}:lock", "winning-lease", ex=5)
            return execute(*args, **kwargs)

        monkeypatch.setattr(pipe, "execute", execute_recorded)
        return pipe

    monkeypatch.setattr(store.redis, "pipeline", pipeline)
    return transactions


def _deleted_keys(commands):
    return {
        key.decode() if isinstance(key, bytes) else key
        for command in commands
        if command[0] == "DEL"
        for key in command[1:]
    }


def test_next_commit_retains_two_batches_and_evicts_the_third_in_the_same_multi(
    radio_store, monkeypatch
):
    _seed(radio_store, batch_index=1)
    _cached(radio_store, 0)
    previous = _cached(radio_store, 1)
    transactions = _record_transactions(radio_store, monkeypatch)

    result = radio_continuation.next_batch(
        radio_store.session_id, user_id=42, batch_index=2
    )

    assert result["status"] == "ok"
    assert len(transactions) == 1
    commands = transactions[0]
    assert f"{radio_store.key}:batch:0" in _deleted_keys(commands)
    written = {command[1] for command in commands if command[0] == "SET"}
    assert {radio_store.key, f"{radio_store.key}:batch:2"} <= written
    assert radio_store.redis.get(f"{radio_store.key}:batch:0") is None
    assert json.loads(radio_store.redis.get(f"{radio_store.key}:batch:1")) == previous
    assert json.loads(radio_store.redis.get(f"{radio_store.key}:batch:2")) == result
    assert json.loads(radio_store.redis.get(radio_store.key))["batch_index"] == 2


def test_failed_next_commit_preserves_old_batches_and_the_committed_cursor(
    radio_store, monkeypatch
):
    original = _seed(radio_store, batch_index=1)
    oldest = _cached(radio_store, 0)
    previous = _cached(radio_store, 1)
    _record_transactions(radio_store, monkeypatch, lose_lease=True)

    result = radio_continuation.next_batch(
        radio_store.session_id, user_id=42, batch_index=2
    )

    assert result["status"] == "retryable_empty"
    assert result["batch_index"] == 1
    assert json.loads(radio_store.redis.get(radio_store.key)) == original
    assert json.loads(radio_store.redis.get(f"{radio_store.key}:batch:0")) == oldest
    assert json.loads(radio_store.redis.get(f"{radio_store.key}:batch:1")) == previous
    assert radio_store.redis.get(f"{radio_store.key}:batch:2") is None


def test_pruned_start_batch_resyncs_a_live_owner_without_recreating_the_session(
    radio_store, monkeypatch
):
    _seed(radio_store, batch_index=2, track_count=80)
    _cached(radio_store, 1)
    _cached(radio_store, 2)
    radio_store.redis.set(f"{radio_store.key}:started", "1", ex=60)
    monkeypatch.setattr(
        radio_engine,
        "_create_radio",
        lambda *_args, **_kwargs: pytest.fail("a pruned start must not regenerate"),
    )

    resumed = radio_continuation.start_batch(
        session_id=radio_store.session_id, user_id=42
    )
    foreign = radio_continuation.start_batch(
        session_id=radio_store.session_id, user_id=99
    )
    radio_store.redis.delete(radio_store.key)
    expired = radio_continuation.start_batch(
        session_id=radio_store.session_id, user_id=42
    )

    assert foreign["status"] == expired["status"] == "exhausted"
    assert foreign["tracks"] == expired["tracks"] == []
    assert foreign.get("batch_index") != 2
    assert radio_store.generated == []
    assert resumed["status"] == "retryable_empty"
    assert resumed["exhausted"] is False
    assert resumed["tracks"] == []
    assert resumed["batch_index"] == 2


@pytest.mark.parametrize("session_present", [True, False], ids=["live", "expired"])
def test_delete_cleans_all_its_cached_batches_atomically_and_keeps_the_tombstone(
    radio_store, monkeypatch, session_present
):
    if session_present:
        _seed(radio_store, batch_index=12)
    batch_keys = {f"{radio_store.key}:batch:{index}" for index in (0, 1, 12, 997)}
    for index in (0, 1, 12, 997):
        _cached(radio_store, index)
    foreign_key = f"radio:session:{uuid4()}"
    foreign_keys = [foreign_key, f"{foreign_key}:batch:12", f"{foreign_key}:started"]
    for key in foreign_keys:
        radio_store.redis.set(key, "foreign-session", ex=60)
    transactions = _record_transactions(radio_store, monkeypatch)

    try:
        deleted = radio_engine._delete_session(radio_store.session_id)

        assert deleted is session_present
        assert len(transactions) == 1
        assert batch_keys | {radio_store.key} <= _deleted_keys(transactions[0])
        assert all(radio_store.redis.get(key) is None for key in batch_keys)
        assert radio_store.redis.get(radio_store.key) is None
        assert radio_store.redis.get(f"{radio_store.key}:started") == b"1"
        assert all(
            radio_store.redis.get(key) == b"foreign-session" for key in foreign_keys
        )
    finally:
        radio_store.redis.delete(*foreign_keys)


def test_failed_delete_does_not_remove_batches_or_create_a_tombstone(
    radio_store, monkeypatch
):
    original = _seed(radio_store, batch_index=5)
    cached = {index: _cached(radio_store, index) for index in (0, 4, 5)}
    _record_transactions(radio_store, monkeypatch, lose_lease=True)

    with pytest.raises(radio_continuation.RadioLeaseLost):
        radio_engine._delete_session(radio_store.session_id)

    assert json.loads(radio_store.redis.get(radio_store.key)) == original
    assert radio_store.redis.get(f"{radio_store.key}:started") is None
    for index, batch in cached.items():
        assert (
            json.loads(radio_store.redis.get(f"{radio_store.key}:batch:{index}"))
            == batch
        )
