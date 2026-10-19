"""Configuration persistence. Rows are JSON dicts; secrets are opaque references only.

CAS conflicts raise AI_CONFIGURATION_CONFLICT. Caller sessions compose writes and
bounded audit metadata in one transaction. Reads own rollback-only scopes.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import nullcontext
from collections.abc import Callable, Mapping
from typing import Any, NoReturn, overload
from uuid import UUID

from sqlalchemy import text

from crate.ai.actions import ACTIONS, get_action
from crate.ai.contracts import AIConfigurationError, LegacyProfileConfig, ProfileConfig
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
    if "endpoint" in values:
        assignments += ",model_catalog='[]'::jsonb,catalog_status='pending',catalog_error_code=NULL,catalog_updated_at=NULL"
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


def _normalized_config(config: Mapping[str, Any]) -> dict[str, Any]:
    config_type = (
        LegacyProfileConfig
        if config.get("kind") == "legacy_snapshot"
        else ProfileConfig
    )
    return config_type.model_validate(config).model_dump(mode="json")


def _fingerprint(connection_id, model_id, normalized: Mapping[str, Any]) -> str:
    content = {
        "connection_id": str(connection_id),
        "model_id": model_id,
        "config": normalized,
    }
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def version_fingerprint(
    connection_id: str, model_id: str, config: Mapping[str, Any]
) -> str:
    """Stable identity of a (connection, model, config) tuple; no SQL."""
    return _fingerprint(connection_id, model_id, _normalized_config(config))


def _version(s, id, version, data):
    config = _normalized_config(data.get("config", {}))
    fingerprint = _fingerprint(data["connection_id"], data["model_id"], config)
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


def set_default_model(value: dict | None, actor_id, *, session=None) -> bool:
    """CAS write of the singleton default model choice; revision never changes."""
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    "UPDATE ai_configuration_state SET default_model=CAST(:value AS jsonb) "
                    "WHERE singleton AND default_model IS DISTINCT FROM CAST(:value AS jsonb) RETURNING *"
                ),
                {"value": json.dumps(value) if value is not None else None},
            )
            .mappings()
            .first()
        )
        changed = row is not None
        if changed:
            _audit(s, "ai.default_model.update", "singleton", actor_id, row["revision"])
        return changed


__all__ = [
    "list_connections",
    "get_connection",
    "create_connection",
    "update_connection",
    "save_model_catalog",
    "version_fingerprint",
    "create_profile",
    "create_profile_version",
    "list_profiles",
    "get_profile_version",
    "list_bindings",
    "get_binding",
    "apply_bindings",
    "configuration_state",
    "activate_configuration",
    "set_default_model",
]


def _default_connection_id(default_model) -> str | None:
    """The stored default's connection UUID; a malformed value reads as none."""
    try:
        return str(UUID(default_model["connection_id"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def configuration_snapshot(*, bounded=False, session=None) -> dict:
    """Read all configuration in one scope with fixed batch queries.

    Public snapshots read at most 1001 rows per collection to expose truncation.
    Internal validation reads complete history so binding validation remains exact.
    """
    with _read(session) as s:
        state = configuration_state(session=s)
        default_connection_id = _default_connection_id(state.get("default_model"))
        default_connection = (
            get_connection(default_connection_id, session=s)
            if default_connection_id
            else None
        )
        if not bounded:
            return {
                "state": state,
                "connections": list_connections(session=s),
                "profiles": list_profiles(session=s),
                "bindings": list_bindings(session=s),
                "versions": [
                    _json(r)
                    for r in s.execute(
                        text(
                            "SELECT * FROM ai_profile_versions ORDER BY profile_id,version"
                        )
                    ).mappings()
                ],
                "default_connection": default_connection,
            }
        return {
            "state": state,
            "default_connection": default_connection,
            "connections": [
                _json(r)
                for r in s.execute(
                    text(
                        "SELECT id,label,provider,revision,secret_source,endpoint,enabled,catalog_status,catalog_error_code,catalog_updated_at,max_concurrent,daily_calls,daily_tokens,(secret_ref IS NOT NULL) AS has_secret,jsonb_array_length(model_catalog) AS model_count FROM ai_provider_connections ORDER BY created_at,id LIMIT 1001"
                    )
                ).mappings()
            ],
            "profiles": [
                _json(r)
                for r in s.execute(
                    text("SELECT * FROM ai_profiles ORDER BY created_at,id LIMIT 1001")
                ).mappings()
            ],
            "bindings": list_bindings(session=s),
            "versions": [
                _json(r)
                for r in s.execute(
                    text(
                        "SELECT * FROM ai_profile_versions ORDER BY created_at DESC,profile_id,version DESC LIMIT 1001"
                    )
                ).mappings()
            ],
        }


def swap_connection_credential(
    id, api_key, expected_revision, actor_id, *, session=None
):
    """Encrypt, CAS swap and revoke old credential in the same transaction."""
    from crate.credentials import store_secret, revoke_secret

    with optional_scope(session) as s:
        with s.begin_nested():
            row = (
                s.execute(
                    text(
                        "SELECT * FROM ai_provider_connections WHERE id=:id FOR UPDATE"
                    ),
                    {"id": id},
                )
                .mappings()
                .first()
            )
            if row is None or row["revision"] != expected_revision:
                _conflict()
            if row["secret_source"] == "environment":
                raise AIConfigurationError(
                    "AI_ENVIRONMENT_READ_ONLY", "Environment connections are read only"
                )
            ref = (
                store_secret(
                    "ai", {"api_key": api_key}, require_strong_key=True, session=s
                )
                if api_key is not None
                else None
            )
            result = update_connection(
                id,
                {"secret_ref": ref, "secret_source": "stored" if ref else "none"},
                expected_revision,
                actor_id,
                session=s,
            )
            if row["secret_ref"]:
                revoke_secret(row["secret_ref"], session=s)
            return result


def ensure_environment_connection(
    provider, endpoint, *, expected_revision=None, session=None
):
    """Persist metadata only on explicit refresh, activation or execution acceptance."""
    from uuid import NAMESPACE_URL, uuid5

    id = str(uuid5(NAMESPACE_URL, f"crate:ai:env:{provider}"))
    with optional_scope(session) as s:
        # Serialize metadata synchronization with the one-time activation boundary.
        active = s.execute(
            text("SELECT active FROM ai_configuration_state WHERE singleton FOR UPDATE")
        ).scalar_one()
        inserted = s.execute(
            text("""INSERT INTO ai_provider_connections(id,label,provider,secret_source,endpoint)
        VALUES(:id,:label,:provider,'environment',:endpoint) ON CONFLICT(id) DO NOTHING RETURNING id"""),
            {
                "id": id,
                "label": f"Environment {provider}",
                "provider": provider,
                "endpoint": endpoint,
            },
        ).scalar_one_or_none()
        current_revision = s.execute(
            text(
                "SELECT revision FROM ai_provider_connections WHERE id=:id FOR UPDATE"
            ),
            {"id": id},
        ).scalar_one()
        if expected_revision is not None and expected_revision != (
            0 if inserted is not None else current_revision
        ):
            _conflict()
        if not active:
            s.execute(
                text("""UPDATE ai_provider_connections SET endpoint=:endpoint,
                revision=revision+1,updated_at=NOW(),model_catalog='[]'::jsonb,
                catalog_status='pending',catalog_error_code=NULL,catalog_updated_at=NULL
                WHERE id=:id AND secret_source='environment' AND endpoint IS DISTINCT FROM :endpoint"""),
                {"id": id, "endpoint": endpoint},
            )
        return get_connection(id, private=True, session=s)


def apply_validated_bindings(
    changes, actor_id, validate, *, activate_revision=None, session=None
):
    """Validate current catalog under locks and apply the complete CAS batch."""
    with optional_scope(session) as s:
        with s.begin_nested():
            s.execute(
                text(
                    "SELECT singleton FROM ai_configuration_state WHERE singleton FOR UPDATE"
                )
            )
            # Lock connections against concurrent catalog/credential edits through commit.
            s.execute(
                text("SELECT id FROM ai_provider_connections ORDER BY id FOR SHARE")
            )
            snapshot = configuration_snapshot(session=s)
            validate(snapshot, changes)
            if activate_revision is not None:
                return activate_configuration(
                    changes, activate_revision, actor_id, session=s
                )
            return apply_bindings(changes, actor_id, session=s)


__all__ += [
    "configuration_snapshot",
    "swap_connection_credential",
    "ensure_environment_connection",
    "apply_validated_bindings",
]


def _capture_legacy_binding(s, action_id, context, validate, actor_id) -> dict:
    """Snapshot one inherited action as a version-1 profile; return its new binding."""
    provider = context["provider"]
    conn = ensure_environment_connection(provider, context["endpoint"], session=s)
    assert conn is not None
    # Catalog metadata must already have been explicitly refreshed.
    validate(conn, context, action_id)
    profile = create_profile(
        {
            "label": ACTIONS[action_id].label,
            "connection_id": conn["id"],
            "model_id": context["model_id"],
            "config": {
                "kind": "legacy_snapshot",
                "action_id": action_id,
                "legacy_model": context["legacy_model"],
                "legacy_options": context["legacy_options"],
                "legacy_deadline_seconds": context["legacy_deadline_seconds"],
            },
        },
        actor_id,
        session=s,
    )
    return {
        "action_id": action_id,
        "profile_id": profile["id"],
        "profile_version": 1,
        "enabled": True,
        "revision": 0,
    }


def activate_legacy_configuration(
    expected_revision,
    actor_id,
    legacy_contexts,
    validate,
    expected_review_fingerprint,
    review_fingerprint,
    *,
    session=None,
):
    """Internal-only exact legacy snapshots; editable API never accepts this config."""
    with optional_scope(session) as s:
        with s.begin_nested():
            s.execute(
                text(
                    "SELECT singleton FROM ai_configuration_state WHERE singleton FOR UPDATE"
                )
            )
            s.execute(
                text("SELECT id FROM ai_provider_connections ORDER BY id FOR SHARE")
            )
            if review_fingerprint() != expected_review_fingerprint:
                _conflict()
            data = configuration_snapshot(session=s)
            existing = {b["action_id"]: b for b in data["bindings"]}
            changes = []
            for action_id, context in legacy_contexts.items():
                binding = existing.get(action_id)
                if binding is None:
                    binding = _capture_legacy_binding(
                        s, action_id, context, validate, actor_id
                    )
                changes.append(
                    {k: v for k, v in binding.items() if k != "revision"}
                    | {"expected_revision": binding["revision"]}
                )
            # Revalidate all reviewed and captured versions under connection locks.
            s.execute(
                text("SELECT id FROM ai_provider_connections ORDER BY id FOR SHARE")
            )
            data = configuration_snapshot(session=s)
            for change in changes:
                version = next(
                    v
                    for v in data["versions"]
                    if v["profile_id"] == change["profile_id"]
                    and v["version"] == change["profile_version"]
                )
                conn = next(
                    c
                    for c in data["connections"]
                    if c["id"] == version["connection_id"]
                )
                validate(conn, version, change["action_id"])
            return activate_configuration(
                changes, expected_revision, actor_id, session=s
            )


__all__ += ["activate_legacy_configuration"]


_ASSIGNMENT_OPS = frozenset({"create", "append", "reuse", "legacy", "keep"})


def apply_model_assignment(
    steps: list[dict],
    *,
    default_model: dict | None,
    expected_revision: int,
    expected_review_fingerprint: str,
    review_fingerprint: Callable[[dict], str],
    validate_legacy: Callable[[dict, dict, str], object],
    validate_bindings: Callable[[dict, list[dict]], None],
    actor_id: int | None,
    session=None,
) -> dict:
    """Apply one reviewed model assignment atomically; activate when not yet active.

    Every write happens after the review is rechecked under the configuration lock.
    """
    if any(step["op"] not in _ASSIGNMENT_OPS for step in steps):
        raise AIConfigurationError("AI_CONFIGURATION_INVALID", "Invalid assignment")
    with optional_scope(session) as s:
        with s.begin_nested():
            s.execute(
                text(
                    "SELECT singleton FROM ai_configuration_state WHERE singleton FOR UPDATE"
                )
            )
            # Lock connections against concurrent catalog/credential edits through commit.
            s.execute(
                text("SELECT id FROM ai_provider_connections ORDER BY id FOR SHARE")
            )
            data = configuration_snapshot(session=s)
            if (
                data["state"]["revision"] != expected_revision
                or review_fingerprint(data) != expected_review_fingerprint
            ):
                _conflict()
            active = data["state"]["active"]
            changes = []
            for step in steps:
                op, action_id = step["op"], step["action_id"]
                if op == "keep" and active:
                    continue
                if op == "create":
                    profile_id = create_profile(
                        {
                            "label": step["label"],
                            "connection_id": step["connection_id"],
                            "model_id": step["model_id"],
                            "config": step["config"],
                        },
                        actor_id,
                        session=s,
                    )["id"]
                    version = 1
                elif op == "append":
                    profile_id = step["profile_id"]
                    version = create_profile_version(
                        profile_id,
                        {
                            "connection_id": step["connection_id"],
                            "model_id": step["model_id"],
                            "config": step["config"],
                        },
                        step["expected_version"],
                        actor_id,
                        session=s,
                    )["version"]
                elif op == "legacy":
                    captured = _capture_legacy_binding(
                        s, action_id, step["legacy_context"], validate_legacy, actor_id
                    )
                    profile_id = captured["profile_id"]
                    version = captured["profile_version"]
                else:  # reuse, keep
                    profile_id, version = step["profile_id"], step["version"]
                changes.append(
                    {
                        "action_id": action_id,
                        "profile_id": profile_id,
                        "profile_version": version,
                        "enabled": step["enabled"],
                        "expected_revision": step["expected_binding_revision"],
                    }
                )
            revision = data["state"]["revision"]
            if not active:
                revision = apply_validated_bindings(
                    changes,
                    actor_id,
                    validate_bindings,
                    activate_revision=expected_revision,
                    session=s,
                )["revision"]
            elif changes:
                apply_validated_bindings(
                    changes, actor_id, validate_bindings, session=s
                )
            if default_model is not None:
                set_default_model(default_model, actor_id, session=s)
            return {"activated": not active, "revision": revision}


__all__ += ["apply_model_assignment"]
