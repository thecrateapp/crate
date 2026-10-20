"""Dedicated machine credentials; never authenticate a human or a media client."""

import json
from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.agent_access import (
    ALLOWED_GRANTS,
    AgentPrincipal,
    IssuedCredential,
    digest_token,
    generate_token,
)
from crate.db.tx import optional_scope, read_scope


def _expiry(expires_at: datetime) -> datetime:
    if not isinstance(expires_at, datetime) or expires_at.utcoffset() is None:
        raise ValueError("Credential expiry must include a timezone")
    if expires_at <= datetime.now(UTC):
        raise ValueError("Credential expiry must be in the future")
    return expires_at.astimezone(UTC)


def _id(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid agent or credential ID") from None


def _audit(
    session: Session, action: str, principal_id: str, credential_id: str | None
) -> None:
    session.execute(
        text(
            """
            INSERT INTO audit_log (timestamp, action, target_type, target_name, details_json)
            VALUES (NOW(), :action, 'agent_principal', :principal_id, CAST(:details AS jsonb))
            """
        ),
        {
            "action": action,
            "principal_id": principal_id,
            "details": json.dumps(
                {"principal_id": principal_id, "credential_id": credential_id}
            ),
        },
    )


def _issue(
    session: Session,
    principal_id: str,
    name: str,
    grants: Iterable[str],
    expires_at: datetime,
) -> IssuedCredential:
    credential_id = str(uuid4())
    token = generate_token()
    session.execute(
        text(
            """
            INSERT INTO agent_credentials (id, principal_id, token_digest, expires_at)
            VALUES (:id, :principal_id, :digest, :expires_at)
            """
        ),
        {
            "id": credential_id,
            "principal_id": principal_id,
            "digest": digest_token(token),
            "expires_at": expires_at,
        },
    )
    return IssuedCredential(
        principal=AgentPrincipal(principal_id, credential_id, name, frozenset(grants)),
        token=token,
        expires_at=expires_at,
    )


def create_credential(
    name: str,
    grants: Iterable[str],
    expires_at: datetime,
    *,
    session: Session | None = None,
) -> IssuedCredential:
    name = name.strip()
    if (
        not name
        or len(name) > 120
        or any(ord(char) < 32 or ord(char) == 127 for char in name)
    ):
        raise ValueError("Integration name must contain 1 to 120 printable characters")
    if isinstance(grants, str):
        raise TypeError("Grants must be a collection of allowed scopes")
    grants = frozenset(grants)
    if not grants or not grants <= ALLOWED_GRANTS:
        raise ValueError("Grants must be a nonempty subset of the allowed scopes")
    expires_at = _expiry(expires_at)
    principal_id = str(uuid4())
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                INSERT INTO agent_principals (id, name, grants)
                VALUES (:id, :name, :grants)
                """
            ),
            {"id": principal_id, "name": name, "grants": sorted(grants)},
        )
        issued = _issue(current, principal_id, name, grants, expires_at)
        _audit(
            current,
            "agent.credential.created",
            principal_id,
            issued.principal.credential_id,
        )
        return issued


def resolve_credential(
    token: str, *, session: Session | None = None
) -> AgentPrincipal | None:
    try:
        digest = digest_token(token)
    except ValueError:
        return None

    def _impl(current: Session) -> AgentPrincipal | None:
        row = (
            current.execute(
                text(
                    """
                SELECT p.id::text, c.id::text AS credential_id, p.name, p.grants
                FROM agent_credentials c
                JOIN agent_principals p ON p.id = c.principal_id
                WHERE c.token_digest = :digest AND p.enabled AND p.kind = 'service'
                  AND c.revoked_at IS NULL AND c.expires_at > NOW()
                """
                ),
                {"digest": digest},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        return AgentPrincipal(
            row["id"], row["credential_id"], row["name"], frozenset(row["grants"])
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def list_credentials(*, session: Session | None = None) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        return [
            dict(row)
            for row in current.execute(
                text(
                    """
                    SELECT c.id::text AS credential_id, p.id::text AS principal_id,
                           p.name, p.enabled, p.grants, c.created_at, c.expires_at, c.revoked_at
                    FROM agent_principals p
                    JOIN agent_credentials c ON c.principal_id = p.id
                    WHERE p.kind<>'human'
                    ORDER BY p.created_at DESC, c.created_at DESC, c.id
                    """
                )
            ).mappings()
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def rotate_credential(
    credential_id: str,
    expires_at: datetime,
    *,
    session: Session | None = None,
) -> IssuedCredential:
    credential_id = _id(credential_id)
    expires_at = _expiry(expires_at)
    with optional_scope(session) as current:
        row = (
            current.execute(
                text(
                    """
                SELECT p.id::text, p.name, p.grants, p.enabled, p.kind, c.revoked_at
                FROM agent_credentials c
                JOIN agent_principals p ON p.id = c.principal_id
                WHERE c.id = :id
                FOR UPDATE OF c, p
                """
                ),
                {"id": credential_id},
            )
            .mappings()
            .first()
        )
        if (
            row is None
            or row["revoked_at"] is not None
            or not row["enabled"]
            or row["kind"] != "service"
        ):
            raise ValueError(
                "Credential does not exist, is revoked or integration is disabled"
            )
        current.execute(
            text("UPDATE agent_credentials SET revoked_at = NOW() WHERE id = :id"),
            {"id": credential_id},
        )
        issued = _issue(current, row["id"], row["name"], row["grants"], expires_at)
        _audit(current, "agent.credential.revoked", row["id"], credential_id)
        _audit(
            current,
            "agent.credential.rotated",
            row["id"],
            issued.principal.credential_id,
        )
        return issued


def revoke_credential(credential_id: str, *, session: Session | None = None) -> bool:
    credential_id = _id(credential_id)
    with optional_scope(session) as current:
        principal_id = current.execute(
            text(
                """
                UPDATE agent_credentials SET revoked_at = NOW()
                WHERE id = :id AND revoked_at IS NULL RETURNING principal_id::text
                """
            ),
            {"id": credential_id},
        ).scalar_one_or_none()
        if principal_id is None:
            return False
        _audit(current, "agent.credential.revoked", principal_id, credential_id)
        return True


def set_principal_enabled(
    principal_id: str, enabled: bool, *, session: Session | None = None
) -> bool:
    principal_id = _id(principal_id)
    if not isinstance(enabled, bool):
        raise TypeError("Enabled must be a boolean")
    with optional_scope(session) as current:
        changed = current.execute(
            text(
                """
                UPDATE agent_principals SET enabled = :enabled
                WHERE id = :id AND enabled != :enabled RETURNING id
                """
            ),
            {"id": principal_id, "enabled": enabled},
        ).scalar_one_or_none()
        if changed is None:
            return False
        _audit(
            current,
            "agent.principal.enabled" if enabled else "agent.principal.disabled",
            principal_id,
            None,
        )
        return True


__all__ = [
    "create_credential",
    "list_credentials",
    "resolve_credential",
    "revoke_credential",
    "rotate_credential",
    "set_principal_enabled",
]
