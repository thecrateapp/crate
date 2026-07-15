"""Manual merge/split decisions for the federated global catalog."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text

from crate.db.tx import transaction_scope

VALID_ENTITY_TYPES = {"artist", "album", "track"}
VALID_DECISION_TYPES = {"force_merge", "force_split", "ignore_candidate"}


def record_match_decision(
    *,
    entity_type: str,
    decision_type: str,
    source_a: dict[str, Any],
    source_b: dict[str, Any],
    target_global_uid: str | None = None,
    reason: str | None = None,
    admin_user_id: int | None = None,
) -> dict[str, Any]:
    if entity_type not in VALID_ENTITY_TYPES:
        raise ValueError(f"Unsupported entity type: {entity_type}")
    if decision_type not in VALID_DECISION_TYPES:
        raise ValueError(f"Unsupported decision type: {decision_type}")

    decision_id = str(uuid.uuid4())
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO global_catalog_match_decisions
                        (
                            decision_id,
                            entity_type,
                            decision_type,
                            source_a_json,
                            source_b_json,
                            target_global_uid,
                            reason,
                            admin_user_id
                        )
                    VALUES
                        (
                            :decision_id,
                            :entity_type,
                            :decision_type,
                            :source_a_json,
                            :source_b_json,
                            :target_global_uid,
                            :reason,
                            :admin_user_id
                        )
                    RETURNING
                        decision_id::text AS decision_id,
                        entity_type,
                        decision_type,
                        source_a_json,
                        source_b_json,
                        target_global_uid::text AS target_global_uid,
                        reason,
                        admin_user_id,
                        created_at
                    """
                ),
                {
                    "decision_id": decision_id,
                    "entity_type": entity_type,
                    "decision_type": decision_type,
                    "source_a_json": json.dumps(source_a, sort_keys=True),
                    "source_b_json": json.dumps(source_b, sort_keys=True),
                    "target_global_uid": target_global_uid,
                    "reason": reason,
                    "admin_user_id": admin_user_id,
                },
            )
            .mappings()
            .one()
        )
    return dict(row)


def force_merge_target_for_source(session, source: dict[str, Any]) -> str | None:
    decision = _find_decision(
        session,
        source=source,
        decision_type="force_merge",
    )
    if not decision:
        return None
    return decision.get("target_global_uid")


def merge_blocked_for_source(
    session,
    source: dict[str, Any],
    target_global_uid: str,
) -> bool:
    return (
        _find_decision(
            session,
            source=source,
            decision_type="force_split",
            target_global_uid=target_global_uid,
        )
        is not None
        or _find_decision(
            session,
            source=source,
            decision_type="ignore_candidate",
            target_global_uid=target_global_uid,
        )
        is not None
    )


def _find_decision(
    session,
    *,
    source: dict[str, Any],
    decision_type: str,
    target_global_uid: str | None = None,
) -> dict[str, Any] | None:
    rows = (
        session.execute(
            text(
                """
                SELECT
                    decision_id::text AS decision_id,
                    entity_type,
                    decision_type,
                    source_a_json,
                    source_b_json,
                    target_global_uid::text AS target_global_uid,
                    reason,
                    admin_user_id,
                    created_at
                FROM global_catalog_match_decisions
                WHERE entity_type = :entity_type
                  AND decision_type = :decision_type
                  AND (
                    :target_global_uid IS NULL
                    OR target_global_uid = :target_global_uid
                  )
                ORDER BY created_at DESC
                """
            ),
            {
                "entity_type": source["entity_type"],
                "decision_type": decision_type,
                "target_global_uid": target_global_uid,
            },
        )
        .mappings()
        .all()
    )
    for row in rows:
        decision = dict(row)
        if _decision_matches_source(decision, source):
            return decision
    return None


def _decision_matches_source(decision: dict[str, Any], source: dict[str, Any]) -> bool:
    return _json_matches_source(
        decision["source_b_json"], source
    ) or _json_matches_source(decision["source_a_json"], source)


def _json_matches_source(raw_value: Any, source: dict[str, Any]) -> bool:
    value = _coerce_json(raw_value)
    if not value:
        return False
    for key in ("match_key", "node_uid", "remote_entity_uid", "local_entity_uid"):
        expected = value.get(key)
        if expected is not None and str(expected) != str(source.get(key)):
            return False
    return any(key in value for key in ("match_key", "node_uid", "remote_entity_uid"))


def _coerce_json(raw_value: Any) -> dict[str, Any]:
    if isinstance(raw_value, dict):
        return raw_value
    if isinstance(raw_value, str):
        return json.loads(raw_value)
    return {}


__all__ = [
    "force_merge_target_for_source",
    "merge_blocked_for_source",
    "record_match_decision",
]
