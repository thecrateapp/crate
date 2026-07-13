"""Abuse prevention — Redis-backed rate limits, nonce replay guards,
and remote subject blocking primitives.

Phase 1 implements: rate limits, manual subject block, manual peer disable.
No automatic scoring.
"""

from __future__ import annotations

import logging
import time
from typing import Any, cast

log = logging.getLogger(__name__)

# ── Nonce replay guard ────────────────────────────────────────────────────

NONCE_PREFIX = "federation:nonce"
NONCE_TTL_SECONDS = 600  # 10 minutes, longer than timestamp skew window


def check_and_record_nonce(redis_client, nonce: str, node_uid: str) -> bool:
    key = f"{NONCE_PREFIX}:{node_uid}:{nonce}"
    # SET NX: returns True if key was set (nonce is new), False if already exists
    was_set = redis_client.set(key, "1", nx=True, ex=NONCE_TTL_SECONDS)
    return bool(was_set)


# ── Rate limiter (token bucket via Redis) ─────────────────────────────────

RL_PREFIX = "federation:rl"


def check_rate_limit(
    redis_client: Any,
    bucket_key: str,
    max_requests: int,
    window_seconds: int = 60,
) -> bool:
    """Simple sliding window rate limiter. Returns True if allowed."""
    now = time.time()
    window_start = now - window_seconds

    pipeline = getattr(redis_client, "pipeline", None)
    if callable(pipeline):
        pipe = cast(Any, pipeline())
        pipe.zremrangebyscore(bucket_key, 0, window_start)
        pipe.zcard(bucket_key)
        pipe.zadd(bucket_key, {str(now): now})
        pipe.expire(bucket_key, window_seconds + 10)
        results = pipe.execute()
        if isinstance(results, (list, tuple)) and len(results) >= 2:
            return int(results[1]) < max_requests

    redis_client.zremrangebyscore(bucket_key, 0, window_start)
    current_count = int(redis_client.zcard(bucket_key) or 0)
    if current_count >= max_requests:
        redis_client.expire(bucket_key, window_seconds + 10)
        return False

    redis_client.zadd(bucket_key, {str(now): now})
    redis_client.expire(bucket_key, window_seconds + 10)
    return True


def peer_rate_limit_key(node_uid: str, action: str) -> str:
    return f"{RL_PREFIX}:peer:{node_uid}:{action}"


def subject_rate_limit_key(node_uid: str, subject_hash: str, action: str) -> str:
    return f"{RL_PREFIX}:subject:{node_uid}:{subject_hash}:{action}"


# ── Subject blocking ──────────────────────────────────────────────────────


def is_subject_blocked(
    blocked_at: str | None,
) -> bool:
    return blocked_at is not None
