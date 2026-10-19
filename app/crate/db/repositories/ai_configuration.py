"""Configuration persistence. Rows are JSON dicts; secrets are opaque references only.

CAS conflicts raise AI_CONFIGURATION_CONFLICT. Caller sessions compose writes and
bounded audit metadata in one transaction. Reads own rollback-only scopes.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import nullcontext
from collections.abc import Mapping
from typing import Any, NoReturn, overload
from uuid import UUID

from sqlalchemy import text

from crate.ai.actions import ACTIONS, get_action
from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.db.serialize import serialize_row
from crate.db.tx import optional_scope, read_scope


@overload
def _json(row: None) -> None: ...


@overload
def _json(row: Mapping[str, Any]) -> dict[str, Any]: ...


def _json(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        k: str(v) if isinstance(v, UUID) else v for k, v in serialize_row(row).items()
    }


def _read(session):
    return nullcontext(session) if session is not None else read_scope()


def _conflict() -> NoReturn:
    raise AIConfigurationError(
        "AI_CONFIGURATION_CONFLICT", "Configuration changed; reload and retry"
    )


def _audit(session, action, target, actor_id, revision):
    # Only closed metadata, never user labels, endpoints, config or credential values.
    session.execute(
        text("""INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json,user_id)
        VALUES(NOW(),:action,'ai_configuration',:target,:details,:actor)"""),
        {
            "action": action,
            "target": str(target),
            "actor": actor_id,
            "details": json.dumps({"revision": revision}),
        },
    )


@overload
def _connection(row: None, private=False) -> None: ...


@overload
def _connection(row: Mapping[str, Any], private=False) -> dict[str, Any]: ...


def _connection(row: Mapping[str, Any] | None, private=False) -> dict[str, Any] | None:
    data = _json(row)
    if data is not None:
        data["has_secret"] = bool(data.get("secret_ref"))
        if not private:
            data.pop("secret_ref", None)
    return data


def list_connections(*, session=None) -> list[dict]:
    """Public connection rows, with has_secret and without secret_ref."""
    with _read(session) as s:
        return [
            _connection(r)
            for r in s.execute(
                text("SELECT * FROM ai_provider_connections ORDER BY created_at,id")
            ).mappings()
        ]


def get_connection(id, private=False, *, session=None) -> dict | None:
    """Connection row, optionally including secret_ref for internal callers."""
    with _read(session) as s:
        return _connection(
            s.execute(
                text("SELECT * FROM ai_provider_connections WHERE id=:id"), {"id": id}
            )
            .mappings()
            .first(),
            private,
        )


_CONNECTION_FIELDS = frozenset(
    {
        "label",
        "provider",
        "secret_ref",
        "secret_source",
        "endpoint",
        "enabled",
        "max_concurrent",
        "daily_calls",
        "daily_tokens",
    }
)


def _connection_data(data):
    if not data or set(data) - _CONNECTION_FIELDS:
        raise AIConfigurationError(
            "AI_CONFIGURATION_INVALID", "Invalid connection fields"
        )
    return dict(data)


def create_connection(data, actor_id, *, session=None) -> dict:
    """Create connection; only declared storage fields are accepted."""
    values = _connection_data(data)
    fields = sorted(values)
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    f"INSERT INTO ai_provider_connections({','.join(fields)}) VALUES({','.join(':' + k for k in fields)}) RETURNING *"
                ),
                values,
            )
            .mappings()
            .one()
        )
        _audit(s, "ai.connection.create", row["id"], actor_id, row["revision"])
        return _connection(row)


def update_connection(id, data, expected_revision, actor_id, *, session=None) -> dict:
    values = _connection_data(data)
    assignments = ",".join(f"{key}=:{key}" for key in sorted(values))
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    f"UPDATE ai_provider_connections SET {assignments},revision=revision+1,updated_at=NOW() WHERE id=:id AND revision=:expected RETURNING *"
                ),
                {**values, "id": id, "expected": expected_revision},
            )
            .mappings()
            .first()
        )
        if row is None:
            _conflict()
        _audit(s, "ai.connection.update", id, actor_id, row["revision"])
        return _connection(row)


def save_model_catalog(
    id, models, status, expected_revision, error_code=None, *, session=None
) -> dict:
    """CAS cache refresh; model list contains only validated capability dictionaries."""
    from crate.ai.contracts import ModelCapabilities

    models = [
        ModelCapabilities.model_validate(m).model_dump(mode="json") for m in models
    ]
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""UPDATE ai_provider_connections SET model_catalog=CAST(:models AS jsonb),catalog_status=:status,
            catalog_error_code=:error,catalog_updated_at=NOW(),updated_at=NOW(),revision=revision+1
            WHERE id=:id AND revision=:expected RETURNING *"""),
                {
                    "models": json.dumps(models),
                    "status": status,
                    "error": error_code,
                    "id": id,
                    "expected": expected_revision,
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            _conflict()
        return _connection(row)


def _version(s, id, version, data):
    config = ProfileConfig.model_validate(data.get("config", {})).model_dump(
        mode="json"
    )
    content = {
        "connection_id": str(data["connection_id"]),
        "model_id": data["model_id"],
        "config": config,
    }
    fingerprint = hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return _json(
        s.execute(
            text("""INSERT INTO ai_profile_versions(profile_id,version,connection_id,model_id,config,fingerprint)
        VALUES(:id,:version,:connection,:model,CAST(:config AS jsonb),:fingerprint) RETURNING *"""),
            {
                "id": id,
                "version": version,
                "connection": data["connection_id"],
                "model": data["model_id"],
                "config": json.dumps(config),
                "fingerprint": fingerprint,
            },
        )
        .mappings()
        .one()
    )


def create_profile(data, actor_id, *, session=None) -> dict:
    """Return profile row (id,label,current_version,created_at); version 1 is atomic."""
    with optional_scope(session) as s:
        with s.begin_nested():
            row = (
                s.execute(
                    text("INSERT INTO ai_profiles(label) VALUES(:label) RETURNING *"),
                    {"label": data["label"]},
                )
                .mappings()
                .one()
            )
            _version(s, row["id"], 1, data)
            _audit(s, "ai.profile.create", row["id"], actor_id, 1)
            return _json(row)


def create_profile_version(
    id, data, expected_version, actor_id, *, session=None
) -> dict:
    """Append immutable version and CAS current_version; return version row."""
    with optional_scope(session) as s:
        with s.begin_nested():
            version = s.execute(
                text(
                    "UPDATE ai_profiles SET current_version=current_version+1 WHERE id=:id AND current_version=:expected RETURNING current_version"
                ),
                {"id": id, "expected": expected_version},
            ).scalar_one_or_none()
            if version is None:
                _conflict()
            row = _version(s, id, version, data)
            _audit(s, "ai.profile.version.create", id, actor_id, version)
            return row


def list_profiles(*, session=None) -> list[dict]:
    with _read(session) as s:
        return [
            _json(r)
            for r in s.execute(
                text("SELECT * FROM ai_profiles ORDER BY created_at,id")
            ).mappings()
        ]


def get_profile_version(id, version, *, session=None) -> dict | None:
    with _read(session) as s:
        return _json(
            s.execute(
                text(
                    "SELECT * FROM ai_profile_versions WHERE profile_id=:id AND version=:version"
                ),
                {"id": id, "version": version},
            )
            .mappings()
            .first()
        )


def list_bindings(*, session=None) -> list[dict]:
    with _read(session) as s:
        return [
            _json(r)
            for r in s.execute(
                text("SELECT * FROM ai_action_bindings ORDER BY action_id")
            ).mappings()
        ]


def get_binding(action_id, *, session=None) -> dict | None:
    with _read(session) as s:
        return _json(
            s.execute(
                text("SELECT * FROM ai_action_bindings WHERE action_id=:id"),
                {"id": action_id},
            )
            .mappings()
            .first()
        )


def _apply(s, changes):
    ids = [change["action_id"] for change in changes]
    if len(set(ids)) != len(ids):
        raise AIConfigurationError("AI_CONFIGURATION_INVALID", "Duplicate action")
    for action_id in ids:
        get_action(action_id)
    # State lock also covers absent binding rows, so simultaneous revision-0 creates serialize.
    s.execute(
        text("SELECT singleton FROM ai_configuration_state WHERE singleton FOR UPDATE")
    )
    existing = {
        r["action_id"]: dict(r)
        for r in s.execute(
            text("SELECT * FROM ai_action_bindings ORDER BY action_id FOR UPDATE")
        ).mappings()
    }
    for change in changes:
        if (existing.get(change["action_id"]) or {}).get("revision", 0) != change[
            "expected_revision"
        ]:
            _conflict()
    results = []
    for change in sorted(changes, key=lambda c: c["action_id"]):
        row = (
            s.execute(
                text("""INSERT INTO ai_action_bindings(action_id,profile_id,profile_version,enabled)
            VALUES(:action_id,:profile_id,:profile_version,:enabled) ON CONFLICT(action_id) DO UPDATE
            SET profile_id=EXCLUDED.profile_id,profile_version=EXCLUDED.profile_version,enabled=EXCLUDED.enabled,
            revision=ai_action_bindings.revision+1 RETURNING *"""),
                change,
            )
            .mappings()
            .one()
        )
        results.append(_json(row))
    return results


def apply_bindings(changes: list[dict], actor_id, *, session=None) -> list[dict]:
    """All-or-none binding CAS. Return sorted action rows with incremented revisions."""
    with optional_scope(session) as s:
        # Savepoint preserves all-or-none even if caller catches FK/validation exceptions.
        with s.begin_nested():
            result = _apply(s, changes)
            for row in result:
                _audit(
                    s, "ai.binding.update", row["action_id"], actor_id, row["revision"]
                )
            return result


def configuration_state(*, session=None) -> dict:
    with _read(session) as s:
        return _json(
            s.execute(text("SELECT * FROM ai_configuration_state WHERE singleton"))
            .mappings()
            .one()
        )


def activate_configuration(
    bindings, expected_revision, actor_id, *, session=None
) -> dict:
    """One-time activation snapshots exactly the eleven actions in one transaction."""
    if len(bindings) != len(ACTIONS) or {c["action_id"] for c in bindings} != set(
        ACTIONS
    ):
        raise AIConfigurationError(
            "AI_CONFIGURATION_INVALID", "Activation requires every action"
        )
    with optional_scope(session) as s:
        with s.begin_nested():
            state = (
                s.execute(
                    text(
                        "SELECT * FROM ai_configuration_state WHERE singleton FOR UPDATE"
                    )
                )
                .mappings()
                .one()
            )
            if state["active"] or state["revision"] != expected_revision:
                _conflict()
            apply_bindings(bindings, actor_id, session=s)
            row = (
                s.execute(
                    text(
                        "UPDATE ai_configuration_state SET active=TRUE,revision=revision+1,activated_at=NOW() WHERE singleton RETURNING *"
                    )
                )
                .mappings()
                .one()
            )
            _audit(
                s, "ai.configuration.activate", "singleton", actor_id, row["revision"]
            )
            return _json(row)


__all__ = [
    "list_connections",
    "get_connection",
    "create_connection",
    "update_connection",
    "save_model_catalog",
    "create_profile",
    "create_profile_version",
    "list_profiles",
    "get_profile_version",
    "list_bindings",
    "get_binding",
    "apply_bindings",
    "configuration_state",
    "activate_configuration",
]
