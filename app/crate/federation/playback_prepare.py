"""Bounded owner-side preparation for federated playback variants."""

from __future__ import annotations

import time
from enum import StrEnum
from typing import Any

from crate.db.repositories import federation as federation_repo
from crate.federation.assertions import build_outbound_user_assertion
from crate.federation.client import SEARCH_TIMEOUT, federated_post

PREPARE_RESERVATION_TTL_SECONDS = 20 * 60
MAX_PREPARE_RESERVATIONS_PER_PEER = 4
MAX_PREPARE_RESERVATIONS_GLOBAL = 20
MAX_REMOTE_PREPARE_TRACKS = 2
PREPARE_TIMEOUT = SEARCH_TIMEOUT

_REMOTE_PREPARE_STATUSES = frozenset(
    {"ready", "preparing", "unavailable", "rate_limited"}
)


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


def prepare_remote_playback_variants(
    *,
    user: dict[str, Any],
    node_uid: str,
    remote_entity_uids: list[str],
    delivery_policy: str,
) -> dict[str, str]:
    """Ask one approved owner to prepare up to two future delivery variants.

    This best-effort hint never creates stream tickets, stores user state, or
    blocks the actual playback path. Any invalid or failed owner response is
    deliberately equivalent to no prewarm.
    """
    selected_uids = list(dict.fromkeys(str(uid) for uid in remote_entity_uids))[
        :MAX_REMOTE_PREPARE_TRACKS
    ]
    unavailable = {uid: "unavailable" for uid in selected_uids}
    if not selected_uids or delivery_policy not in {"balanced", "data_saver"}:
        return unavailable

    local_node = federation_repo.get_local_node()
    peer = federation_repo.get_peer(node_uid)
    if (
        local_node is None
        or peer is None
        or peer.get("trust_state") != "approved"
        or not peer.get("api_base_url")
    ):
        return unavailable

    try:
        assertion = build_outbound_user_assertion(
            local_node=local_node,
            peer=peer,
            user=user,
            purpose="stream.prepare",
            capabilities=["federation.stream.play"],
        )
        response = federated_post(
            base_url=str(peer["api_base_url"]),
            path="/api/federation/v1/playback/prepare",
            node_id=str(local_node["node_uid"]),
            key_id=str(local_node["active_key_id"]),
            private_key_ref=str(local_node["private_key_ref"]),
            json_body={
                "requesting_node_uid": str(local_node["node_uid"]),
                "delivery_policy": delivery_policy,
                "remote_entity_uids": selected_uids,
            },
            timeout=PREPARE_TIMEOUT,
            user_assertion=assertion,
        )
        if response.status_code >= 400:
            return unavailable
        payload = response.json()
    except Exception:
        return unavailable

    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        return unavailable
    statuses = dict(unavailable)
    for item in payload["items"]:
        if not isinstance(item, dict):
            continue
        remote_entity_uid = str(item.get("remote_entity_uid") or "")
        status = item.get("status")
        if remote_entity_uid in statuses and status in _REMOTE_PREPARE_STATUSES:
            statuses[remote_entity_uid] = status
    return statuses


__all__ = [
    "MAX_PREPARE_RESERVATIONS_GLOBAL",
    "MAX_PREPARE_RESERVATIONS_PER_PEER",
    "MAX_REMOTE_PREPARE_TRACKS",
    "PREPARE_TIMEOUT",
    "PREPARE_RESERVATION_TTL_SECONDS",
    "PrepareReservation",
    "acquire_prepare_reservation",
    "prepare_remote_playback_variants",
]
