from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import uuid

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


OBSERVATION_TYPES = frozenset(
    {
        "invalid_signature",
        "nonce_replay",
        "pairing_flood",
        "auth_denial",
        "quota_denial",
        "import_hash_failure",
        "stream_error",
    }
)
SEVERITIES = frozenset({"low", "medium", "high"})


def _uuid_or_none(value: str | None) -> str | None:
    try:
        return str(uuid.UUID(str(value))) if value else None
    except ValueError:
        return None


def _bounded_json(value: object, *, max_bytes: int) -> str:
    encoded = json.dumps(value, separators=(",", ":"), default=str)
    if len(encoded.encode("utf-8")) <= max_bytes:
        return encoded
    return json.dumps({"truncated": True}, separators=(",", ":"))


def _observation_key(
    *,
    peer_node_uid: str | None,
    subject_hash: str | None,
    observation_type: str,
    dedupe_key: str,
) -> str:
    raw = "\x1f".join(
        (peer_node_uid or "unknown", subject_hash or "", observation_type, dedupe_key)
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def record_observation(
    *,
    peer_node_uid: str | None,
    subject_hash: str | None,
    observation_type: str,
    severity: str,
    dedupe_key: str,
    metadata: dict | None = None,
    retention_days: int = 30,
    now: datetime | None = None,
) -> dict:
    if observation_type not in OBSERVATION_TYPES:
        raise ValueError("Unknown federation risk observation type")
    if severity not in SEVERITIES:
        raise ValueError("Unknown federation risk severity")
    current = now or datetime.now(timezone.utc)
    peer_uid = _uuid_or_none(peer_node_uid)
    normalized_subject = str(subject_hash)[:128] if subject_hash else None
    key = _observation_key(
        peer_node_uid=peer_uid,
        subject_hash=normalized_subject,
        observation_type=observation_type,
        dedupe_key=str(dedupe_key)[:256],
    )
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_risk_observations (
                        observation_key, peer_node_uid, subject_hash,
                        observation_type, severity, first_seen_at, last_seen_at,
                        expires_at, metadata_json
                    )
                    VALUES (
                        :key, CAST(:peer_node_uid AS uuid), :subject_hash,
                        :observation_type, :severity, :now, :now,
                        :expires_at, CAST(:metadata_json AS jsonb)
                    )
                    ON CONFLICT (observation_key) DO UPDATE
                    SET count = federation_risk_observations.count + 1,
                        last_seen_at = EXCLUDED.last_seen_at,
                        expires_at = EXCLUDED.expires_at,
                        severity = EXCLUDED.severity,
                        metadata_json = EXCLUDED.metadata_json
                    RETURNING *
                    """
                ),
                {
                    "key": key,
                    "peer_node_uid": peer_uid,
                    "subject_hash": normalized_subject,
                    "observation_type": observation_type,
                    "severity": severity,
                    "now": current,
                    "expires_at": current
                    + timedelta(days=min(max(retention_days, 1), 90)),
                    "metadata_json": _bounded_json(metadata or {}, max_bytes=16000),
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def list_recent_observations(
    *,
    peer_node_uid: str,
    subject_hash: str | None = None,
    since: datetime | None = None,
    limit: int = 500,
) -> list[dict]:
    cutoff = since or datetime.now(timezone.utc) - timedelta(days=1)
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT *
                FROM federation_risk_observations
                WHERE peer_node_uid = CAST(:peer_node_uid AS uuid)
                  AND (:subject_hash IS NULL OR subject_hash = :subject_hash)
                  AND last_seen_at >= :cutoff
                  AND expires_at > NOW()
                ORDER BY last_seen_at DESC, id DESC
                LIMIT :limit
                """
            ),
            {
                "peer_node_uid": _uuid_or_none(peer_node_uid),
                "subject_hash": subject_hash,
                "cutoff": cutoff,
                "limit": min(max(int(limit), 1), 1000),
            },
        ).mappings()
        return [dict(row) for row in rows]


