"""Identity and opaque credentials for the bounded remote-agent interface."""

import hashlib
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime

TOKEN_PREFIX = "crate_mcp_"
PILOT_GRANTS = frozenset(
    {"library.health.read", "ops.status.read", "ops.jobs.read", "ops.logs.read"}
)
_TOKEN_PATTERN = re.compile(r"crate_mcp_[A-Za-z0-9_-]{43}\Z")


@dataclass(frozen=True, slots=True)
class AgentPrincipal:
    id: str
    credential_id: str
    name: str
    grants: frozenset[str]


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
    "PILOT_GRANTS",
    "TOKEN_PREFIX",
    "AgentPrincipal",
    "IssuedCredential",
    "digest_token",
    "generate_token",
]
