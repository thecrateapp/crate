"""Focused AI administration and immutable invocation context contracts."""

import pytest
from pydantic import ValidationError

from crate.ai.contracts import AIConfigurationError
from crate.db.repositories import ai_configuration as store


def configured():
    from crate.ai.capabilities import model_capabilities
    from crate.ai import configuration as service

    conn = service.create_connection({"label": "Gemini", "provider": "gemini"}, None)
    model = model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")
    store.save_model_catalog(conn["id"], [model], "ready", 1)
    return conn, model


def test_closed_requests_and_secret_refs():
    from crate.api.schemas.ai_agents import ConnectionPatch, ManualModel

    with pytest.raises(ValidationError):
        ConnectionPatch(expected_revision=1, secret_ref="stolen")
    with pytest.raises(ValidationError):
        ManualModel(expected_revision=1, model_id="fake", validated=True)


def test_profile_requires_catalog_and_valid_reasoning(pg_db):
    from crate.ai import configuration as service

    conn, _ = configured()
    data = {
        "label": "Test",
        "connection_id": conn["id"],
        "model_id": "fake",
        "config": {},
    }
    with pytest.raises(AIConfigurationError, match="catalog"):
        service.create_profile(data, None)
    data.update(
        model_id="gemini-2.5-flash",
        config={"reasoning": {"mode": "level", "level": "ultra"}},
    )
    with pytest.raises(AIConfigurationError):
        service.create_profile(data, None)


def test_snapshot_is_read_only_and_batched(pg_db, monkeypatch):
    from crate.ai import configuration as service
    from crate.ai import discovery

    monkeypatch.setattr(
        discovery, "discover_models", lambda *a, **k: pytest.fail("provider read")
    )
    monkeypatch.setenv("GEMINI_API_KEY", "private-key-value")
    result = service.snapshot()
    assert len(result["actions"]) == 11
    assert not result["migrated"]
    assert store.list_connections() == []
    assert "private-key-value" not in str(result)
    assert "secret_ref" not in str(result)


def test_manual_model_is_pending(pg_db):
    from crate.ai import configuration as service

    conn, _ = configured()
    service.register_manual_model(conn["id"], "unknown-model", 2)
    model = store.get_connection(conn["id"])["model_catalog"][-1]
    assert model["validated"] is False
    assert model["source"] == "pending"


def test_probe_context_detects_key_rotation(pg_db, monkeypatch):
    from crate.ai import configuration as service

    conn, _ = configured()
    monkeypatch.setenv("GEMINI_API_KEY", "initial-key")
    # Environment descriptions become persistent metadata only at explicit acceptance.
    env = service.ensure_environment_connection("gemini")
    store.save_model_catalog(
        env["id"],
        store.get_connection(conn["id"])["model_catalog"],
        "ready",
        env["revision"],
    )
    prof = service.create_profile(
        {
            "label": "Probe",
            "connection_id": env["id"],
            "model_id": "gemini-2.5-flash",
            "config": {},
        },
        None,
    )
    context = service.resolve_profile(prof["id"], 1)
    monkeypatch.setenv("GEMINI_API_KEY", "replacement-key")
    with pytest.raises(AIConfigurationError):
        service.revalidate_context(context)


def test_exact_legacy_activation_and_cross_action_rejected(pg_db, monkeypatch):
    from crate.ai import configuration as service
    from crate.llm import provider

    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": "gemini/gemini-2.5-flash",
            "provider": "gemini",
            "ollama_url": "http://ollama:11434",
        },
    )
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-for-activation")
    _, model = configured()
    conn = service.ensure_environment_connection("gemini")
    store.save_model_catalog(conn["id"], [model], "ready", conn["revision"])
    before = service.snapshot()
    assert before["migrated"] is False
    biography = next(
        a for a in before["legacy_actions"] if a["action_id"] == "artists.bio.research"
    )
    assert biography["legacy_options"]["timeout_seconds"] is None
    assert biography["effective_timeout_seconds"] == 60
    result = service.activate(before["revision"], None, before["review_fingerprint"])
    assert result["active"] is True
    assert len(store.list_bindings()) == 11
    context = service.resolve_action("artists.bio.research")
    assert context["config"]["kind"] == "legacy_snapshot"
    assert context["config"]["legacy_options"]["timeout_seconds"] is None
    assert context["config"]["legacy_options"]["max_tokens"] is None
    assert service.resolve_action("shows.extract.text")["config"]["legacy_options"] == {
        "timeout_seconds": 45,
        "max_tokens": 16000,
        "image_detail": "default",
    }
    service.revalidate_context(context)
    binding = store.get_binding("artists.bio.research")
    with pytest.raises(AIConfigurationError, match="original action"):
        service.apply_bindings(
            [
                {
                    "action_id": "genres.eq.propose",
                    "profile_id": binding["profile_id"],
                    "profile_version": 1,
                    "enabled": True,
                    "expected_revision": 1,
                }
            ],
            None,
        )
    with pytest.raises(ValidationError):
        service.create_profile(
            {
                "label": "Forged",
                "connection_id": conn["id"],
                "model_id": model["model_id"],
                "config": context["config"],
            },
            None,
        )


