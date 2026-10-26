"""Delegated OAuth persistence; request exchanges share one transaction."""

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import text

from crate.agent_access import (
    ALLOWED_GRANTS,
    SCOPE_CAPABILITIES,
    AgentPrincipal,
    digest_token,
    generate_token,
)
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.auth_user_accounts import get_user_by_id
from crate.db.tx import optional_scope, read_scope
from crate.mcp.oauth_config import (
    oauth_enabled,
    oauth_settings,
    validate_client_registration,
)


def token_digest(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 2048:
        raise ValueError("Invalid OAuth credential")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def oauth_transaction(callback):
    with optional_scope() as current:
        return callback(current)


def _audit(current, action, *, user_id=None, client_id=None, authorization_id=None):
    principal_id = None
    if authorization_id is not None:
        principal_id = current.execute(
            text(
                "SELECT principal_id::text FROM mcp_oauth_authorizations WHERE id = :id"
            ),
            {"id": authorization_id},
        ).scalar_one_or_none()
    current.execute(
        text("""
        INSERT INTO audit_log (timestamp, user_id, action, target_type, target_name, details_json)
        VALUES (NOW(), :user_id, :action, 'mcp_oauth', :target, CAST(:details AS jsonb))
    """),
        {
            "user_id": user_id,
            "action": action,
            "target": authorization_id or client_id,
            "details": json.dumps(
                {
                    "client_id": client_id,
                    "authorization_id": authorization_id,
                    "principal_id": principal_id,
                }
            ),
        },
    )


def register_oauth_client(
    client_id, name, redirect_uris, scopes, *, metadata_url=None, session=None
):
    validate_client_registration(client_id, name, redirect_uris, scopes, metadata_url)
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("""
            INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris, scopes, metadata_url)
            VALUES (:client_id, :name, :redirects, :scopes, :metadata_url)
            RETURNING *
        """),
                {
                    "client_id": client_id,
                    "name": name.strip(),
                    "redirects": list(redirect_uris),
                    "scopes": sorted(set(scopes)),
                    "metadata_url": metadata_url,
                },
            )
            .mappings()
            .one()
        )
        _audit(current, "agent.oauth.client.created", client_id=client_id)
        return dict(row)


