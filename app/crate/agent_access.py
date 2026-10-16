"""Identity and opaque credentials for the bounded remote-agent interface."""

import hashlib
import os
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime

from crate.agent_operation_catalog import OPERATIONS

TOKEN_PREFIX = "crate_mcp_"
PILOT_GRANTS = frozenset(
    {"library.health.read", "ops.status.read", "ops.jobs.read", "ops.logs.read"}
)
ACTION_GRANTS = frozenset(
    {
        "library.health.run",
        "library.repair.photo_flag",
        "ops.jobs.retry",
        "ops.jobs.cancel_pending",
    }
)
ACTION_GRANTS = ACTION_GRANTS | frozenset(value[0] for value in OPERATIONS.values())
ALLOWED_GRANTS = PILOT_GRANTS | ACTION_GRANTS
SCOPE_CAPABILITIES = {
    "library.health.read": "library.view",
    "library.health.run": "library.repair.run",
    "library.repair.photo_flag": "library.repair.run",
    "ops.status.read": "ops.health.view",
    "ops.jobs.read": "ops.tasks.manage",
    "ops.jobs.retry": "ops.tasks.manage",
    "ops.jobs.cancel_pending": "ops.tasks.manage",
    "ops.logs.read": "ops.logs.view",
}
SCOPE_CAPABILITIES.update(
    {grant: capability for grant, capability in OPERATIONS.values()}
)
_TOKEN_PATTERN = re.compile(r"crate_mcp_[A-Za-z0-9_-]{43}\Z")


def actions_enabled() -> bool:
    return os.environ.get("CRATE_MCP_ACTIONS_ENABLED", "false").lower() == "true"


@dataclass(frozen=True, slots=True)
class AgentPrincipal:
    id: str
    credential_id: str
    name: str
    grants: frozenset[str]
    authorization_id: str | None = None
    actor_user_id: int | None = None
    client_id: str | None = None
    accepted_scopes: frozenset[str] | None = None


def authorization_context(principal: AgentPrincipal) -> dict:
    if principal.authorization_id is None:
        return {}
    return {
        "authorization_id": principal.authorization_id,
        "actor_user_id": principal.actor_user_id,
        "client_id": principal.client_id,
        "accepted_scopes": sorted(principal.accepted_scopes or principal.grants),
    }


@dataclass(frozen=True, slots=True)
class IssuedCredential:
    principal: AgentPrincipal
    token: str = field(repr=False)
    expires_at: datetime


def generate_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def digest_token(token: str) -> str:
    if not isinstance(token, str) or not _TOKEN_PATTERN.fullmatch(token):
        raise ValueError("Invalid agent credential")
    return hashlib.sha256(token.encode("ascii")).hexdigest()


__all__ = [
    "ACTION_GRANTS",
    "ALLOWED_GRANTS",
    "PILOT_GRANTS",
    "SCOPE_CAPABILITIES",
    "TOKEN_PREFIX",
    "AgentPrincipal",
    "IssuedCredential",
    "actions_enabled",
    "authorization_context",
    "digest_token",
    "generate_token",
]