def test_activation_review_detects_global_change(pg_db, monkeypatch):
    from crate.ai import configuration as service
    from crate.llm import provider

    current = {
        "model": "gemini/gemini-2.5-flash",
        "provider": "gemini",
        "ollama_url": "http://ollama:11434",
    }
    monkeypatch.setattr(provider, "get_config", lambda: current.copy())
    before = service.snapshot()
    current["model"] = "gemini/gemini-2.5-pro"
    with pytest.raises(AIConfigurationError):
        service.activate(0, None, before["review_fingerprint"])
    assert not store.configuration_state()["active"]
    assert store.list_profiles() == []


def test_credentials_atomic_swap_and_revocation(pg_db, monkeypatch):
    from cryptography.fernet import Fernet
    from crate.ai import configuration as service
    from crate.credentials import load_secret, CredentialSecretError

    conn, _ = configured()
    monkeypatch.delenv("CRATE_CREDENTIAL_KEY", raising=False)
    with pytest.raises(AIConfigurationError):
        service.set_credential(conn["id"], "first-private-key", 2, None)
    assert store.get_connection(conn["id"], private=True)["secret_ref"] is None
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())
    public = service.set_credential(conn["id"], "first-private-key", 2, None)
    assert "first-private-key" not in str(public) and "secret_ref" not in public
    old = store.get_connection(conn["id"], private=True)["secret_ref"]
    with pytest.raises(AIConfigurationError):
        service.set_credential(conn["id"], "other-key", 2, None)
    assert load_secret(old)["api_key"] == "first-private-key"
    service.set_credential(conn["id"], "second-private-key", 3, None)
    with pytest.raises(CredentialSecretError):
        load_secret(old)


def test_context_stale_binding_and_connection(pg_db, monkeypatch):
    from crate.ai import configuration as service
    from crate.llm import provider

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": "gemini/gemini-2.5-flash",
            "provider": "gemini",
            "ollama_url": None,
        },
    )
    _, model = configured()
    conn = service.ensure_environment_connection("gemini")
    store.save_model_catalog(conn["id"], [model], "ready", 1)
    service.activate(0, None, service.snapshot()["review_fingerprint"])
    context = service.resolve_action("shows.extract.text")
    assert service.load_context_key(context) == "test-key"
    store.update_connection(conn["id"], {"enabled": False}, 2, None)
    with pytest.raises(AIConfigurationError):
        service.revalidate_context(context)


def test_api_guards_openapi_and_closed_payload(test_app, monkeypatch):
    from crate.api import ai_agents as api
    from fastapi import HTTPException

    calls = []

    def guard(request, capability):
        calls.append(capability)
        if capability == "ai.credentials.manage":
            raise HTTPException(403, "Denied")
        return {
            "id": 1,
            "capabilities": ["ai.config.manage", "ai.config.read", "ai.tests.run"],
        }

    monkeypatch.setattr(api, "require_agent_admin_session", guard)
    id = "00000000-0000-0000-0000-000000000001"
    result = test_app.post(
        f"/api/admin/ai/connections/{id}/credential",
        json={"expected_revision": 1, "api_key": "secret"},
    )
    assert result.status_code == 403
    assert calls == ["ai.credentials.manage"]
    assert (
        test_app.patch(
            f"/api/admin/ai/connections/{id}",
            json={"expected_revision": 1, "secret_ref": "spoofed"},
        ).status_code
        == 422
    )
    paths = test_app.app.openapi()["paths"]
    for path, methods in paths.items():
        if not path.startswith("/api/admin/ai/"):
            continue
        for spec in methods.values():
            assert spec["security"]
            assert spec["tags"] == ["agents"]
            assert (
                "$ref"
                in spec["responses"]["200"]["content"]["application/json"]["schema"]
            )


def test_actual_guard_rejects_bearer_mutation(test_app):
    result = test_app.post(
        "/api/admin/ai/connections",
        headers={"Authorization": "Bearer machine"},
        json={"label": "Test", "provider": "gemini"},
    )
    assert result.status_code == 401


