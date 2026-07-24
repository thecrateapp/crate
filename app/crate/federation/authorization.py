"""Single owner-side authorization engine for federation capabilities."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class GrantConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    max_results: int | None = Field(default=None, ge=1, le=500)
    allowed_entity_types: frozenset[Literal["artist", "album", "track"]] = frozenset()
    allowed_entity_uids: frozenset[str] = frozenset()
    delivery: frozenset[Literal["balanced", "original", "transcoded"]] = frozenset()
    allow_original: bool = False
    max_concurrent_streams: int | None = Field(default=None, ge=1, le=100)
    daily_stream_bytes: int | None = Field(default=None, ge=1)
    max_import_bytes: int | None = Field(default=None, ge=1)
    import_requires_approval: bool = True


@dataclass(frozen=True, slots=True)
class AuthorizationDecision:
    allowed: bool
    grant_uid: UUID | None
    policy_revision: int
    constraints: GrantConstraints | None
    denial_code: str | None


def _json_value(value, default):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value if value is not None else default


def _selector_matches(
    selector: str,
    *,
    peer_uid: str,
    subject_hash: str | None,
    roles: set[str],
) -> bool:
    if selector in {"*", "peer", f"peer:{peer_uid}", f"peer_users:{peer_uid}"}:
        return True
    if subject_hash and selector == f"subject:{subject_hash}":
        return True
    if selector.startswith("role:"):
        return selector.removeprefix("role:") in roles
    return False


def _is_active(grant: dict, *, now: datetime) -> bool:
    if grant.get("revoked_at") is not None or grant.get("disabled_at") is not None:
        return False
    valid_from = grant.get("valid_from") or grant.get("created_at")
    valid_until = grant.get("valid_until") or grant.get("expires_at")
    if valid_from is not None and valid_from > now:
        return False
    return not (valid_until is not None and valid_until <= now)


def _deny(
    code: str,
    *,
    revision: int = 0,
    peer_uid: str | None = None,
    subject_hash: str | None = None,
) -> AuthorizationDecision:
    if peer_uid is not None:
        from crate.federation.abuse import observe_risk_signal

        observe_risk_signal(
            "auth_denial",
            peer_node_uid=peer_uid,
            subject_hash=subject_hash,
            severity="low",
            reason_code=code,
        )
    return AuthorizationDecision(
        allowed=False,
        grant_uid=None,
        policy_revision=revision,
        constraints=None,
        denial_code=code,
    )


def authorize(
    *,
    peer: dict,
    grants: list[dict],
    capability: str,
    subject_hash: str | None,
    roles: set[str],
    subject_blocked: bool = False,
    now: datetime | None = None,
) -> AuthorizationDecision:
    peer_uid = str(peer.get("node_uid") or "") or None
    if peer.get("trust_state") != "approved":
        return _deny("peer_not_approved", peer_uid=peer_uid, subject_hash=subject_hash)
    if peer.get("disabled_at") is not None:
        return _deny("peer_disabled", peer_uid=peer_uid, subject_hash=subject_hash)
    if subject_blocked:
        return _deny("subject_blocked", peer_uid=peer_uid, subject_hash=subject_hash)

    current_time = now or datetime.now(timezone.utc)
    peer_uid = str(peer["node_uid"])
    matching = [
        grant
        for grant in grants
        if _is_active(grant, now=current_time)
        and _selector_matches(
            str(grant.get("subject_selector") or grant.get("principal_selector") or ""),
            peer_uid=peer_uid,
            subject_hash=subject_hash,
            roles=roles,
        )
    ]
    if not matching:
        return _deny("no_matching_grant", peer_uid=peer_uid, subject_hash=subject_hash)
    matching.sort(
        key=lambda grant: (
            int(grant.get("priority") or 0),
            int(grant.get("policy_revision") or 0),
        ),
        reverse=True,
    )
    revision = max(int(grant.get("policy_revision") or 0) for grant in matching)
    permitted = [
        grant
        for grant in matching
        if capability in _json_value(grant.get("capabilities_json"), [])
    ]
    if not permitted:
        return _deny(
            "capability_denied",
            revision=revision,
            peer_uid=peer_uid,
            subject_hash=subject_hash,
        )

    grant = permitted[0]
    try:
        if int(grant.get("constraints_version") or 1) != 1:
            raise ValueError("unsupported constraints version")
        constraints = GrantConstraints.model_validate(
            _json_value(grant.get("constraints_json"), {})
        )
    except (TypeError, ValueError, ValidationError):
        return _deny(
            "invalid_constraints",
            revision=int(grant.get("policy_revision") or 0),
            peer_uid=peer_uid,
            subject_hash=subject_hash,
        )
    raw_uid = grant.get("grant_uid")
    return AuthorizationDecision(
        allowed=True,
        grant_uid=UUID(str(raw_uid)) if raw_uid else None,
        policy_revision=int(grant.get("policy_revision") or 0),
        constraints=constraints,
        denial_code=None,
    )
