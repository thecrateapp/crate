from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Lock


class AtomicRedisDouble:
    def __init__(self):
        self._lock = Lock()
        self.slots: set[str] = set()
        self.peer_bytes = 0
        self.subject_bytes = 0

    def eval(self, script, numkeys, *args):
        del numkeys
        with self._lock:
            if "CRATE_ACQUIRE_SLOT_V1" in script:
                _, _, stream_id, max_peer, max_subject, _ = args[-6:]
                if len(self.slots) >= int(max_peer) or len(self.slots) >= int(
                    max_subject
                ):
                    return [0, "stream_limit"]
                self.slots.add(str(stream_id))
                return [1, "ok"]
            if "CRATE_RELEASE_SLOT_V1" in script:
                self.slots.discard(str(args[-1]))
                return 1
            if "CRATE_RESERVE_BYTES_V1" in script:
                requested, peer_limit, subject_limit, _ = map(int, args[-4:])
                if self.peer_bytes + requested > peer_limit:
                    return [0, "peer_byte_quota"]
                if self.subject_bytes + requested > subject_limit:
                    return [0, "subject_byte_quota"]
                self.peer_bytes += requested
                self.subject_bytes += requested
                return [1, "ok"]
            raise AssertionError("unexpected script")


def test_slot_acquisition_never_overshoots_under_concurrency():
    from crate.federation.quotas import acquire_stream_slot

    redis = AtomicRedisDouble()
    with ThreadPoolExecutor(max_workers=16) as executor:
        results = list(
            executor.map(
                lambda index: acquire_stream_slot(
                    redis,
                    "peer-a",
                    "subject-a",
                    max_peer_slots=3,
                    max_subject_slots=3,
                    logical_stream_key=f"ticket-{index}",
                ),
                range(20),
            )
        )

    assert sum(1 for allowed, _, _ in results if allowed) == 3
    assert len(redis.slots) == 3


def test_byte_reservation_is_atomic_and_cluster_keys_share_hash_tag():
    from crate.federation.quotas import (
        _daily_bytes_key,
        _daily_subject_bytes_key,
        reserve_stream_bytes,
    )

    redis = AtomicRedisDouble()
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(
                lambda _: reserve_stream_bytes(
                    redis,
                    "peer-a",
                    30,
                    subject_hash="subject-a",
                    max_peer_bytes=100,
                    max_subject_bytes=100,
                ),
                range(10),
            )
        )

    assert sum(1 for allowed, _ in results if allowed) == 3
    assert redis.peer_bytes == 90
    assert "{peer-a}" in _daily_bytes_key("peer-a")
    assert "{peer-a}" in _daily_subject_bytes_key("peer-a", "subject-a")
