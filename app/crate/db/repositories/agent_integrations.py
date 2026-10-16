"""Human integration management with fresh capabilities and secret-free activity."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import text

from crate.agent_access import ALLOWED_GRANTS, SCOPE_CAPABILITIES
from crate.agent_diagnostics import DiagnosticError, _safe
from crate.db.repositories import agent_credentials
from crate.db.repositories.agent_human_sessions import require_agent_human_capabilities
from crate.db.tx import optional_scope, read_scope


def _grants(values):
    if isinstance(values, str) or not values or not set(values) <= ALLOWED_GRANTS:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Choose nonempty catalogued integration grants"
        )
    return sorted(set(values))


def _require(current, actor, grants=()):
    return require_agent_human_capabilities(
        actor,
        {"agents.integrations.manage", *(SCOPE_CAPABILITIES[g] for g in grants)},
        session=current,
    )


def _audit(current, actor, action, principal_id, details):
    current.execute(
        text("""
        INSERT INTO audit_log (timestamp,user_id,action,target_type,target_name,details_json)
        VALUES (NOW(),:user,:action,'agent_principal',:principal,CAST(:details AS jsonb))
    """),
        {
            "user": actor["id"],
            "action": action,
            "principal": principal_id,
            "details": json.dumps(
                {"principal_id": principal_id, **details}, default=str
            ),
        },
    )


def list_integrations(
    *, limit=20, before=None, principal_id=None, session=None
) -> list[dict]:
    def _read(current):
        return [
            dict(row)
            for row in current.execute(
                text("""
            SELECT p.id::text AS principal_id, p.name, p.kind, p.enabled, p.grants,
                   p.require_approval, p.policy_revision, p.created_at,
                   (SELECT timestamp FROM audit_log a WHERE a.details_json->>'principal_id' = p.id::text
                    ORDER BY timestamp DESC, id DESC LIMIT 1) AS last_activity_at,
                   (SELECT jsonb_agg(jsonb_build_object('credential_id',c.id,'created_at',c.created_at,
                       'expires_at',c.expires_at,'revoked_at',c.revoked_at) ORDER BY c.created_at DESC)
                    FROM (SELECT * FROM agent_credentials WHERE principal_id=p.id
                          ORDER BY (revoked_at IS NULL) DESC, created_at DESC, id DESC LIMIT 20) c) AS credentials,
                   EXISTS(SELECT 1 FROM agent_credentials WHERE principal_id=p.id OFFSET 20) AS credentials_truncated,
                   (SELECT jsonb_agg(jsonb_build_object('authorization_id',a.id,'user_id',a.user_id,
                       'client_id',a.client_id,'scopes',a.scopes,'revoked_at',a.revoked_at))
                    FROM (SELECT * FROM mcp_oauth_authorizations WHERE principal_id=p.id
                          ORDER BY (revoked_at IS NULL) DESC, created_at DESC, id DESC LIMIT 20) a) AS authorizations,
                   EXISTS(SELECT 1 FROM mcp_oauth_authorizations WHERE principal_id=p.id OFFSET 20) AS authorizations_truncated
            FROM agent_principals p WHERE p.kind<>'human' AND (:before IS NULL OR p.id < CAST(:before AS uuid))
              AND (:principal IS NULL OR p.id = CAST(:principal AS uuid))
            ORDER BY p.id DESC LIMIT :limit
        """),
                {
                    "before": str(UUID(before)) if before else None,
                    "principal": str(UUID(principal_id)) if principal_id else None,
                    "limit": min(max(limit, 1), 101),
                },
            ).mappings()
        ]

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def get_integration(principal_id: str, *, session=None) -> dict:
    rows = list_integrations(principal_id=principal_id, limit=1, session=session)
    if not rows:
        raise DiagnosticError("NOT_FOUND", "Integration was not found")
    return rows[0]


def create_integration(
    actor: dict,
    *,
    name: str,
    grants: list[str],
    expires_in_days=90,
    require_approval=False,
    session=None,
) -> dict:
    grants = _grants(grants)
    if type(expires_in_days) is not int or not 1 <= expires_in_days <= 365:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Expiry must be between 1 and 365 days"
        )
    with optional_scope(session) as current:
        _require(current, actor, grants)
        issued = agent_credentials.create_credential(
            name,
            grants,
            datetime.now(UTC) + timedelta(days=expires_in_days),
            session=current,
        )
        current.execute(
            text("UPDATE agent_principals SET require_approval=:approval WHERE id=:id"),
            {"id": issued.principal.id, "approval": require_approval},
        )
        _audit(
            current,
            actor,
            "agent.integration.created",
            issued.principal.id,
            {"grants": grants, "require_approval": require_approval},
        )
        return {
            "principal_id": issued.principal.id,
            "credential_id": issued.principal.credential_id,
            "token": issued.token,
            "expires_at": issued.expires_at.isoformat(),
            "policy_revision": 1,
        }


def update_integration(
    actor: dict,
    principal_id: str,
    *,
    expected_policy_revision: int,
    enabled=None,
    grants=None,
    require_approval=None,
    session=None,
) -> dict:
    principal_id = str(UUID(principal_id))
    if grants is not None:
        grants = _grants(grants)
    with optional_scope(session) as current:
        _require(current, actor)
        row = (
            current.execute(
                text(
                    "SELECT * FROM agent_principals WHERE id=:id AND kind<>'human' FOR UPDATE"
                ),
                {"id": principal_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise DiagnosticError("NOT_FOUND", "Integration was not found")
        if expected_policy_revision != row["policy_revision"]:
            raise DiagnosticError(
                "STATE_CONFLICT", "Integration policy changed; reload before saving"
            )
        next_grants = row["grants"] if grants is None else grants
        _require(current, actor, next_grants)
        next_enabled = row["enabled"] if enabled is None else enabled
        next_approval = (
            row["require_approval"] if require_approval is None else require_approval
        )
        changed = (
            next_enabled != row["enabled"]
            or set(next_grants) != set(row["grants"])
            or next_approval != row["require_approval"]
        )
        current.execute(
            text("""
            UPDATE agent_principals SET enabled=:enabled, grants=:grants, require_approval=:approval,
                policy_revision = policy_revision + :increment WHERE id=:id
        """),
            {
                "id": principal_id,
                "enabled": next_enabled,
                "grants": next_grants,
                "approval": next_approval,
                "increment": int(changed),
            },
        )
        _audit(
            current,
            actor,
            "agent.integration.updated",
            principal_id,
            {
                "grants": next_grants,
                "enabled": next_enabled,
                "require_approval": next_approval,
                "policy_revision": expected_policy_revision + int(changed),
            },
        )
        return {
            "principal_id": principal_id,
            "policy_revision": expected_policy_revision + int(changed),
            "enabled": next_enabled,
            "grants": next_grants,
            "require_approval": next_approval,
        }


def rotate_integration_credential(
    actor: dict, credential_id: str, *, expires_in_days=90, session=None
) -> dict:
    if type(expires_in_days) is not int or not 1 <= expires_in_days <= 365:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Expiry must be between 1 and 365 days"
        )
    with optional_scope(session) as current:
        _require(current, actor)
        principal = (
            current.execute(
                text(
                    "SELECT p.id::text, p.grants, p.kind FROM agent_principals p JOIN agent_credentials c ON c.principal_id=p.id WHERE c.id=:id"
                ),
                {"id": str(UUID(credential_id))},
            )
            .mappings()
            .first()
        )
        if not principal or principal["kind"] != "service":
            raise DiagnosticError("NOT_FOUND", "Service credential was not found")
        _require(current, actor, principal["grants"])
        issued = agent_credentials.rotate_credential(
            credential_id,
            datetime.now(UTC) + timedelta(days=expires_in_days),
            session=current,
        )
        _audit(
            current,
            actor,
            "agent.integration.rotated",
            principal["id"],
            {"credential_id": issued.principal.credential_id},
        )
        return {
            "principal_id": issued.principal.id,
            "credential_id": issued.principal.credential_id,
            "token": issued.token,
            "expires_at": issued.expires_at.isoformat(),
        }


def revoke_integration_credential(
    actor: dict, credential_id: str, *, session=None
) -> dict:
    with optional_scope(session) as current:
        _require(current, actor)
        principal = current.execute(
            text(
                "SELECT c.principal_id::text FROM agent_credentials c JOIN agent_principals p ON p.id=c.principal_id WHERE c.id=:id AND p.kind<>'human'"
            ),
            {"id": str(UUID(credential_id))},
        ).scalar_one_or_none()
        if principal is None:
            raise DiagnosticError("NOT_FOUND", "Credential was not found")
        agent_credentials.revoke_credential(credential_id, session=current)
        _audit(
            current,
            actor,
            "agent.integration.revoked",
            principal,
            {"credential_id": credential_id},
        )
        return {"revoked": True}


def read_integration_activity(
    principal_id: str, *, limit=20, before=None, session=None
) -> list[dict]:
    principal_id = str(UUID(principal_id))

    def _read(current):
        return [
            {key: _safe(value) for key, value in dict(row).items()}
            for row in current.execute(
                text("""
            SELECT id, timestamp, action, user_id, LEFT(target_name,128) AS target,
                jsonb_build_object(
                    'principal_id', details_json->>'principal_id', 'credential_id', details_json->>'credential_id',
                    'authorization_id', details_json->>'authorization_id', 'actor_user_id', details_json->>'actor_user_id',
                    'client_id', LEFT(details_json->>'client_id',256), 'tool', LEFT(details_json->>'tool',80),
                    'plan_id', details_json->>'plan_id', 'job_id', details_json->>'job_id',
                    'artist_uid', details_json->>'artist_uid',
                    'execution', details_json->'result'->'execution'->>'status',
                    'verification', details_json->'result'->'verification'->>'status',
                    'before', CASE WHEN jsonb_typeof(details_json->'result'->'execution'->'before')='boolean' THEN details_json->'result'->'execution'->'before' END,
                    'after', CASE WHEN jsonb_typeof(details_json->'result'->'execution'->'after')='boolean' THEN details_json->'result'->'execution'->'after' END
                ) AS evidence
            FROM audit_log WHERE details_json->>'principal_id'=:principal
              AND (:before IS NULL OR (timestamp,id) < (
                  (SELECT timestamp FROM audit_log WHERE id=:before
                   AND details_json->>'principal_id'=:principal), :before))
            ORDER BY timestamp DESC, id DESC LIMIT :limit
        """),
                {
                    "principal": principal_id,
                    "before": before,
                    "limit": min(max(limit, 1), 101),
                },
            ).mappings()
        ]

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def manage_oauth_client(
    actor,
    *,
    client_id,
    name=None,
    redirect_uris=None,
    scopes=None,
    metadata_url=None,
    enabled=None,
    create=False,
    session=None,
):
    from crate.db.repositories.mcp_oauth import (
        get_oauth_client,
        register_oauth_client,
        update_oauth_client,
    )

    with optional_scope(session) as current:
        if create:
            selected = _grants(scopes)
            _require(current, actor, selected)
            client = register_oauth_client(
                client_id,
                name,
                redirect_uris,
                selected,
                metadata_url=metadata_url,
                session=current,
            )
        else:
            _require(current, actor)
            existing = get_oauth_client(client_id, session=current)
            if not existing:
                raise DiagnosticError("NOT_FOUND", "OAuth client was not found")
            selected = _grants(scopes) if scopes is not None else existing["scopes"]
            _require(current, actor, selected)
            client = update_oauth_client(
                client_id, enabled=enabled, scopes=selected, session=current
            )
        _audit(
            current,
            actor,
            "agent.oauth.client.managed",
            client_id,
            {"client_id": client_id, "scopes": selected},
        )
        return client


def revoke_delegated_authorization(actor, authorization_id, *, session=None):
    from crate.db.repositories.mcp_oauth import revoke_oauth_authorization

    with optional_scope(session) as current:
        _require(current, actor)
        row = current.execute(
            text(
                "SELECT principal_id::text FROM mcp_oauth_authorizations WHERE id=:id"
            ),
            {"id": str(UUID(authorization_id))},
        ).scalar_one_or_none()
        if row is None:
            raise DiagnosticError("NOT_FOUND", "Delegated authorization was not found")
        revoke_oauth_authorization(authorization_id, session=current)
        _audit(
            current,
            actor,
            "agent.oauth.authorization.managed_revocation",
            row,
            {"authorization_id": authorization_id},
        )
        return {"revoked": True}


__all__ = [
    "create_integration",
    "get_integration",
    "list_integrations",
    "manage_oauth_client",
    "read_integration_activity",
    "revoke_delegated_authorization",
    "revoke_integration_credential",
    "rotate_integration_credential",
    "update_integration",
]
