from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope, transaction_scope

ACCESS_TOKEN_PREFIX = "crv_"
ACCESS_TOKEN_TYPE = "virtualdj"
PLAYBACK_CONTINUATION_TOKEN_TYPE = "playback_continuation"
PLAYBACK_CONTINUATION_SCOPE = "playback.continuation"
PLAYBACK_CONTINUATION_TTL = timedelta(hours=12)
ACCESS_TOKEN_BYTES = 32
ACCESS_TOKEN_PREFIX_LENGTH = 12
LAST_USED_UPDATE_INTERVAL = timedelta(minutes=5)

SUPPORTED_ACCESS_TOKEN_SCOPES = frozenset(
    {
        "vdj.catalog.read",
        "vdj.media.read",
        "vdj.smart_mix.read",
        "vdj.play_events.write",
        "vdj.automation",
        "vdj.automation.execute",
    }
)


def _normalize_scopes(scopes: list[str]) -> list[str]:
    normalized: list[str] = []
    for scope in scopes:
        value = scope.strip()
        if value not in SUPPORTED_ACCESS_TOKEN_SCOPES:
            raise ValueError(f"Unsupported access token scope: {value}")
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        raise ValueError("At least one access token scope is required")
    return normalized


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _generate_secret() -> str:
    return ACCESS_TOKEN_PREFIX + secrets.token_urlsafe(ACCESS_TOKEN_BYTES)


def _row_to_dict(row: Any, *, secret: str | None = None) -> dict[str, Any]:
    result = dict(row)
    scopes = result.get("scopes")
    if isinstance(scopes, str):
        scopes = json.loads(scopes)
    result["scopes"] = list(scopes or [])
    if secret is not None:
        result["token"] = secret
    return result


