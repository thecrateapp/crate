"""Bounded owner-side preparation for federated playback variants."""

from __future__ import annotations

import time
from enum import StrEnum
from typing import Any

PREPARE_RESERVATION_TTL_SECONDS = 20 * 60
MAX_PREPARE_RESERVATIONS_PER_PEER = 4
MAX_PREPARE_RESERVATIONS_GLOBAL = 20


class PrepareReservation(StrEnum):
    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"
    PEER_LIMITED = "peer_limited"
    GLOBAL_LIMITED = "global_limited"
    UNAVAILABLE = "unavailable"


_ACQUIRE_PREPARE_RESERVATION = """
local peer_key = KEYS[1]
local global_key = KEYS[2]
local cache_key = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local peer_limit = tonumber(ARGV[4])
local global_limit = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', peer_key, 0, now - ttl)
redis.call('ZREMRANGEBYSCORE', global_key, 0, now - ttl)

if redis.call('ZSCORE', global_key, cache_key) or redis.call('ZSCORE', peer_key, cache_key) then
    return 2
end
if redis.call('ZCARD', peer_key) >= peer_limit then
    return 3
end
if redis.call('ZCARD', global_key) >= global_limit then
    return 4
end

redis.call('ZADD', peer_key, now, cache_key)
redis.call('ZADD', global_key, now, cache_key)
redis.call('EXPIRE', peer_key, ttl)
redis.call('EXPIRE', global_key, ttl)
return 1
"""


def _peer_reservation_key(peer_node_uid: str) -> str:
    return f"federation:playback-prepare:peer:{peer_node_uid}"


def _global_reservation_key() -> str:
    return "federation:playback-prepare:global"


def acquire_prepare_reservation(
    redis_client: Any | None,
    peer_node_uid: str,
    cache_key: str,
) -> PrepareReservation:
    """Atomically reserve bounded owner work, failing closed when Redis is absent."""
    if redis_client is None or not peer_node_uid or not cache_key:
        return PrepareReservation.UNAVAILABLE
    try:
        result = int(
            redis_client.eval(
                _ACQUIRE_PREPARE_RESERVATION,
                2,
                _peer_reservation_key(peer_node_uid),
                _global_reservation_key(),
                cache_key,
                str(time.time()),
                str(PREPARE_RESERVATION_TTL_SECONDS),
                str(MAX_PREPARE_RESERVATIONS_PER_PEER),
                str(MAX_PREPARE_RESERVATIONS_GLOBAL),
            )
            or 0
        )
    except Exception:
        return PrepareReservation.UNAVAILABLE

    return {
        1: PrepareReservation.ACCEPTED,
        2: PrepareReservation.DUPLICATE,
        3: PrepareReservation.PEER_LIMITED,
        4: PrepareReservation.GLOBAL_LIMITED,
    }.get(result, PrepareReservation.UNAVAILABLE)


__all__ = [
    "MAX_PREPARE_RESERVATIONS_GLOBAL",
    "MAX_PREPARE_RESERVATIONS_PER_PEER",
    "PREPARE_RESERVATION_TTL_SECONDS",
    "PrepareReservation",
    "acquire_prepare_reservation",
]