def save_snapshot(
    *,
    peer_node_uid: str,
    subject_hash: str | None,
    score: float,
    inputs: list[dict],
    algorithm_version: str,
    computed_at: datetime,
) -> dict:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_risk_snapshots (
                        peer_node_uid, subject_hash, score, inputs_json,
                        algorithm_version, computed_at, expires_at
                    )
                    VALUES (
                        CAST(:peer_node_uid AS uuid), :subject_hash, :score,
                        CAST(:inputs_json AS jsonb), :algorithm_version,
                        :computed_at, :expires_at
                    )
                    RETURNING *
                    """
                ),
                {
                    "peer_node_uid": _uuid_or_none(peer_node_uid),
                    "subject_hash": subject_hash,
                    "score": min(max(float(score), 0), 100),
                    "inputs_json": _bounded_json(inputs, max_bytes=32000),
                    "algorithm_version": algorithm_version[:64],
                    "computed_at": computed_at,
                    "expires_at": computed_at + timedelta(days=30),
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def create_temporary_action(
    *,
    peer_node_uid: str | None,
    subject_hash: str | None,
    action_type: str,
    capability: str,
    reason_code: str,
    ttl_seconds: int,
    created_by: int | None = None,
    metadata: dict | None = None,
    now: datetime | None = None,
) -> dict:
    if action_type not in {"throttle", "deny"}:
        raise ValueError("Unknown temporary action type")
    current = now or datetime.now(timezone.utc)
    ttl = min(max(int(ttl_seconds), 60), 3600)
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_temporary_actions (
                        action_uid, peer_node_uid, subject_hash, action_type,
                        capability, reason_code, created_at, expires_at,
                        created_by, metadata_json
                    )
                    VALUES (
                        CAST(:action_uid AS uuid), CAST(:peer_node_uid AS uuid),
                        :subject_hash, :action_type, :capability, :reason_code,
                        :created_at, :expires_at, :created_by,
                        CAST(:metadata_json AS jsonb)
                    )
                    RETURNING *
                    """
                ),
                {
                    "action_uid": str(uuid.uuid4()),
                    "peer_node_uid": _uuid_or_none(peer_node_uid),
                    "subject_hash": str(subject_hash)[:128] if subject_hash else None,
                    "action_type": action_type,
                    "capability": capability[:128],
                    "reason_code": reason_code[:64],
                    "created_at": current,
                    "expires_at": current + timedelta(seconds=ttl),
                    "created_by": created_by,
                    "metadata_json": _bounded_json(metadata or {}, max_bytes=16000),
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def reverse_temporary_action(action_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE federation_temporary_actions
                SET reversed_at = COALESCE(reversed_at, NOW())
                WHERE id = :action_id
                RETURNING id
                """
            ),
            {"action_id": action_id},
        ).first()
        return result is not None


def list_active_temporary_actions(
    peer_node_uid: str, *, subject_hash: str | None = None
) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT *
                FROM federation_temporary_actions
                WHERE peer_node_uid = CAST(:peer_node_uid AS uuid)
                  AND (:subject_hash IS NULL OR subject_hash = :subject_hash)
                  AND reversed_at IS NULL
                  AND expires_at > NOW()
                ORDER BY expires_at DESC, id DESC
                """
            ),
            {
                "peer_node_uid": _uuid_or_none(peer_node_uid),
                "subject_hash": subject_hash,
            },
        ).mappings()
        return [dict(row) for row in rows]


def get_risk_dashboard(*, peer_node_uid: str, limit: int = 100) -> dict:
    peer_uid = _uuid_or_none(peer_node_uid)
    bounded_limit = min(max(int(limit), 1), 200)
    with read_scope() as session:
        observations = session.execute(
            text(
                """
                SELECT id, peer_node_uid::text AS peer_node_uid, subject_hash,
                       observation_type, severity, count, first_seen_at,
                       last_seen_at, expires_at,
                       jsonb_build_object(
                           'reason_code', metadata_json->>'reason_code'
                       ) AS metadata_json
                FROM federation_risk_observations
                WHERE peer_node_uid = CAST(:peer_node_uid AS uuid)
                  AND expires_at > NOW()
                ORDER BY last_seen_at DESC, id DESC
                LIMIT :limit
                """
            ),
            {"peer_node_uid": peer_uid, "limit": bounded_limit},
        ).mappings()
        snapshot = (
            session.execute(
                text(
                    """
                    SELECT id, peer_node_uid::text AS peer_node_uid, subject_hash,
                           score, inputs_json, algorithm_version, computed_at
                    FROM federation_risk_snapshots
                    WHERE peer_node_uid = CAST(:peer_node_uid AS uuid)
                      AND expires_at > NOW()
                    ORDER BY computed_at DESC, id DESC
                    LIMIT 1
                    """
                ),
                {"peer_node_uid": peer_uid},
            )
            .mappings()
            .first()
        )
        actions = session.execute(
            text(
                """
                SELECT id, action_uid::text AS action_uid,
                       peer_node_uid::text AS peer_node_uid, subject_hash,
                       action_type, capability, reason_code, created_at,
                       expires_at, reversed_at
                FROM federation_temporary_actions
                WHERE peer_node_uid = CAST(:peer_node_uid AS uuid)
                  AND reversed_at IS NULL
                  AND expires_at > NOW()
                ORDER BY expires_at DESC, id DESC
                LIMIT :limit
                """
            ),
            {"peer_node_uid": peer_uid, "limit": bounded_limit},
        ).mappings()
        return {
            "peer_node_uid": peer_uid,
            "latest_snapshot": dict(snapshot) if snapshot else None,
            "observations": [dict(row) for row in observations],
            "temporary_actions": [dict(row) for row in actions],
        }


def purge_expired_risk_state() -> dict[str, int]:
    with transaction_scope() as session:
        observations = getattr(
            session.execute(
                text(
                    "DELETE FROM federation_risk_observations WHERE expires_at <= NOW()"
                )
            ),
            "rowcount",
            0,
        )
        snapshots = getattr(
            session.execute(
                text("DELETE FROM federation_risk_snapshots WHERE expires_at <= NOW()")
            ),
            "rowcount",
            0,
        )
        actions = getattr(
            session.execute(
                text(
                    """
                    DELETE FROM federation_temporary_actions
                    WHERE expires_at <= NOW() AND reversed_at IS NOT NULL
                    """
                )
            ),
            "rowcount",
            0,
        )
    return {
        "observations": int(observations or 0),
        "snapshots": int(snapshots or 0),
        "actions": int(actions or 0),
    }