def get_oauth_client(client_id, *, session=None):
    def _impl(current):
        row = (
            current.execute(
                text("SELECT * FROM mcp_oauth_clients WHERE client_id = :client_id"),
                {"client_id": client_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def list_oauth_clients(*, limit=200, before=None, session=None):
    limit = min(max(int(limit), 1), 201)

    def _impl(current):
        return [
            dict(row)
            for row in current.execute(
                text("""
            SELECT * FROM mcp_oauth_clients
            WHERE (:before IS NULL OR client_id < :before)
            ORDER BY client_id DESC LIMIT :limit
        """),
                {"before": before, "limit": limit},
            ).mappings()
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def update_oauth_client(client_id, *, enabled=None, scopes=None, session=None):
    with optional_scope(session) as current:
        client = get_oauth_client(client_id, session=current)
        if client is None:
            raise ValueError("OAuth client not found")
        target_scopes = client["scopes"] if scopes is None else scopes
        # Metadata is pinned at explicit registration. Updates do not initiate network requests.
        validate_client_registration(
            "registered-client", client["name"], client["redirect_uris"], target_scopes
        )
        row = (
            current.execute(
                text("""
            UPDATE mcp_oauth_clients SET enabled = :enabled, scopes = :scopes
            WHERE client_id = :client_id RETURNING *
        """),
                {
                    "client_id": client_id,
                    "enabled": client["enabled"] if enabled is None else bool(enabled),
                    "scopes": sorted(set(target_scopes)),
                },
            )
            .mappings()
            .one()
        )
        _audit(current, "agent.oauth.client.updated", client_id=client_id)
        return dict(row)


def list_oauth_authorizations(user_id=None, *, limit=200, before=None, session=None):
    limit = min(max(int(limit), 1), 201)

    def _impl(current):
        return [
            dict(row)
            for row in current.execute(
                text("""
            SELECT a.id::text, a.user_id, a.client_id, a.principal_id::text,
                   a.scopes, a.created_at, a.updated_at, a.revoked_at, c.name AS client_name,
                   c.enabled AS client_enabled, p.enabled AS principal_enabled
            FROM mcp_oauth_authorizations a JOIN mcp_oauth_clients c USING (client_id)
            JOIN agent_principals p ON p.id = a.principal_id
            WHERE (:user_id IS NULL OR a.user_id = :user_id)
              AND (:before_date IS NULL OR (a.created_at, a.id) < (:before_date, CAST(:before_id AS UUID)))
            ORDER BY a.created_at DESC, a.id DESC LIMIT :limit
        """),
                {
                    "user_id": user_id,
                    "limit": limit,
                    "before_date": before[0] if before else None,
                    "before_id": before[1] if before else None,
                },
            ).mappings()
        ]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def revoke_oauth_authorization(authorization_id, *, user_id=None, session=None):
    authorization_id = str(UUID(authorization_id))
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("""
            UPDATE mcp_oauth_authorizations SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
            WHERE id = :id AND (:user_id IS NULL OR user_id = :user_id)
            RETURNING client_id, user_id, credential_id
        """),
                {"id": authorization_id, "user_id": user_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ValueError("OAuth authorization not found")
        current.execute(
            text(
                "UPDATE mcp_oauth_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE authorization_id = :id"
            ),
            {"id": authorization_id},
        )
        current.execute(
            text(
                "UPDATE agent_credentials SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = :id"
            ),
            {"id": row["credential_id"]},
        )
        _audit(
            current,
            "agent.oauth.authorization.revoked",
            user_id=row["user_id"],
            client_id=row["client_id"],
            authorization_id=authorization_id,
        )


def current_user_scopes(user_id, *, session=None, worker=False):
    from crate.api.permissions import get_user_capabilities

    if worker and session is not None:
        session.execute(
            text("SELECT user_id FROM user_roles WHERE user_id = :id FOR SHARE"),
            {"id": user_id},
        )
        session.execute(
            text("SELECT id FROM users WHERE id = :id FOR SHARE"), {"id": user_id}
        )
    user = get_user_by_id(user_id, session=session)
    if not user or user.get("status", "active") != "active":
        return frozenset()
    capabilities = get_user_capabilities(user)
    return frozenset(
        scope
        for scope, capability in SCOPE_CAPABILITIES.items()
        if capability in capabilities
    )


def current_connection_scopes(user_id, client_id, *, session=None):
    def _impl(current):
        row = (
            current.execute(
                text("""
            SELECT p.grants, p.enabled FROM mcp_oauth_authorizations a
            JOIN agent_principals p ON p.id = a.principal_id
            WHERE a.user_id = :user_id AND a.client_id = :client_id AND a.issuer = :issuer
            ORDER BY a.created_at DESC, a.id DESC LIMIT 1
        """),
                {
                    "user_id": user_id,
                    "client_id": client_id,
                    "issuer": oauth_settings().issuer,
                },
            )
            .mappings()
            .first()
        )
        return (
            frozenset(ALLOWED_GRANTS)
            if row is None
            else frozenset(row["grants"])
            if row["enabled"]
            else frozenset()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def lock_delegated_authorization(authorization_id, *, session):
    try:
        authorization_id = str(UUID(authorization_id))
    except (ValueError, TypeError, AttributeError):
        raise DiagnosticError(
            "FORBIDDEN", "Invalid delegated authorization context"
        ) from None
    found = session.execute(
        text("""
        SELECT id FROM mcp_oauth_authorizations WHERE id = :id FOR SHARE
    """),
        {"id": authorization_id},
    ).scalar_one_or_none()
    if found is None:
        raise DiagnosticError("FORBIDDEN", "Delegated authorization is no longer valid")


def _authorization_row(authorization_id, current, lock=False):
    if lock:
        lock_delegated_authorization(authorization_id, session=current)
    return (
        current.execute(
            text(
                """
        SELECT a.id::text, a.user_id, a.client_id, a.issuer, a.resource, a.scopes,
               a.principal_id::text, a.credential_id::text, a.revoked_at,
               p.name, p.kind, p.enabled AS principal_enabled, p.grants,
               c.enabled AS client_enabled, c.scopes AS client_scopes,
               ac.revoked_at AS credential_revoked_at
        FROM mcp_oauth_authorizations a
        JOIN agent_principals p ON p.id = a.principal_id
        JOIN agent_credentials ac ON ac.id = a.credential_id
        JOIN mcp_oauth_clients c ON c.client_id = a.client_id
        WHERE a.id = :id
    """
                + (" FOR SHARE OF a, p, c, ac" if lock else "")
            ),
            {"id": str(UUID(authorization_id))},
        )
        .mappings()
        .first()
    )


def delegated_authorization_grants(
    authorization_id,
    *,
    actor_user_id,
    client_id,
    accepted_scopes,
    session=None,
    worker=False,
    principal_id=None,
):
    def _impl(current):
        try:
            settings = oauth_settings()
            row = _authorization_row(authorization_id, current, lock=worker)
        except (ValueError, TypeError, AttributeError):
            row = None
        if (
            not oauth_enabled()
            or row is None
            or row["revoked_at"] is not None
            or row["kind"] != "delegated"
            or not row["principal_enabled"]
            or not row["client_enabled"]
            or row["credential_revoked_at"] is not None
            or row["user_id"] != actor_user_id
            or row["client_id"] != client_id
            or (principal_id is not None and row["principal_id"] != principal_id)
            or row["issuer"] != settings.issuer
            or row["resource"] != settings.resource
            or not accepted_scopes
        ):
            raise DiagnosticError(
                "FORBIDDEN", "Delegated authorization is no longer valid"
            )
        grants = (
            frozenset(accepted_scopes)
            & set(row["scopes"])
            & set(row["grants"])
            & set(row["client_scopes"])
            & current_user_scopes(actor_user_id, session=current, worker=worker)
        )
        if not grants:
            raise DiagnosticError(
                "FORBIDDEN", "Delegated permissions are no longer available"
            )
        return frozenset(grants)

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def create_consent(user_id, session_id, parameters, *, session=None):
    nonce = secrets.token_urlsafe(32)
    consent_id = str(uuid4())
    with optional_scope(session) as current:
        if not _active_session(current, user_id, session_id):
            raise DiagnosticError("FORBIDDEN", "A current human session is required")
        current.execute(
            text("""
            INSERT INTO mcp_oauth_consents (id, user_id, session_id, client_id, nonce_digest, parameters)
            VALUES (:id, :user_id, :session_id, :client_id, :nonce, CAST(:parameters AS jsonb))
        """),
            {
                "id": consent_id,
                "user_id": user_id,
                "session_id": session_id,
                "client_id": parameters["client_id"],
                "nonce": token_digest(nonce),
                "parameters": json.dumps(parameters),
            },
        )
    return consent_id, nonce


def _active_session(current, user_id, session_id):
    return (
        current.execute(
            text("""
        SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = :session_id AND s.user_id = :user_id AND s.revoked_at IS NULL
          AND s.expires_at > NOW() AND u.status = 'active'
    """),
            {"session_id": session_id, "user_id": user_id},
        ).scalar_one_or_none()
        is not None
    )


def consume_consent(consent_id, nonce, user_id, session_id, *, session=None):
    try:
        consent_id = str(UUID(consent_id))
        nonce_digest = token_digest(nonce)
    except (ValueError, TypeError, AttributeError):
        return None
    with optional_scope(session) as current:
        if not _active_session(current, user_id, session_id):
            return None
        row = current.execute(
            text("""
            UPDATE mcp_oauth_consents SET consumed_at = NOW()
            WHERE id = :id AND nonce_digest = :nonce AND user_id = :user_id AND session_id = :session_id
              AND expires_at > NOW() AND consumed_at IS NULL
            RETURNING parameters
        """),
            {
                "id": consent_id,
                "nonce": nonce_digest,
                "user_id": user_id,
                "session_id": session_id,
            },
        ).scalar_one_or_none()
        return dict(row) if row is not None else None


def create_authorization(user_id, client_id, scopes, *, session):
    settings = oauth_settings()
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"mcp-oauth:{settings.issuer}:{user_id}:{client_id}"},
    )
    previous = (
        session.execute(
            text("""
        SELECT a.principal_id::text, p.enabled FROM mcp_oauth_authorizations a
        JOIN agent_principals p ON p.id = a.principal_id
        WHERE a.user_id = :user_id AND a.client_id = :client_id AND a.issuer = :issuer
        ORDER BY a.created_at DESC LIMIT 1
    """),
            {"user_id": user_id, "client_id": client_id, "issuer": settings.issuer},
        )
        .mappings()
        .first()
    )
    if previous and not previous["enabled"]:
        raise DiagnosticError("FORBIDDEN", "This integration has been disabled")
    principal_id = previous["principal_id"] if previous else str(uuid4())
    if previous is None:
        client = get_oauth_client(client_id, session=session)
        if client is None or not client["enabled"]:
            raise DiagnosticError("FORBIDDEN", "OAuth client is disabled")
        name = f"{client['name']} · user {user_id}"[:120]
        session.execute(
            text(
                "INSERT INTO agent_principals (id, name, grants, kind) VALUES (:id, :name, :scopes, 'delegated')"
            ),
            {"id": principal_id, "name": name, "scopes": sorted(client["scopes"])},
        )
    else:
        # Re-consent cannot expand an integration's current Admin-managed grant ceiling.
        allowed = session.execute(
            text("SELECT grants FROM agent_principals WHERE id = :id"),
            {"id": principal_id},
        ).scalar_one()
        if not set(scopes) <= set(allowed):
            raise DiagnosticError(
                "FORBIDDEN", "Integration permissions changed; review consent again"
            )
        existing = (
            session.execute(
                text(
                    "SELECT id::text FROM mcp_oauth_authorizations WHERE principal_id = :id AND revoked_at IS NULL"
                ),
                {"id": principal_id},
            )
            .scalars()
            .all()
        )
        for grant_id in existing:
            revoke_oauth_authorization(grant_id, session=session)
    credential_id, authorization_id = str(uuid4()), str(uuid4())
    session.execute(
        text("""
        INSERT INTO agent_credentials (id, principal_id, token_digest, expires_at)
        VALUES (:id, :principal_id, :digest, NOW() + INTERVAL '100 years')
    """),
        {
            "id": credential_id,
            "principal_id": principal_id,
            "digest": digest_token(generate_token()),
        },
    )
    session.execute(
        text("""
        INSERT INTO mcp_oauth_authorizations (id, user_id, client_id, issuer, resource, principal_id, credential_id, scopes)
        VALUES (:id, :user_id, :client_id, :issuer, :resource, :principal_id, :credential_id, :scopes)
    """),
        {
            "id": authorization_id,
            "user_id": user_id,
            "client_id": client_id,
            "issuer": settings.issuer,
            "resource": settings.resource,
            "principal_id": principal_id,
            "credential_id": credential_id,
            "scopes": sorted(scopes),
        },
    )
    _audit(
        session,
        "agent.oauth.authorization.consented",
        user_id=user_id,
        client_id=client_id,
        authorization_id=authorization_id,
    )
    return authorization_id


def save_code(code, authorization_id, parameters, scopes, *, session):
    settings = oauth_settings()
    session.execute(
        text("""
        INSERT INTO mcp_oauth_codes (code_digest, authorization_id, family_id, client_id, redirect_uri,
                                    issuer, resource, scopes, code_challenge, code_challenge_method)
        VALUES (:digest, :authorization_id, :family_id, :client_id, :redirect_uri, :issuer, :resource,
                :scopes, :challenge, 'S256')
    """),
        {
            "digest": token_digest(code),
            "authorization_id": authorization_id,
            "family_id": str(uuid4()),
            "client_id": parameters["client_id"],
            "redirect_uri": parameters["redirect_uri"],
            "issuer": settings.issuer,
            "resource": parameters["resource"],
            "scopes": sorted(scopes),
            "challenge": parameters["code_challenge"],
        },
    )


def _lock_authorization(authorization_id, current):
    return (
        current.execute(
            text("""
        SELECT id, revoked_at FROM mcp_oauth_authorizations WHERE id = :id FOR UPDATE
    """),
            {"id": str(authorization_id)},
        )
        .mappings()
        .first()
    )


def query_code(code, client_id, *, session):
    try:
        digest = token_digest(code)
    except ValueError:
        return None
    parameters = {"digest": digest, "client_id": client_id}
    authorization_id = session.execute(
        text("""
        SELECT authorization_id FROM mcp_oauth_codes
        WHERE code_digest = :digest AND client_id = :client_id
    """),
        parameters,
    ).scalar_one_or_none()
    if authorization_id is None:
        return None
    authorization = _lock_authorization(authorization_id, session)
    if authorization is None or authorization["revoked_at"] is not None:
        return None
    row = (
        session.execute(
            text("""
        SELECT * FROM mcp_oauth_codes
        WHERE code_digest = :digest AND client_id = :client_id FOR UPDATE
    """),
            parameters,
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    if row["consumed_at"] is not None:
        revoke_token_family(str(row["family_id"]), session=session)
        return None
    return dict(row) if row["expires_at"] > datetime.now(UTC) else None


def consume_code(digest, *, session):
    session.execute(
        text(
            "UPDATE mcp_oauth_codes SET consumed_at = NOW() WHERE code_digest = :digest"
        ),
        {"digest": digest},
    )


def get_oauth_token(raw, *, refresh=False, lock=False, session=None):
    try:
        digest = token_digest(raw)
    except ValueError:
        return None

    def _impl(current):
        column = "refresh_digest" if refresh else "access_digest"
        statement = f"SELECT * FROM mcp_oauth_tokens WHERE {column} = :digest"
        parameters = {"digest": digest}
        row = current.execute(text(statement), parameters).mappings().first()
        if row is None:
            return None
        if lock:
            # A stable parent lock serializes rotations and reuse detection across generations.
            authorization = _lock_authorization(row["authorization_id"], current)
            if authorization is None or authorization["revoked_at"] is not None:
                return None
            row = (
                current.execute(text(statement + " FOR UPDATE"), parameters)
                .mappings()
                .first()
            )
        return dict(row) if row is not None else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def save_oauth_token(token, credential, *, session):
    authorization = _lock_authorization(credential["authorization_id"], session)
    if authorization is None or authorization["revoked_at"] is not None:
        raise DiagnosticError(
            "FORBIDDEN", "OAuth authorization was revoked during the exchange"
        )
    now = datetime.now(UTC)
    session.execute(
        text("""
        INSERT INTO mcp_oauth_tokens (id, authorization_id, family_id, client_id, issuer, resource, scopes,
                                     access_digest, refresh_digest, expires_at, refresh_expires_at)
        VALUES (:id, :authorization_id, :family_id, :client_id, :issuer, :resource, :scopes,
                :access_digest, :refresh_digest, :expires_at, :refresh_expires_at)
    """),
        {
            "id": str(uuid4()),
            "authorization_id": str(credential["authorization_id"]),
            "family_id": str(credential["family_id"]),
            "client_id": credential["client_id"],
            "issuer": credential["issuer"],
            "resource": credential["resource"],
            "scopes": token["scope"].split(),
            "access_digest": token_digest(token["access_token"]),
            "refresh_digest": token_digest(token["refresh_token"]),
            "expires_at": now + timedelta(seconds=token["expires_in"]),
            "refresh_expires_at": min(
                credential.get("refresh_expires_at", now + timedelta(days=30)),
                now + timedelta(days=30),
            ),
        },
    )


def mark_refresh_used(token_id, *, session):
    session.execute(
        text("UPDATE mcp_oauth_tokens SET refresh_used_at = NOW() WHERE id = :id"),
        {"id": token_id},
    )


def revoke_token_family(family_id, *, session):
    authorization_id = session.execute(
        text("""
        SELECT authorization_id FROM mcp_oauth_tokens WHERE family_id = :id
        UNION ALL SELECT authorization_id FROM mcp_oauth_codes WHERE family_id = :id
        LIMIT 1
    """),
        {"id": family_id},
    ).scalar_one_or_none()
    if authorization_id is None:
        return
    _lock_authorization(authorization_id, session)
    session.execute(
        text("""
        UPDATE mcp_oauth_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE family_id = :id
    """),
        {"id": family_id},
    )


def credential_user(credential, *, session):
    row = _authorization_row(str(credential["authorization_id"]), session)
    if row is None:
        return None
    try:
        effective = delegated_authorization_grants(
            row["id"],
            actor_user_id=row["user_id"],
            client_id=row["client_id"],
            accepted_scopes=credential["scopes"],
            session=session,
        )
    except DiagnosticError:
        return None
    # A refresh/code exchange never silently expands or masks lost authorization.
    if not set(credential["scopes"]) <= effective:
        return None
    return {"id": row["user_id"], "authorization_id": row["id"]}


def resolve_oauth_access_token(raw, *, session=None):
    if (
        not oauth_enabled()
        or not isinstance(raw, str)
        or not raw.startswith("crate_mcp_at_")
    ):
        return None

    def _impl(current):
        settings = oauth_settings()
        token = get_oauth_token(raw, session=current)
        now = datetime.now(UTC)
        if (
            token is None
            or token["revoked_at"] is not None
            or token["expires_at"] <= now
            or token["issuer"] != settings.issuer
            or token["resource"] != settings.resource
        ):
            return None
        row = _authorization_row(str(token["authorization_id"]), current)
        if row is None:
            return None
        try:
            grants = delegated_authorization_grants(
                row["id"],
                actor_user_id=row["user_id"],
                client_id=row["client_id"],
                accepted_scopes=token["scopes"],
                session=current,
            )
        except DiagnosticError:
            return None
        principal = AgentPrincipal(
            row["principal_id"],
            row["credential_id"],
            row["name"],
            grants,
            authorization_id=row["id"],
            actor_user_id=row["user_id"],
            client_id=row["client_id"],
            accepted_scopes=frozenset(token["scopes"]),
        )
        return principal, token["expires_at"]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "consume_code",
    "consume_consent",
    "create_authorization",
    "create_consent",
    "credential_user",
    "current_user_scopes",
    "current_connection_scopes",
    "delegated_authorization_grants",
    "get_oauth_client",
    "get_oauth_token",
    "list_oauth_authorizations",
    "list_oauth_clients",
    "lock_delegated_authorization",
    "mark_refresh_used",
    "oauth_transaction",
    "query_code",
    "register_oauth_client",
    "resolve_oauth_access_token",
    "revoke_oauth_authorization",
    "revoke_token_family",
    "revoke_owned_connection",
    "save_code",
    "save_oauth_token",
    "token_digest",
    "update_oauth_client",
]


def revoke_owned_connection(
    authorization_id, consent_id, nonce, user_id, session_id, *, session=None
):
    with optional_scope(session) as current:
        parameters = consume_consent(
            consent_id, nonce, user_id, session_id, session=current
        )
        if (
            parameters is None
            or parameters.get("purpose") != "revoke_connection"
            or authorization_id not in parameters.get("authorization_ids", [])
        ):
            raise DiagnosticError(
                "FORBIDDEN",
                "The connection decision is expired or belongs to another session",
            )
        try:
            revoke_oauth_authorization(
                authorization_id, user_id=user_id, session=current
            )
        except ValueError:
            raise DiagnosticError(
                "FORBIDDEN", "This connection does not belong to the current user"
            ) from None