def _insert_token(
    session,
    *,
    user_id: int,
    name: str,
    scopes: list[str],
    expires_at: datetime | None,
    now: datetime,
    token_type: str = ACCESS_TOKEN_TYPE,
    session_id: str | None = None,
    continuation_descriptor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    secret = _generate_secret()
    token_prefix = secret[:ACCESS_TOKEN_PREFIX_LENGTH]
    row = (
        session.execute(
            text(
                """
                INSERT INTO user_access_tokens (
                    user_id, name, token_type, token_digest, token_prefix,
                    scopes, expires_at, created_at, session_id,
                    continuation_descriptor
                ) VALUES (
                    :user_id, :name, :token_type, :token_digest, :token_prefix,
                    CAST(:scopes AS jsonb), :expires_at, :created_at,
                    :session_id, CAST(:continuation_descriptor AS jsonb)
                )
                RETURNING id, user_id, name, token_type, token_digest,
                          token_prefix, scopes, expires_at, revoked_at,
                          created_at, last_used_at, session_id
                """
            ),
            {
                "user_id": user_id,
                "name": name,
                "token_type": token_type,
                "token_digest": _digest(secret),
                "token_prefix": token_prefix,
                "scopes": json.dumps(scopes),
                "expires_at": expires_at,
                "created_at": now,
                "session_id": session_id,
                "continuation_descriptor": (
                    json.dumps(continuation_descriptor)
                    if continuation_descriptor is not None
                    else None
                ),
            },
        )
        .mappings()
        .one()
    )
    return _row_to_dict(row, secret=secret)


def create_access_token(
    *,
    user_id: int,
    name: str,
    scopes: list[str],
    expires_at: datetime | None = None,
    session=None,
) -> dict[str, Any]:
    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("Access token name is required")
    normalized_scopes = _normalize_scopes(scopes)
    now = datetime.now(timezone.utc)
    with optional_scope(session) as current:
        return _insert_token(
            current,
            user_id=user_id,
            name=normalized_name,
            scopes=normalized_scopes,
            expires_at=expires_at,
            now=now,
        )


def issue_playback_continuation_token(
    *,
    user_id: int,
    session_id: str,
    descriptor: dict[str, Any] | None = None,
    now: datetime | None = None,
    session=None,
) -> dict[str, Any]:
    if not session_id:
        raise ValueError("A session is required for a continuation token")
    issued_at = now or datetime.now(timezone.utc)
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                DELETE FROM user_access_tokens
                WHERE session_id = :session_id
                  AND token_type = :token_type
                """
            ),
            {
                "session_id": session_id,
                "token_type": PLAYBACK_CONTINUATION_TOKEN_TYPE,
            },
        )
        return _insert_token(
            current,
            user_id=user_id,
            name="Playback continuation",
            scopes=[PLAYBACK_CONTINUATION_SCOPE],
            expires_at=issued_at + PLAYBACK_CONTINUATION_TTL,
            now=issued_at,
            token_type=PLAYBACK_CONTINUATION_TOKEN_TYPE,
            session_id=session_id,
            continuation_descriptor=descriptor,
        )


def get_continuation_descriptor(
    token_id: int,
    *,
    session=None,
) -> dict[str, Any] | None:
    def _impl(current) -> dict[str, Any] | None:
        value = current.execute(
            text(
                """
                SELECT continuation_descriptor
                FROM user_access_tokens
                WHERE id = :token_id AND token_type = :token_type
                """
            ),
            {
                "token_id": token_id,
                "token_type": PLAYBACK_CONTINUATION_TOKEN_TYPE,
            },
        ).scalar_one_or_none()
        if isinstance(value, str):
            return json.loads(value)
        return value

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _token_query(where: str) -> str:
    return f"""
        SELECT t.id, t.user_id, t.name, t.token_type, t.token_digest,
               t.token_prefix, t.scopes, t.expires_at, t.revoked_at,
               t.created_at, t.last_used_at, t.session_id
        FROM user_access_tokens AS t
        WHERE {where}
    """


def get_access_token(user_id: int, token_id: int) -> dict[str, Any] | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    _token_query(
                        "t.user_id = :user_id AND t.id = :token_id"
                        " AND t.token_type = :token_type"
                    )
                ),
                {
                    "user_id": user_id,
                    "token_id": token_id,
                    "token_type": ACCESS_TOKEN_TYPE,
                },
            )
            .mappings()
            .first()
        )
    return _row_to_dict(row) if row else None


def list_access_tokens(
    user_id: int,
    *,
    include_revoked: bool = False,
) -> list[dict[str, Any]]:
    conditions = ["t.user_id = :user_id", "t.token_type = :token_type"]
    if not include_revoked:
        conditions.append("t.revoked_at IS NULL")
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    _token_query(" AND ".join(conditions))
                    + " ORDER BY t.created_at DESC"
                ),
                {"user_id": user_id, "token_type": ACCESS_TOKEN_TYPE},
            )
            .mappings()
            .all()
        )
    return [_row_to_dict(row) for row in rows]


def get_access_token_by_secret(
    secret: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    checked_at = now or datetime.now(timezone.utc)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    _token_query(
                        "t.token_digest = :token_digest"
                        " AND t.revoked_at IS NULL"
                        " AND (t.expires_at IS NULL OR t.expires_at > :now)"
                    )
                ),
                {"token_digest": _digest(secret), "now": checked_at},
            )
            .mappings()
            .first()
        )
    return _row_to_dict(row) if row else None


def _touch_last_used(token_id: int, now: datetime) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE user_access_tokens
                SET last_used_at = :now
                WHERE id = (
                    SELECT id
                    FROM user_access_tokens
                    WHERE id = :token_id
                      AND (last_used_at IS NULL OR last_used_at <= :stale_before)
                    FOR UPDATE SKIP LOCKED
                )
                """
            ),
            {
                "token_id": token_id,
                "now": now,
                "stale_before": now - LAST_USED_UPDATE_INTERVAL,
            },
        )


