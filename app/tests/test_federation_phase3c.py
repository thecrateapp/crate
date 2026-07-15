"""Phase 3C tests — quotas, stream slots, byte tracking."""

from unittest.mock import MagicMock


from crate.federation.quotas import (
    acquire_stream_slot,
    release_stream_slot,
    check_byte_quota,
    record_bytes_sent,
    get_active_stream_count,
    get_daily_bytes,
    DEFAULT_MAX_STREAMS_PER_PEER,
    DEFAULT_MAX_STREAMS_PER_SUBJECT,
    DEFAULT_DAILY_BYTES_PER_PEER,
    _daily_bytes_key,
    _slots_key,
    _subject_slots_key,
)
from crate.api.federation_remote import _stream_byte_limits, _stream_slot_limits


def _mock_redis(scard_values=None, get_values=None):
    """Create a mock Redis client with configurable scard/get responses."""
    mock = MagicMock()
    mock.scard = MagicMock(return_value=0)
    mock.sadd = MagicMock()
    mock.srem = MagicMock()
    mock.expire = MagicMock()
    mock.get = MagicMock(return_value=None)
    mock.incrby = MagicMock()

    if scard_values:

        def scard_side_effect(key):
            return scard_values.get(key, 0)

        mock.scard = MagicMock(side_effect=scard_side_effect)

    if get_values:

        def get_side_effect(key):
            return get_values.get(key)

        mock.get = MagicMock(side_effect=get_side_effect)

    return mock


class _MemoryRedis:
    def __init__(self):
        self.sets: dict[str, set[str]] = {}
        self.values: dict[str, str] = {}

    def scard(self, key: str) -> int:
        return len(self.sets.get(key, set()))

    def sadd(self, key: str, value: str):
        self.sets.setdefault(key, set()).add(value)

    def srem(self, key: str, value: str):
        self.sets.setdefault(key, set()).discard(value)

    def expire(self, key: str, seconds: int):
        del key, seconds

    def get(self, key: str):
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None):
        del ex
        self.values[key] = str(value)

    def incr(self, key: str) -> int:
        value = int(self.values.get(key) or 0) + 1
        self.values[key] = str(value)
        return value

    def decr(self, key: str) -> int:
        value = int(self.values.get(key) or 0) - 1
        self.values[key] = str(value)
        return value

    def delete(self, key: str):
        self.values.pop(key, None)


class TestStreamSlots:
    def test_acquire_succeeds_when_under_limit(self):
        redis = _mock_redis()
        ok, reason, stream_id = acquire_stream_slot(redis, "node-1")
        assert ok is True
        assert reason is None
        assert stream_id is not None
        assert redis.sadd.called

    def test_acquire_fails_when_peer_at_limit(self):
        scard = {_slots_key("node-1"): 2}
        redis = _mock_redis(scard_values=scard)
        ok, reason, stream_id = acquire_stream_slot(redis, "node-1")
        assert ok is False
        assert reason == "peer_stream_limit"

    def test_acquire_fails_when_subject_at_limit(self):
        scard = {
            _slots_key("node-1"): 0,
            _subject_slots_key("node-1", "hash123"): 1,
        }
        redis = _mock_redis(scard_values=scard)
        ok, reason, stream_id = acquire_stream_slot(
            redis, "node-1", subject_hash="hash123"
        )
        assert ok is False
        assert reason == "subject_stream_limit"

    def test_release_removes_slots(self):
        redis = _mock_redis()
        release_stream_slot(redis, "node-1", "hash123", "stream-1")
        assert redis.srem.called

    def test_active_count_returns_scard(self):
        redis = _mock_redis(scard_values={_slots_key("node-1"): 3})
        count = get_active_stream_count(redis, "node-1")
        assert count == 3

    def test_same_logical_stream_reuses_subject_slot(self):
        redis = _MemoryRedis()

        first = acquire_stream_slot(
            redis,
            "node-1",
            subject_hash="hash123",
            max_subject_slots=1,
            logical_stream_key="ticket-1",
        )
        second = acquire_stream_slot(
            redis,
            "node-1",
            subject_hash="hash123",
            max_subject_slots=1,
            logical_stream_key="ticket-1",
        )
        denied = acquire_stream_slot(
            redis,
            "node-1",
            subject_hash="hash123",
            max_subject_slots=1,
            logical_stream_key="ticket-2",
        )

        assert first[0] is True
        assert second == first
        assert denied == (False, "subject_stream_limit", None)
        assert get_active_stream_count(redis, "node-1") == 1

        release_stream_slot(redis, "node-1", "hash123", first[2])
        assert get_active_stream_count(redis, "node-1") == 1

        release_stream_slot(redis, "node-1", "hash123", second[2])
        assert get_active_stream_count(redis, "node-1") == 0

    def test_listen_preset_has_gapless_playback_headroom(self):
        peer_limit, subject_limit = _stream_slot_limits(
            {"default_grant_preset": "listen"}
        )

        assert subject_limit >= 4
        assert peer_limit >= subject_limit * 2

    def test_listen_preset_uses_flac_friendly_daily_byte_quota(self):
        peer_bytes, subject_bytes = _stream_byte_limits(
            {"default_grant_preset": "listen"}
        )

        assert peer_bytes >= 50_000_000_000
        assert subject_bytes >= 25_000_000_000


class TestByteQuotas:
    def test_check_allows_when_under_limit(self):
        redis = _mock_redis()
        ok, reason = check_byte_quota(redis, "node-1")
        assert ok is True

    def test_check_denies_when_peer_over_limit(self):
        get_vals = {_daily_bytes_key("node-1"): str(DEFAULT_DAILY_BYTES_PER_PEER)}
        redis = _mock_redis(get_values=get_vals)
        ok, reason = check_byte_quota(redis, "node-1")
        assert ok is False
        assert reason == "peer_byte_quota"

    def test_record_bytes_increments_counters(self):
        redis = _mock_redis()
        record_bytes_sent(redis, "node-1", 1024, subject_hash="hash123")
        assert redis.incrby.call_count == 2

    def test_get_daily_bytes_returns_zero_when_none(self):
        redis = _mock_redis()
        assert get_daily_bytes(redis, "node-1") == 0

    def test_get_daily_bytes_returns_stored_value(self):
        get_vals = {_daily_bytes_key("node-1"): "500000"}
        redis = _mock_redis(get_values=get_vals)
        assert get_daily_bytes(redis, "node-1") == 500000


class TestDefaultLimits:
    def test_defaults_are_reasonable(self):
        assert DEFAULT_MAX_STREAMS_PER_PEER == 2
        assert DEFAULT_MAX_STREAMS_PER_SUBJECT == 1
        assert DEFAULT_DAILY_BYTES_PER_PEER == 2_000_000_000
