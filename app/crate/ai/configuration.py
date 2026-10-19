"""Administration and immutable invocation contexts. No provider I/O on reads."""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from uuid import NAMESPACE_URL, UUID, uuid5
from typing import NoReturn

from crate.ai.actions import ACTIONS, get_action, list_actions
from crate.ai.capabilities import (
    image_token_bound,
    model_capabilities,
    validate_profile,
)
from crate.ai.contracts import (
    AIConfigurationError,
    LegacyProfileConfig,
    ModelCapabilities,
    ProfileConfig,
    ReasoningConfig,
)
from crate.ai.default_model import derive_all, require_supported_reasoning
from crate.ai.discovery import validate_endpoint
from crate.credentials import CredentialSecretError, load_secret
from crate.db.repositories import ai_configuration as store

_PROVIDERS = ("gemini", "deepseek", "ollama")
_KEYS = {
    "gemini": ("GEMINI_API_KEY", "AUDIOMUSE_GEMINI_API_KEY"),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "ollama": (),
}


def _fail(code, message) -> NoReturn:
    raise AIConfigurationError(code, message)


def _hash(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _environment_key(provider):
    return next(
        (
            os.environ[name].strip()
            for name in _KEYS.get(provider, ())
            if os.environ.get(name, "").strip()
        ),
        None,
    )


def _env_id(provider):
    return str(uuid5(NAMESPACE_URL, f"crate:ai:env:{provider}"))


def ensure_environment_connection(provider, *, expected_revision=None):
    if provider not in _PROVIDERS:
        _fail("AI_PROVIDER_UNSUPPORTED", "Provider is not supported")
    from crate.llm.provider import get_config

    endpoint = validate_endpoint(
        provider, get_config()["ollama_url"] if provider == "ollama" else None
    )
    row = store.ensure_environment_connection(
        provider, endpoint, expected_revision=expected_revision
    )
    assert row is not None
    return row


def _connection(id, *, persist=False, expected_revision=None) -> dict:
    symbolic_environment = id.startswith("env:")
    if id.startswith("env:"):
        provider = id[4:]
        if provider not in _PROVIDERS:
            _fail("AI_PROVIDER_UNSUPPORTED", "Provider is not supported")
        id = (
            ensure_environment_connection(
                provider, expected_revision=expected_revision
            )["id"]
            if persist
            else _env_id(provider)
        )
    from uuid import UUID

    try:
        UUID(id)
    except (ValueError, TypeError):
        _fail("AI_CONNECTION_UNKNOWN", "Connection does not exist")
    row = store.get_connection(id, private=True)
    if row is None:
        _fail("AI_CONNECTION_UNKNOWN", "Connection does not exist")
    if persist and row["secret_source"] == "environment" and not symbolic_environment:
        return ensure_environment_connection(
            row["provider"], expected_revision=expected_revision
        )
    return row


def _catalog_fingerprint(connection):
    return _hash(
        {
            "id": connection["id"],
            "revision": connection["revision"],
            "environment_key": _hash(_environment_key(connection["provider"]))
            if connection["secret_source"] == "environment"
            else None,
        }
    )


def _public_connection_id(row):
    return (
        f"env:{row['provider']}" if row["secret_source"] == "environment" else row["id"]
    )


def _public_connection(row, *, include_models=True):
    key = (
        _environment_key(row["provider"])
        if row["secret_source"] == "environment"
        else None
    )
    result = {
        k: row[k]
        for k in (
            "id",
            "label",
            "provider",
            "revision",
            "endpoint",
            "enabled",
            "catalog_status",
            "catalog_error_code",
            "catalog_updated_at",
            "max_concurrent",
            "daily_calls",
            "daily_tokens",
        )
    } | {
        "id": _public_connection_id(row),
        "persistent_id": row["id"],
        "model_count": row.get("model_count", len(row.get("model_catalog", []))),
        "source": row["secret_source"],
        "has_key": bool(key)
        if row["secret_source"] == "environment"
        else row.get("has_secret", False),
        "last4": key[-4:] if key and len(key) > 4 else None,
        "read_only": row["secret_source"] == "environment",
    }

    if include_models:
        result["model_catalog"] = row["model_catalog"]
    return result


def _has_credential(connection):
    if connection["provider"] == "ollama":
        return True
    if connection["secret_source"] == "environment":
        return bool(_environment_key(connection["provider"]))
    if connection["secret_source"] == "stored":
        return bool(connection.get("has_secret"))
    return False


def _default_model_state(data):
    """Build the snapshot's default_model section from one already-read scope."""
    default_model = data["state"].get("default_model")
    if default_model is None:
        return None
    connection = data.get("default_connection")
    model_id = default_model["model_id"]
    available = connection is not None and connection["enabled"]
    error_code = None
    model = None
    if not available:
        error_code = "AI_CONNECTION_UNAVAILABLE"
    elif not _has_credential(connection):
        available = False
        error_code = "AI_CREDENTIAL_REQUIRED"
    else:
        model = next(
            (m for m in connection["model_catalog"] if m["model_id"] == model_id),
            None,
        )
        if model is None or not model.get("validated"):
            available = False
            error_code = "AI_MODEL_UNVALIDATED"
    features = []
    if available:
        capabilities = ModelCapabilities.model_validate(model)
        reasoning = ReasoningConfig.model_validate(default_model["reasoning"])
        bindings = {b["action_id"]: b for b in data["bindings"]}
        versions = {(v["profile_id"], v["version"]): v for v in data["versions"]}
        for derived in derive_all(capabilities, reasoning):
            if derived.config is None:
                features.append(
                    {
                        "action_id": derived.action_id,
                        "status": "incompatible",
                        "reason": derived.reason,
                    }
                )
                continue
            expected_fingerprint = store.version_fingerprint(
                connection["id"], model_id, derived.config.model_dump(mode="json")
            )
            binding = bindings.get(derived.action_id)
            bound_version = (
                versions.get((binding["profile_id"], binding["profile_version"]))
                if binding
                else None
            )
            status = (
                "default"
                if bound_version is not None
                and bound_version["fingerprint"] == expected_fingerprint
                else "override"
            )
            features.append(
                {"action_id": derived.action_id, "status": status, "reason": None}
            )
    return {
        "connection_id": (
            _public_connection_id(connection)
            if connection is not None
            else default_model["connection_id"]
        ),
        "model_id": model_id,
        "reasoning": default_model["reasoning"],
        "available": available,
        "error_code": error_code,
        "features": features,
    }


def snapshot():
    data = store.configuration_snapshot(bounded=True)
    from crate.llm.provider import get_config

    legacy_config = get_config()
    legacy_contexts = _legacy_contexts(legacy_config)
    truncated = any(
        len(data[name]) > 1000 for name in ("connections", "profiles", "versions")
    )
    for name in ("connections", "profiles", "versions"):
        data[name] = data[name][:1000]
    connections = [
        _public_connection(c, include_models=False) for c in data["connections"]
    ]
    for provider in _PROVIDERS:
        if f"env:{provider}" in {c["id"] for c in connections}:
            continue
        key = _environment_key(provider)
        connections.append(
            {
                "id": f"env:{provider}",
                "persistent_id": None,
                "label": f"Environment {provider}",
                "provider": provider,
                "revision": 0,
                "endpoint": legacy_config["ollama_url"]
                if provider == "ollama"
                else None,
                "enabled": True,
                "model_count": 0,
                "catalog_status": "pending",
                "catalog_error_code": None,
                "catalog_updated_at": None,
                "max_concurrent": 2,
                "daily_calls": 1000,
                "daily_tokens": 1000000,
                "source": "environment",
                "has_key": bool(key),
                "last4": key[-4:] if key and len(key) > 4 else None,
                "read_only": True,
            }
        )
    versions = {}
    for version in data["versions"]:
        versions.setdefault(version["profile_id"], []).append(version)
    return {
        "revision": data["state"]["revision"],
        "truncated": truncated,
        "review_fingerprint": _review_fingerprint(legacy_contexts, data),
        "legacy_actions": []
        if data["state"]["active"]
        else [
            {
                k: context[k]
                for k in (
                    "action_id",
                    "provider",
                    "model_id",
                    "legacy_model",
                    "endpoint",
                    "legacy_options",
                )
            }
            | {
                "supported": context["provider"] in _PROVIDERS,
                "effective_timeout_seconds": context["legacy_options"][
                    "timeout_seconds"
                ]
                or (
                    300
                    if context["provider"] == "ollama"
                    else (90 if ACTIONS[context["action_id"]].input == "image" else 60)
                    if context["provider"] == "gemini"
                    else None
                ),
            }
            for context in legacy_contexts.values()
        ],
        "migrated": data["state"]["active"],
        "actions": list_actions(),
        "engines": [{"provider": p, "supported": True} for p in _PROVIDERS],
        "connections": connections,
        "profiles": [
            {**p, "versions": versions.get(p["id"], [])} for p in data["profiles"]
        ],
        "bindings": data["bindings"],
        "default_model": _default_model_state(data),
    }


def create_connection(data, actor_id):
    from crate.api.schemas.ai_agents import ConnectionCreate

    values = ConnectionCreate.model_validate(data).model_dump()
    values["endpoint"] = validate_endpoint(values["provider"], values["endpoint"])
    return _public_connection(store.create_connection(values, actor_id))


def patch_connection(id, data, expected_revision, actor_id):
    from crate.api.schemas.ai_agents import ConnectionPatch

    values = ConnectionPatch.model_validate(
        {**data, "expected_revision": expected_revision}
    ).model_dump(exclude_unset=True)
    values.pop("expected_revision")
    row = _connection(id)
    if row["secret_source"] == "environment":
        _fail("AI_ENVIRONMENT_READ_ONLY", "Environment connections are read only")
    if not values:
        _fail("AI_CONFIGURATION_INVALID", "No connection changes supplied")
    if "endpoint" in values:
        values["endpoint"] = validate_endpoint(row["provider"], values["endpoint"])
    return _public_connection(
        store.update_connection(id, values, expected_revision, actor_id)
    )


def set_credential(id, api_key, expected_revision, actor_id):
    from crate.api.schemas.ai_agents import CredentialWrite

    CredentialWrite.model_validate(
        {"api_key": api_key, "expected_revision": expected_revision}
    )
    try:
        return _public_connection(
            store.swap_connection_credential(id, api_key, expected_revision, actor_id)
        )
    except CredentialSecretError:
        _fail(
            "AI_CREDENTIAL_STORAGE",
            "Explicit valid credential encryption key is required",
        )


def connection_models(id):
    if id.startswith("env:") and id[4:] not in _PROVIDERS:
        _fail("AI_PROVIDER_UNSUPPORTED", "Provider is not supported")
    row = (
        _connection(id)
        if not id.startswith("env:")
        else store.get_connection(_env_id(id[4:]))
    )
    return {
        "models": row["model_catalog"] if row else [],
        "status": row["catalog_status"] if row else "pending",
        "updated_at": row["catalog_updated_at"] if row else None,
        "error_code": row["catalog_error_code"] if row else None,
    }


def register_manual_model(id, model_id, expected_revision):
    row = _connection(id, persist=True)
    pending = model_capabilities(row["provider"], model_id).model_dump(mode="json")
    # A friendly model name or manifest alone is not compatibility evidence.
    pending.update(validated=False, source="pending")
    models = row["model_catalog"]
    if any(m["model_id"] == model_id for m in models) or len(models) >= 500:
        _fail("AI_CONFIGURATION_INVALID", "Model already registered or catalog full")
    return _public_connection(
        store.save_model_catalog(
            row["id"], [*models, pending], row["catalog_status"], expected_revision
        )
    )


def _validate_version(connection, version, action_id=None):
    if not connection["enabled"]:
        _fail("AI_CONNECTION_UNAVAILABLE", "Connection is disabled")
    model = next(
        (
            m
            for m in connection["model_catalog"]
            if m["model_id"] == version["model_id"]
        ),
        None,
    )
    if model is None or model.get("provider") != connection["provider"]:
        _fail("AI_MODEL_UNVALIDATED", "Model is absent from the validated catalog")
    return validate_profile(
        ProfileConfig.model_validate(version.get("config", {})),
        ModelCapabilities.model_validate(model),
        action_id,
    )


def create_profile(data, actor_id):
    from crate.api.schemas.ai_agents import ProfileCreate

    values = ProfileCreate.model_validate(data).model_dump()
    _validate_version(_connection(values["connection_id"]), values)
    return store.create_profile(values, actor_id)


def create_profile_version(id, data, expected_version, actor_id):
    from crate.api.schemas.ai_agents import ProfileVersionCreate

    values = ProfileVersionCreate.model_validate(
        {**data, "expected_version": expected_version}
    ).model_dump()
    values.pop("expected_version")
    _validate_version(_connection(values["connection_id"]), values)
    return store.create_profile_version(id, values, expected_version, actor_id)


def _validate_bindings(data, changes):
    versions = {(v["profile_id"], v["version"]): v for v in data["versions"]}
    connections = {c["id"]: c for c in data["connections"]}
    for change in changes:
        get_action(change["action_id"])
        version = versions.get((change["profile_id"], change["profile_version"]))
        if version is None:
            _fail("AI_PROFILE_UNKNOWN", "Profile version does not exist")
        _validate_legacy_or_normal(
            connections[version["connection_id"]], version, change["action_id"]
        )


def apply_bindings(changes, actor_id):
    from crate.api.schemas.ai_agents import BindingBatch

    values = BindingBatch.model_validate({"changes": changes}).model_dump()["changes"]
    return store.apply_validated_bindings(values, actor_id, _validate_bindings)


def _legacy_contexts(config=None):
    from crate.llm.provider import get_config

    config = config if config is not None else get_config()
    return {action_id: _legacy(action_id, config) for action_id in ACTIONS}


def _review_fingerprint(contexts, data):
    return _hash(
        {
            "legacy": contexts,
            "state_revision": data["state"]["revision"],
            "connections": sorted(
                (c["id"], c["revision"]) for c in data["connections"]
            ),
            "profiles": sorted(
                (p["id"], p["current_version"]) for p in data["profiles"]
            ),
            "bindings": data["bindings"],
            "default_model": data["state"].get("default_model"),
        }
    )


def review_fingerprint():
    return _review_fingerprint(_legacy_contexts(), store.configuration_snapshot())


def activate(expected_revision, actor_id, expected_review_fingerprint):
    contexts = _legacy_contexts()
    if (
        _review_fingerprint(contexts, store.configuration_snapshot())
        != expected_review_fingerprint
    ):
        _fail(
            "AI_CONFIGURATION_CONFLICT",
            "Configuration changed; reload and review",
        )
    result = store.activate_legacy_configuration(
        expected_revision,
        actor_id,
        contexts,
        _validate_legacy_or_normal,
        expected_review_fingerprint,
        review_fingerprint,
    )
    return {k: result[k] for k in ("active", "revision", "activated_at")}


def _assignment_connection(public_id, connections):
    """Resolve a public connection id inside one read snapshot; never persists."""
    if public_id.startswith("env:"):
        provider = public_id[4:]
        if provider not in _PROVIDERS:
            _fail("AI_PROVIDER_UNSUPPORTED", "Provider is not supported")
        row = connections.get(_env_id(provider))
        if row is None:
            _fail("AI_MODEL_UNVALIDATED", "Refresh this provider's models first")
        return row
    try:
        row = connections.get(str(UUID(public_id)))
    except ValueError:
        row = None
    if row is None:
        _fail("AI_CONNECTION_UNKNOWN", "Connection does not exist")
    return row


def _assignment_model(connection, model_id, reasoning):
    if not connection["enabled"]:
        _fail("AI_CONNECTION_UNAVAILABLE", "Connection is disabled")
    if not _has_credential(connection):
        _fail("AI_CREDENTIAL_REQUIRED", "Provider credential is required")
    model = next(
        (m for m in connection["model_catalog"] if m["model_id"] == model_id), None
    )
    if (
        model is None
        or not model.get("validated")
        or model.get("provider") != connection["provider"]
    ):
        _fail("AI_MODEL_UNVALIDATED", "Model is absent from the validated catalog")
    capabilities = ModelCapabilities.model_validate(model)
    require_supported_reasoning(capabilities, reasoning)
    return capabilities


def _outcome(action_id, outcome, reason=None, adjustments=()):
    return {
        "action_id": action_id,
        "outcome": outcome,
        "reason": reason,
        "adjustments": list(adjustments),
    }


def _owned_profile(action_id, binding, profiles, references):
    """A profile is the action's own only if bound to nothing else and labelled for it."""
    profile = profiles.get(binding["profile_id"]) if binding else None
    if (
        profile is None
        or references[profile["id"]] != 1
        or profile["label"] != ACTIONS[action_id].label
    ):
        return None
    return profile


def _plan_assignment(derived, data, contexts, connection, model_id):
    """Return (outcomes, steps) for the targeted actions, in ACTIONS order; no writes."""
    active = data["state"]["active"]
    bindings = {b["action_id"]: b for b in data["bindings"]}
    versions = {(v["profile_id"], v["version"]): v for v in data["versions"]}
    profiles = {p["id"]: p for p in data["profiles"]}
    connections = {c["id"]: c for c in data["connections"]}
    references = Counter(b["profile_id"] for b in data["bindings"])
    outcomes, steps = [], []
    for entry in derived:
        action_id = entry.action_id
        binding = bindings.get(action_id)
        bound = (
            versions.get((binding["profile_id"], binding["profile_version"]))
            if binding
            else None
        )
        step = {
            "action_id": action_id,
            "enabled": binding["enabled"] if binding else True,
            "expected_binding_revision": binding["revision"] if binding else 0,
        }
        if entry.config is not None:
            config = entry.config.model_dump(mode="json")
            fingerprint = store.version_fingerprint(connection["id"], model_id, config)
            target = {
                "connection_id": connection["id"],
                "model_id": model_id,
                "config": config,
            }
            owned = _owned_profile(action_id, binding, profiles, references)
            current = (
                versions.get((owned["id"], owned["current_version"])) if owned else None
            )
            if bound is not None and bound["fingerprint"] == fingerprint:
                outcome = "unchanged"
                step |= {
                    "op": "keep",
                    "profile_id": bound["profile_id"],
                    "version": bound["version"],
                }
            elif owned is None:
                outcome = "applied"
                step |= target | {"op": "create", "label": ACTIONS[action_id].label}
            elif current is not None and current["fingerprint"] == fingerprint:
                outcome = "applied"
                step |= {
                    "op": "reuse",
                    "profile_id": owned["id"],
                    "version": owned["current_version"],
                }
            else:
                outcome = "applied"
                step |= target | {
                    "op": "append",
                    "profile_id": owned["id"],
                    "expected_version": owned["current_version"],
                }
            steps.append(step)
            outcomes.append(_outcome(action_id, outcome, None, entry.adjustments))
            continue
        if active:
            outcomes.append(_outcome(action_id, "kept_current", entry.reason))
            continue
        try:
            if binding is not None:
                if bound is None:
                    _fail("AI_PROFILE_UNKNOWN", "Profile version does not exist")
                _validate_legacy_or_normal(
                    connections[bound["connection_id"]], bound, action_id
                )
                outcome = "kept_current"
                step |= {
                    "op": "keep",
                    "profile_id": bound["profile_id"],
                    "version": bound["version"],
                }
            else:
                context = contexts[action_id]
                if context["provider"] not in _PROVIDERS:
                    _fail("AI_PROVIDER_UNSUPPORTED", "Provider is not supported")
                row = connections.get(_env_id(context["provider"]))
                if row is None:
                    _fail(
                        "AI_MODEL_UNVALIDATED",
                        "Refresh the inherited provider's models first",
                    )
                _validate_legacy_or_normal(row, context, action_id)
                outcome = "kept_legacy"
                step |= {"op": "legacy", "legacy_context": context}
        except AIConfigurationError as error:
            outcomes.append(_outcome(action_id, "blocked", error.code))
            continue
        steps.append(step)
        outcomes.append(_outcome(action_id, outcome, entry.reason))
    return outcomes, steps


def assign_model(data, actor_id, *, action_ids=None, make_default=True):
    """Use one validated model for every compatible target action in one reviewed write.

    Reads only the cached catalog: no provider or discovery request. Before activation
    the same transaction activates, and incompatible actions keep their legacy snapshot.
    """
    from crate.api.schemas.ai_agents import ModelAssignment

    request = ModelAssignment.model_validate(data)
    for action_id in action_ids or ():
        get_action(action_id)
    current = store.configuration_snapshot()
    contexts = _legacy_contexts()
    fingerprint = _review_fingerprint(contexts, current)
    if (
        current["state"]["revision"] != request.expected_revision
        or fingerprint != request.expected_review_fingerprint
    ):
        _fail("AI_CONFIGURATION_CONFLICT", "Configuration changed; reload and review")
    active = current["state"]["active"]
    if action_ids is not None and not active:
        _fail("AI_CONFIGURATION_INVALID", "Choose a default model first")
    connection = _assignment_connection(
        request.connection_id, {c["id"]: c for c in current["connections"]}
    )
    capabilities = _assignment_model(connection, request.model_id, request.reasoning)
    derived = derive_all(capabilities, request.reasoning, action_ids)
    if all(entry.config is None for entry in derived):
        _fail("AI_MODEL_INCOMPATIBLE", "This model cannot run any of these features")
    outcomes, steps = _plan_assignment(
        derived, current, contexts, connection, request.model_id
    )
    if request.dry_run:
        return {
            "dry_run": True,
            "activation": not active,
            "revision": current["state"]["revision"],
            "review_fingerprint": fingerprint,
            "outcomes": outcomes,
        }
    if any(outcome["outcome"] == "blocked" for outcome in outcomes):
        _fail(
            "AI_SETUP_BLOCKED",
            "A feature can keep neither this model nor its inherited setup",
        )
    result = store.apply_model_assignment(
        steps,
        default_model={
            "connection_id": connection["id"],
            "model_id": request.model_id,
            "reasoning": request.reasoning.model_dump(mode="json"),
        }
        if make_default
        else None,
        expected_revision=request.expected_revision,
        expected_review_fingerprint=request.expected_review_fingerprint,
        review_fingerprint=lambda locked: _review_fingerprint(
            _legacy_contexts(), locked
        ),
        validate_legacy=_validate_legacy_or_normal,
        validate_bindings=_validate_bindings,
        actor_id=actor_id,
    )
    return {
        "dry_run": False,
        "activation": result["activated"],
        "revision": result["revision"],
        "review_fingerprint": review_fingerprint(),
        "outcomes": outcomes,
    }


def _validate_legacy_or_normal(connection, version, action_id):
    config = version.get("config")
    if config is None and connection["endpoint"] != version["endpoint"]:
        _fail("AI_CONTEXT_STALE", "Refresh the catalog for the reviewed endpoint")
    if config is not None and config.get("kind") != "legacy_snapshot":
        return _validate_version(connection, version, action_id)
    if config is not None:
        legacy = LegacyProfileConfig.model_validate(config)
        if legacy.action_id != action_id:
            _fail(
                "AI_PROFILE_INCOMPATIBLE",
                "Legacy snapshot is restricted to its original action",
            )
    model = next(
        (
            m
            for m in connection["model_catalog"]
            if m["model_id"] == version["model_id"]
        ),
        None,
    )
    if (
        connection["provider"] not in _PROVIDERS
        or not connection["enabled"]
        or model is None
    ):
        _fail(
            "AI_MODEL_UNVALIDATED",
            "Refresh and validate the inherited model catalog before activation",
        )
    if (
        connection["secret_source"] == "environment"
        and connection["provider"] != "ollama"
        and not _environment_key(connection["provider"])
    ):
        _fail("AI_CREDENTIAL_REQUIRED", "Provider credential is required")
    caps = ModelCapabilities.model_validate(model)
    if (
        caps.provider != connection["provider"]
        or not caps.validated
        or not caps.structured_output
        or "text" not in caps.input_modalities
        or (
            get_action(action_id).input == "image"
            and "image" not in caps.input_modalities
        )
    ):
        _fail(
            "AI_PROFILE_INCOMPATIBLE",
            "Inherited model is incompatible with this action",
        )
    if (config or version).get("legacy_deadline_seconds") is None:
        _fail("AI_LEGACY_LIMITS_UNKNOWN", "Inherited native timeout is unknown")
    options = (
        config["legacy_options"] if config is not None else version["legacy_options"]
    )
    if caps.context_window is None or (
        options["max_tokens"] is None and caps.max_output_tokens is None
    ):
        _fail(
            "AI_LEGACY_LIMITS_UNKNOWN",
            "Create a bounded profile before activating an inherited model with unknown limits",
        )
    if options["image_detail"] not in caps.image_details:
        _fail("AI_PROFILE_INCOMPATIBLE", "Inherited image detail is incompatible")
    return LegacyProfileConfig.model_validate(config) if config is not None else None


def _legacy(action_id, config=None):
    from crate.llm.provider import (
        get_config,
        get_provider_api_key,
        legacy_native_timeout,
    )

    config = config if config is not None else get_config()
    model = config["model"]
    provider = config["provider"]
    aliases = {"ollama_chat": "ollama"}
    provider = str(aliases.get(provider, provider))
    action = get_action(action_id)
    shows = action_id.startswith("shows.")
    options = {
        "timeout_seconds": (90 if action.input == "image" else 45) if shows else None,
        "max_tokens": 16000 if shows else None,
        "image_detail": "ultra_high"
        if action_id == "shows.extract.vision" and model.startswith("gemini/gemini-3")
        else "default",
    }
    native_timeout, compatibility_error = legacy_native_timeout(
        model, image=action.input == "image"
    )
    effective_timeout = options["timeout_seconds"] or native_timeout
    deadline_seconds = (
        float(effective_timeout) if effective_timeout is not None else None
    )
    key = (
        _environment_key(provider)
        if provider in _PROVIDERS
        else get_provider_api_key(provider)
    )
    return {
        "mode": "legacy",
        "invocation_kind": "action",
        "action_id": action_id,
        "provider": provider,
        "connection_id": _env_id(provider),
        "model_id": model.split("/", 1)[-1],
        "legacy_model": model,
        "endpoint": config["ollama_url"] if provider == "ollama" else None,
        "legacy_options": options,
        "legacy_deadline_seconds": deadline_seconds,
        "legacy_compatibility_error": compatibility_error,
        "credential_source": "environment",
        "credential_ref": None,
        "credential_version": _hash(key),
        "revision": 0,
    }


def _context(version, connection, *, action_id=None, binding=None):
    config = (
        _validate_legacy_or_normal(connection, version, action_id)
        if version["config"].get("kind") == "legacy_snapshot"
        else _validate_version(connection, version, action_id)
    )
    assert config is not None
    source = connection["secret_source"]
    if source == "environment":
        key = _environment_key(connection["provider"])
    elif source == "stored":
        try:
            key = load_secret(connection["secret_ref"], scope="ai")["api_key"]
        except (CredentialSecretError, KeyError):
            _fail("AI_CREDENTIAL_UNAVAILABLE", "Credential is unavailable")
    else:
        key = None
    if connection["provider"] != "ollama" and not key:
        _fail("AI_CREDENTIAL_REQUIRED", "Provider credential is required")
    model = next(
        m for m in connection["model_catalog"] if m["model_id"] == version["model_id"]
    )
    capabilities = ModelCapabilities.model_validate(model)
    reservation_bounds = None
    if isinstance(config, LegacyProfileConfig):
        reservation_bounds = {
            "input_tokens": model["context_window"],
            "output_tokens": config.legacy_options.max_tokens
            or model["max_output_tokens"],
        }
    return {
        "mode": "configured",
        "reservation_bounds": reservation_bounds,
        "image_token_bound": image_token_bound(capabilities),
        "native_context_window": capabilities.context_window,
        "invocation_kind": "action" if action_id else "probe",
        "action_id": action_id,
        "connection_id": connection["id"],
        "connection_revision": connection["revision"],
        "provider": connection["provider"],
        "endpoint": connection["endpoint"],
        "model_id": version["model_id"],
        "profile_id": version["profile_id"],
        "profile_version": version["version"],
        "config": config.model_dump(mode="json"),
        "profile_fingerprint": version["fingerprint"],
        "binding_revision": binding["revision"] if binding else None,
        "credential_source": source,
        "credential_ref": connection.get("secret_ref"),
        "credential_version": _hash(key),
    }


def resolve_profile(id, version):
    row = store.get_profile_version(id, version)
    if row is None:
        _fail("AI_PROFILE_UNKNOWN", "Profile version does not exist")
    if row["config"].get("kind") == "legacy_snapshot":
        _fail(
            "AI_PROFILE_INCOMPATIBLE",
            "Create a bounded editable version before synthetic testing",
        )
    context = _context(row, _connection(row["connection_id"]))
    context["config_fingerprint"] = _hash(context)
    return context


def resolve_action(action_id, expected_fingerprint=None):
    get_action(action_id)
    state = store.configuration_state()
    if not state["active"]:
        context = _legacy(action_id)
        if context["legacy_compatibility_error"]:
            _fail(
                context["legacy_compatibility_error"],
                "Inherited provider requires a compatible installed SDK or a bounded profile",
            )
    else:
        binding = store.get_binding(action_id)
        if not binding or not binding["enabled"]:
            _fail("AI_ACTION_DISABLED", "Action is disabled")
        version = store.get_profile_version(
            binding["profile_id"], binding["profile_version"]
        )
        if version is None:
            _fail("AI_PROFILE_UNKNOWN", "Profile version does not exist")
        context = _context(
            version,
            _connection(version["connection_id"]),
            action_id=action_id,
            binding=binding,
        )
        context["revision"] = state["revision"]
    context["config_fingerprint"] = _hash(context)
    if expected_fingerprint and expected_fingerprint != context["config_fingerprint"]:
        _fail("AI_CONTEXT_STALE", "Configuration changed; review before submitting")
    # Execution acceptance may materialize environment metadata, never the key.
    if context["mode"] == "legacy" and context["provider"] in _PROVIDERS:
        ensure_environment_connection(context["provider"])
    return context


def revalidate_context(context):
    if context["invocation_kind"] == "probe":
        current = resolve_profile(context["profile_id"], context["profile_version"])
    elif context["mode"] == "legacy":
        if store.configuration_state()["active"]:
            _fail("AI_CONTEXT_STALE", "Configuration changed before execution")
        current = _legacy(context["action_id"])
        current["config_fingerprint"] = _hash(current)
    else:
        current = resolve_action(context["action_id"])
    if current != context:
        _fail("AI_CONTEXT_STALE", "Configuration changed before execution")


def load_context_key(context):
    revalidate_context(context)
    if context["credential_source"] == "stored":
        try:
            key = load_secret(context["credential_ref"], scope="ai")["api_key"]
        except (CredentialSecretError, KeyError):
            _fail("AI_CREDENTIAL_UNAVAILABLE", "Credential is unavailable")
    elif context["mode"] == "legacy" and context["provider"] not in _PROVIDERS:
        from crate.llm.provider import get_provider_api_key

        key = get_provider_api_key(context["provider"])
    else:
        key = _environment_key(context["provider"])
    if _hash(key) != context["credential_version"]:
        _fail("AI_CONTEXT_STALE", "Credential changed before execution")
    return key


def get_action_configuration(action_id):
    # Read-only preview; accepting execution is the only read-like operation that persists metadata.
    get_action(action_id)
    if not store.configuration_state()["active"]:
        context = _legacy(action_id)
        context["config_fingerprint"] = _hash(context)
    else:
        context = resolve_action(action_id)
    return {k: v for k, v in context.items() if not k.startswith("credential_")} | {
        "status": "legacy" if context["mode"] == "legacy" else "configured"
    }