def resolve_access_token(
    secret: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    checked_at = now or datetime.now(timezone.utc)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    _token_query(
                        "t.token_digest = :token_digest"
                        " AND t.revoked_at IS NULL"
                        " AND (t.expires_at IS NULL OR t.expires_at > :now)"
                    )
                ),
                {"token_digest": _digest(secret), "now": checked_at},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None

        from crate.db.repositories.auth_users import get_user_by_id

        result = _row_to_dict(row)
        user = get_user_by_id(result["user_id"], session=session)
    if not user or user.get("status", "active") != "active":
        return None

    if (
        result["last_used_at"] is None
        or result["last_used_at"] <= checked_at - LAST_USED_UPDATE_INTERVAL
    ):
        _touch_last_used(result["id"], checked_at)
        result["last_used_at"] = checked_at

    result.update(
        {
            "email": user["email"],
            "role": user.get("role", "user"),
            "username": user.get("username"),
            "name": user.get("name"),
        }
    )
    return result


def resolve_access_token_by_id(
    token_id: int,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    checked_at = now or datetime.now(timezone.utc)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    _token_query(
                        "t.id = :token_id"
                        " AND t.revoked_at IS NULL"
                        " AND (t.expires_at IS NULL OR t.expires_at > :now)"
                    )
                ),
                {"token_id": token_id, "now": checked_at},
            )
            .mappings()
            .first()
        )
    if row is None:
        return None

    result = _row_to_dict(row)
    from crate.db.repositories.auth_users import get_user_by_id

    user = get_user_by_id(result["user_id"])
    if not user or user.get("status", "active") != "active":
        return None
    result.update(
        {
            "email": user["email"],
            "role": user.get("role", "user"),
            "username": user.get("username"),
            "name": user.get("name"),
        }
    )
    return result


def revoke_access_token(user_id: int, token_id: int, *, session=None) -> bool:
    now = datetime.now(timezone.utc)
    with optional_scope(session) as current:
        result = current.execute(
            text(
                """
                UPDATE user_access_tokens
                SET revoked_at = :now
                WHERE user_id = :user_id
                  AND id = :token_id
                  AND revoked_at IS NULL
                """
            ),
            {"now": now, "user_id": user_id, "token_id": token_id},
        )
        return bool(getattr(result, "rowcount", 0))


def rotate_access_token(user_id: int, token_id: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    _token_query(
                        "t.user_id = :user_id"
                        " AND t.id = :token_id"
                        " AND t.token_type = :token_type"
                        " AND t.revoked_at IS NULL"
                        " AND (t.expires_at IS NULL OR t.expires_at > :now)"
                    )
                    + " FOR UPDATE"
                ),
                {
                    "user_id": user_id,
                    "token_id": token_id,
                    "token_type": ACCESS_TOKEN_TYPE,
                    "now": now,
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            raise LookupError("Access token not found")
        rotated = _insert_token(
            session,
            user_id=user_id,
            name=row["name"],
            scopes=_row_to_dict(row)["scopes"],
            expires_at=row["expires_at"],
            now=now,
        )
        session.execute(
            text(
                """
                UPDATE user_access_tokens
                SET revoked_at = :now
                WHERE id = :token_id AND revoked_at IS NULL
                """
            ),
            {"now": now, "token_id": token_id},
        )
        return rotated


__all__ = [
    "ACCESS_TOKEN_PREFIX",
    "ACCESS_TOKEN_TYPE",
    "PLAYBACK_CONTINUATION_SCOPE",
    "PLAYBACK_CONTINUATION_TOKEN_TYPE",
    "PLAYBACK_CONTINUATION_TTL",
    "SUPPORTED_ACCESS_TOKEN_SCOPES",
    "create_access_token",
    "get_access_token",
    "get_access_token_by_secret",
    "get_continuation_descriptor",
    "issue_playback_continuation_token",
    "list_access_tokens",
    "resolve_access_token",
    "resolve_access_token_by_id",
    "revoke_access_token",
    "rotate_access_token",
]