def test_api_reads_and_profile_mutations(test_app, pg_db, monkeypatch):
    from crate.api import ai_agents as api
    from crate.ai import configuration as service

    monkeypatch.setattr(
        api,
        "require_agent_admin_session",
        lambda request, cap: {
            "id": None,
            "capabilities": ["ai.config.read", "ai.config.manage"],
        },
    )
    result = test_app.post(
        "/api/admin/ai/connections", json={"label": "Test", "provider": "gemini"}
    )
    assert result.status_code == 200, result.text
    conn = result.json()
    assert test_app.get("/api/admin/ai/snapshot").status_code == 200
    assert (
        test_app.get(f"/api/admin/ai/connections/{conn['id']}/models").json()["models"]
        == []
    )
    assert (
        test_app.patch(
            f"/api/admin/ai/connections/{conn['id']}",
            json={"expected_revision": 1, "label": "Changed"},
        ).status_code
        == 200
    )
    assert service.snapshot()["connections"][0]["label"] == "Changed"
    assert test_app.get("/api/admin/ai/activity").status_code == 200
    assert test_app.get("/api/admin/ai/usage").status_code == 200


def test_validation_does_not_echo_write_only_secret(test_app):
    id = "00000000-0000-0000-0000-000000000001"
    result = test_app.post(
        f"/api/admin/ai/connections/{id}/credential",
        json={"expected_revision": 1, "api_key": "private-key\ninvalid"},
    )
    assert result.status_code == 422
    assert "private-key" not in result.text
    assert result.headers["cache-control"] == "no-store"


def test_profile_version_and_action_preview(pg_db, monkeypatch):
    from crate.ai import configuration as service

    conn, _ = configured()
    monkeypatch.setenv("GEMINI_API_KEY", "key-value")
    prof = service.create_profile(
        {
            "label": "Versioned",
            "connection_id": conn["id"],
            "model_id": "gemini-2.5-flash",
            "config": {},
        },
        None,
    )
    version = service.create_profile_version(
        prof["id"],
        {
            "connection_id": conn["id"],
            "model_id": "gemini-2.5-flash",
            "config": {"max_output_tokens": 999},
        },
        1,
        None,
    )
    assert version["version"] == 2
    assert (
        store.get_profile_version(prof["id"], 1)["config"]["max_output_tokens"] == 2048
    )
    with pytest.raises(AIConfigurationError):
        service.create_profile_version(
            prof["id"],
            {"connection_id": conn["id"], "model_id": "gemini-2.5-flash", "config": {}},
            1,
            None,
        )
    assert service.get_action_configuration("shows.extract.text")["status"] == "legacy"
    assert (
        len(store.list_connections()) == 1
    )  # preview did not materialize env metadata


def test_snapshot_bounds_collections_without_n_plus_one(pg_db, monkeypatch):
    from sqlalchemy import event, text
    from crate.db.engine import get_engine
    from crate.db.tx import transaction_scope
    from crate.ai import configuration as service
    from crate.api.schemas.ai_agents import Snapshot
    from crate.llm import provider

    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": "ollama/model",
            "provider": "ollama",
            "ollama_url": "http://ollama:11434",
        },
    )
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO ai_profiles(label) SELECT 'Profile ' || n FROM generate_series(1,1002) n"
            )
        )
        session.execute(
            text(
                "INSERT INTO ai_provider_connections(label,provider) SELECT 'Connection ' || n,'ollama' FROM generate_series(1,1002) n"
            )
        )
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = service.snapshot()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert result["truncated"] is True
    assert len(result["profiles"]) == 1000
    assert (
        len(result["connections"]) == 1003
    )  # plus three bounded virtual environment entries
    assert len(statements) == 5
    Snapshot.model_validate(result)


def test_probe_capability_requires_read(test_app, monkeypatch):
    from crate.api import ai_agents as api

    monkeypatch.setattr(
        api,
        "require_agent_admin_session",
        lambda request, cap: {"id": 1, "capabilities": ["ai.tests.run"]},
    )
    id = "00000000-0000-0000-0000-000000000001"
    result = test_app.post(
        f"/api/admin/ai/profiles/{id}/versions/1/test",
        json={
            "acknowledged_billable": True,
            "idempotency_key": "test",
            "expected_fingerprint": "a" * 64,
        },
    )
    assert result.status_code == 403


def test_snapshot_metadata_omits_model_catalog(pg_db):
    from crate.ai import configuration as service
    from crate.api.schemas.ai_agents import Snapshot

    conn, _ = configured()
    result = service.snapshot()
    summary = next(c for c in result["connections"] if c["id"] == conn["id"])
    assert summary["model_count"] == 1
    assert "model_catalog" not in summary
    assert len(service.connection_models(conn["id"])["models"]) == 1
    Snapshot.model_validate(result)


