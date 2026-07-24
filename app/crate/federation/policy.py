"""Federation transport defaults shared by peer operations."""

from __future__ import annotations

import os

from crate.federation.authorization import AuthorizationDecision, GrantConstraints


DEFAULT_PEER_SEARCH_TIMEOUT_MS = int(
    os.environ.get("CRATE_FEDERATION_SEARCH_TIMEOUT_MS", "600")
)
DEFAULT_PEER_HEALTH_POLL_INTERVAL_S = int(
    os.environ.get("CRATE_FEDERATION_HEALTH_POLL_INTERVAL_S", "300")
)


def apply_result_limit(
    payload: dict[str, list[dict]],
    *,
    requested_limit: int,
    constraints: GrantConstraints | None,
) -> dict[str, list[dict]]:
    allowed = max(0, requested_limit)
    if constraints and constraints.max_results is not None:
        allowed = min(allowed, constraints.max_results)
    remaining = allowed
    result: dict[str, list[dict]] = {}
    for key in ("artists", "albums", "tracks"):
        items = list(payload.get(key, []))
        result[key] = items[:remaining]
        remaining = max(0, remaining - len(result[key]))
    return result


def entity_is_allowed(
    decision: AuthorizationDecision,
    *,
    entity_type: str,
    entity_uid: str,
) -> bool:
    constraints = decision.constraints
    if constraints is None:
        return decision.allowed
    if (
        constraints.allowed_entity_types
        and entity_type not in constraints.allowed_entity_types
    ):
        return False
    return not (
        constraints.allowed_entity_uids
        and entity_uid not in constraints.allowed_entity_uids
    )
