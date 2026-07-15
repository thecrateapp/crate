"""Abuse prevention — Redis-backed rate limits, nonce replay guards,
and remote subject blocking primitives.

Phase 1 implements: rate limits, manual subject block, manual peer disable.
No automatic scoring.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, cast

from crate.db.repositories import federation_risk as risk_repo

log = logging.getLogger(__name__)

RISK_ALGORITHM_VERSION = "crate-risk-v1"
RISK_HALF_LIFE_SECONDS = 3600
RISK_WEIGHTS = {
    "invalid_signature": 20.0,
    "nonce_replay": 30.0,
    "pairing_flood": 10.0,
    "auth_denial": 5.0,
    "quota_denial": 3.0,
    "import_hash_failure": 25.0,
    "stream_error": 2.0,
}
_SEVERITY_MULTIPLIER = {"low": 0.5, "medium": 1.0, "high": 1.5}


@dataclass(frozen=True, slots=True)
class RiskScore:
    score: float
    inputs: list[dict]
    algorithm_version: str = RISK_ALGORITHM_VERSION


@dataclass(frozen=True, slots=True)
class TemporaryActionRecommendation:
    action_type: str
    capability: str
    reason_code: str
    ttl_seconds: int


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def score_observations(
    observations: list[dict], *, now: datetime | None = None
) -> RiskScore:
    current = now or datetime.now(timezone.utc)
    inputs: list[dict] = []
    total = 0.0
    for observation in observations:
        kind = str(observation.get("observation_type") or "")
        weight = RISK_WEIGHTS.get(kind)
        if weight is None:
            continue
        last_seen = observation.get("last_seen_at")
        if not isinstance(last_seen, datetime):
            continue
        age_seconds = max((current - _aware(last_seen)).total_seconds(), 0.0)
        decay = math.pow(0.5, age_seconds / RISK_HALF_LIFE_SECONDS)
        count = max(int(observation.get("count") or 1), 1)
        multiplier = _SEVERITY_MULTIPLIER.get(
            str(observation.get("severity") or "medium"), 1.0
        )
        contribution = weight * count * multiplier * decay
        total += contribution
        inputs.append(
            {
                "type": kind,
                "count": count,
                "severity": str(observation.get("severity") or "medium"),
                "age_seconds": round(age_seconds, 3),
                "contribution": round(contribution, 2),
            }
        )
    inputs.sort(key=lambda item: item["type"])
    return RiskScore(score=round(min(total, 100.0), 2), inputs=inputs)


def recommended_action(
    score: float, *, capability: str
) -> TemporaryActionRecommendation | None:
    if score >= 80:
        return TemporaryActionRecommendation(
            action_type="deny",
            capability=capability,
            reason_code="risk_score_critical",
            ttl_seconds=900,
        )
    if score >= 50:
        return TemporaryActionRecommendation(
            action_type="throttle",
            capability=capability,
            reason_code="risk_score_high",
            ttl_seconds=600,
        )
    return None


def evaluate_peer_risk(
    peer_node_uid: str,
    *,
    subject_hash: str | None = None,
    capability: str = "federation.stream.play",
    observe_only: bool = True,
    now: datetime | None = None,
) -> RiskScore:
    current = now or datetime.now(timezone.utc)
    observations = risk_repo.list_recent_observations(
        peer_node_uid=peer_node_uid,
        subject_hash=subject_hash,
    )
    result = score_observations(observations, now=current)
    risk_repo.save_snapshot(
        peer_node_uid=peer_node_uid,
        subject_hash=subject_hash,
        score=result.score,
        inputs=result.inputs,
        algorithm_version=result.algorithm_version,
        computed_at=current,
    )
    action = recommended_action(result.score, capability=capability)
    if action is not None and not observe_only:
        risk_repo.create_temporary_action(
            peer_node_uid=peer_node_uid,
            subject_hash=subject_hash,
            action_type=action.action_type,
            capability=action.capability,
            reason_code=action.reason_code,
            ttl_seconds=action.ttl_seconds,
            now=current,
        )
    return result


def observe_risk_signal(
    observation_type: str,
    *,
    peer_node_uid: str | None,
    subject_hash: str | None = None,
    severity: str = "medium",
    reason_code: str,
    dedupe_key: str | None = None,
) -> None:
    """Persist a bounded signal without making request handling depend on telemetry."""
    try:
        from crate.metrics import record_federation_metric

        record_federation_metric(
            "federation.risk.signal",
            peer_uid=peer_node_uid,
            reason_code=reason_code
            if reason_code
            in {
                "signature_invalid",
                "nonce_replay",
                "peer_not_approved",
                "peer_disabled",
                "subject_blocked",
                "no_matching_grant",
                "capability_denied",
                "invalid_constraints",
                "peer_stream_limit",
                "subject_stream_limit",
                "peer_byte_quota",
                "subject_byte_quota",
                "manifest_digest_mismatch",
                "track_digest_mismatch",
                "upstream_error",
            }
            else "other",
        )
        bucket = int(time.time() // 60)
        risk_repo.record_observation(
            peer_node_uid=peer_node_uid,
            subject_hash=subject_hash,
            observation_type=observation_type,
            severity=severity,
            dedupe_key=dedupe_key or f"{reason_code}:{bucket}",
            metadata={"reason_code": reason_code},
        )
    except Exception:
        log.debug("Failed to persist federation risk signal", exc_info=True)


# ── Nonce replay guard ────────────────────────────────────────────────────

NONCE_PREFIX = "federation:nonce"
NONCE_TTL_SECONDS = 600  # 10 minutes, longer than timestamp skew window


def check_and_record_nonce(redis_client, nonce: str, node_uid: str) -> bool:
    key = f"{NONCE_PREFIX}:{node_uid}:{nonce}"
    # SET NX: returns True if key was set (nonce is new), False if already exists
    was_set = redis_client.set(key, "1", nx=True, ex=NONCE_TTL_SECONDS)
    accepted = bool(was_set)
    if not accepted:
        observe_risk_signal(
            "nonce_replay",
            peer_node_uid=node_uid,
            severity="high",
            reason_code="nonce_replay",
            dedupe_key=nonce,
        )
    return accepted


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
            allowed = int(results[1]) < max_requests
            return allowed

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