def test_endpoint_change_invalidates_old_capabilities(pg_db):
    from crate.ai import configuration as service
    from crate.ai.capabilities import model_capabilities

    conn = service.create_connection(
        {"label": "Local", "provider": "ollama", "endpoint": "http://localhost:11434"},
        None,
    )
    model = model_capabilities(
        "ollama", "model", {"capabilities": ["completion", "vision"]}
    ).model_dump(mode="json")
    store.save_model_catalog(conn["id"], [model], "ready", 1)
    service.patch_connection(
        conn["id"], {"endpoint": "http://localhost:11435"}, 2, None
    )
    row = store.get_connection(conn["id"])
    assert row["model_catalog"] == []
    assert row["catalog_status"] == "pending"


def test_activation_review_detects_reviewed_binding_change(pg_db, monkeypatch):
    from crate.ai import configuration as service
    from crate.llm import provider

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": "gemini/gemini-2.5-flash",
            "provider": "gemini",
            "ollama_url": None,
        },
    )
    conn, _ = configured()
    profile = service.create_profile(
        {
            "label": "Reviewed",
            "connection_id": conn["id"],
            "model_id": "gemini-2.5-flash",
            "config": {},
        },
        None,
    )
    before = service.snapshot()
    service.apply_bindings(
        [
            {
                "action_id": "shows.extract.text",
                "profile_id": profile["id"],
                "profile_version": 1,
                "enabled": False,
                "expected_revision": 0,
            }
        ],
        None,
    )
    with pytest.raises(AIConfigurationError):
        service.activate(0, None, before["review_fingerprint"])
    assert store.configuration_state()["active"] is False


def test_activation_request_uses_whole_screen_review_fingerprint():
    from crate.api.schemas.ai_agents import Activation

    request = Activation(expected_revision=0, expected_review_fingerprint="a" * 64)
    assert request.expected_review_fingerprint == "a" * 64
    with pytest.raises(ValidationError):
        Activation(expected_revision=0, expected_legacy_fingerprint="a" * 64)


def test_effective_ollama_endpoint_refresh_and_activation_pinning(pg_db, monkeypatch):
    from crate.ai import configuration as service
    from crate.ai.capabilities import model_capabilities
    from crate.db.cache_settings import set_setting

    monkeypatch.setenv("OLLAMA_URL", "http://server-a:11434")
    set_setting("llm_model", "ollama/model")
    set_setting("llm_ollama_url", "http://server-b:11434")
    conn = service.ensure_environment_connection("ollama")
    assert conn["endpoint"] == "http://server-b:11434"
    models = [
        model_capabilities(
            "ollama", "model", {"capabilities": ["completion", "vision"]}
        ).model_dump(mode="json")
    ]
    store.save_model_catalog(conn["id"], models, "ready", conn["revision"])
    set_setting("llm_ollama_url", "http://server-c:11434")
    before_read = store.get_connection(conn["id"])
    before = service.snapshot()
    assert store.get_connection(conn["id"]) == before_read
    with pytest.raises(AIConfigurationError):
        service.activate(before["revision"], None, before["review_fingerprint"])
    assert not store.configuration_state()["active"]
    assert store.list_profiles() == []
    assert store.get_connection(conn["id"]) == before_read
    from crate.ai import operations

    queued = []
    monkeypatch.setattr(
        operations,
        "create_task_dedup",
        lambda kind, params, **kwargs: queued.append(params) or "refresh-job",
    )
    assert (
        operations.queue_refresh("env:ollama", before_read["revision"], 1)["task_id"]
        == "refresh-job"
    )
    changed = store.get_connection(conn["id"])
    assert changed["endpoint"] == "http://server-c:11434"
    assert changed["revision"] == before_read["revision"] + 1
    assert changed["model_catalog"] == []
    assert changed["catalog_status"] == "pending"
    store.save_model_catalog(conn["id"], models, "ready", changed["revision"])
    before = service.snapshot()
    service.activate(before["revision"], None, before["review_fingerprint"])
    context = service.resolve_action("shows.extract.text")
    assert context["endpoint"] == "http://server-c:11434"
    set_setting("llm_ollama_url", "http://server-d:11434")
    assert (
        service.ensure_environment_connection("ollama")["endpoint"]
        == "http://server-c:11434"
    )
    service.revalidate_context(context)


def test_generic_ai_retry_requires_dedicated_human_request(test_app, monkeypatch):
    from crate.api import tasks

    monkeypatch.setattr(
        tasks, "_require_task_operator", lambda request: {"id": 2, "role": "ops"}
    )
    monkeypatch.setattr(
        tasks,
        "create_task",
        lambda *args, **kwargs: pytest.fail("AI generic retry enqueued"),
    )
    for kind in ("ai_catalog_refresh", "ai_profile_test"):
        monkeypatch.setattr(
            tasks,
            "get_task",
            lambda id: {
                "id": id,
                "type": kind,
                "status": "failed",
                "params": {"actor_id": 1},
                "actor_user_id": 1,
            },
        )
        response = test_app.post("/api/tasks/retry", json={"task_id": "original"})
        assert response.status_code == 409
