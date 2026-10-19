"""Catalog and synthetic test workers reject revoked actors and stale contexts."""


def test_revoked_actor_never_discovers(monkeypatch):
    from crate.worker_handlers import ai_configuration as worker
    from crate.ai import discovery

    monkeypatch.setattr(worker, "get_user_by_id", lambda uid: None)
    monkeypatch.setattr(
        discovery,
        "discover_models",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("provider called")),
    )
    assert worker.handle_refresh("job", {"actor_id": 1}, {}) == {
        "status": "failed",
        "error_code": "AI_PERMISSION_REVOKED",
    }


def test_refresh_failure_keeps_last_good_catalog(pg_db, monkeypatch):
    from crate.ai import configuration as service, discovery, operations
    from crate.ai.contracts import AIConfigurationError
    from crate.ai.capabilities import model_capabilities
    from crate.db.repositories import ai_configuration as store
    from crate.worker_handlers import ai_configuration as worker

    conn = service.create_connection({"label": "Test", "provider": "gemini"}, None)
    old = [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")]
    store.save_model_catalog(conn["id"], old, "ready", 1)
    monkeypatch.setattr(worker, "get_user_by_id", lambda uid: {"role": "admin"})
    queued = []
    monkeypatch.setattr(
        operations,
        "create_task_dedup",
        lambda kind, params, **kw: queued.append(params) or "job",
    )
    operations.queue_refresh(conn["id"], 2, 1)

    def fail(*args, **kwargs):
        raise AIConfigurationError("AI_DISCOVERY_FAILED", "Safe failure")

    monkeypatch.setattr(discovery, "discover_models", fail)
    assert worker.handle_refresh("job", queued[0], {}) == {
        "status": "failed",
        "error_code": "AI_DISCOVERY_FAILED",
    }
    row = store.get_connection(conn["id"])
    assert row["model_catalog"] == old
    assert row["catalog_status"] == "error"


def test_queued_probe_context_and_idempotency(pg_db, monkeypatch):
    import sys
    import types
    from crate.ai import configuration as service
    from crate.ai.capabilities import model_capabilities
    from crate.db.repositories import ai_configuration as store, ai_usage as usage
    from crate.worker_handlers import ai_configuration as worker

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    conn = service.ensure_environment_connection("gemini")
    store.save_model_catalog(
        conn["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        1,
    )
    prof = service.create_profile(
        {
            "label": "Test",
            "connection_id": conn["id"],
            "model_id": "gemini-2.5-flash",
            "config": {"timeout_seconds": 80, "max_output_tokens": 1000},
        },
        None,
    )
    context = service.resolve_profile(prof["id"], 1)
    calls = []

    def execute(ctx, **kwargs):
        assert ctx["action_id"] is None and ctx["invocation_kind"] == "probe"
        assert ctx["config"]["timeout_seconds"] == 80
        assert kwargs["api_key"] == "synthetic-key"
        calls.append(kwargs)
        return {"compatible": True, "usage": {"input_tokens": 20, "output_tokens": 10}}

    monkeypatch.setitem(
        sys.modules, "crate.ai.runtime", types.SimpleNamespace(execute_probe=execute)
    )
    monkeypatch.setattr(worker, "get_user_by_id", lambda uid: {"role": "admin"})
    # actor_id None is valid for direct reservation; the worker capability recheck is mocked.
    params = {
        "profile_id": prof["id"],
        "version": 1,
        "fingerprint": context["config_fingerprint"],
        "actor_id": None,
        "idempotency_key": "one-test",
    }
    assert worker.handle_probe("job", params, {}) == {
        "status": "succeeded",
        "compatible": True,
    }
    assert worker.handle_probe("job", params, {}) == {"status": "duplicate"}
    assert len(calls) == 1
    row = usage.list_invocations({"invocation_kind": "probe"})["items"][0]
    assert row["action_id"] is None and row["charged_tokens"] == 30
    monkeypatch.setenv("GEMINI_API_KEY", "replacement-key")
    assert (
        worker.handle_probe("job", {**params, "idempotency_key": "second"}, {})[
            "error_code"
        ]
        == "AI_CONTEXT_STALE"
    )


def test_refresh_is_queued_without_discovery(pg_db, monkeypatch):
    from crate.ai import configuration as service, discovery, operations

    conn = service.create_connection({"label": "Test", "provider": "gemini"}, None)
    monkeypatch.setattr(
        discovery,
        "discover_models",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("HTTP in request")),
    )
    queued = []
    monkeypatch.setattr(
        operations,
        "create_task_dedup",
        lambda kind, params, **kwargs: queued.append((kind, params, kwargs)) or "job",
    )
    assert operations.queue_refresh(conn["id"], 1, 1)["task_id"] == "job"
    assert queued[0][0] == "ai_catalog_refresh"
    assert set(queued[0][1]) == {"actor_id", "connection_id", "fingerprint"}


def test_probe_queue_uses_public_profile_fingerprint(pg_db, monkeypatch):
    from crate.ai import configuration as service, operations
    from crate.ai.capabilities import model_capabilities
    from crate.db.repositories import ai_configuration as store

    monkeypatch.setenv("GEMINI_API_KEY", "key")
    conn = service.ensure_environment_connection("gemini")
    store.save_model_catalog(
        conn["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        1,
    )
    profile = service.create_profile(
        {
            "label": "Test",
            "connection_id": conn["id"],
            "model_id": "gemini-2.5-flash",
            "config": {},
        },
        None,
    )
    version = store.get_profile_version(profile["id"], 1)
    queued = []
    monkeypatch.setattr(
        operations,
        "create_task_dedup",
        lambda kind, params, **kwargs: queued.append(params) or "job",
    )
    result = operations.queue_probe(
        profile["id"], 1, version["fingerprint"], "explicit-key", 1
    )
    assert result["max_timeout_seconds"] == 45
    assert (
        queued[0]["fingerprint"]
        == service.resolve_profile(profile["id"], 1)["config_fingerprint"]
    )
    assert "credential_ref" not in str(queued)


def test_public_job_outcome_never_returns_task_params(monkeypatch):
    from crate.ai import operations

    monkeypatch.setattr(
        operations,
        "get_task",
        lambda id: {
            "id": id,
            "type": "ai_profile_test",
            "status": "failed",
            "params": {"source": "private"},
            "result": {"status": "failed", "error": "private-provider-secret"},
        },
    )
    result = operations.job("job")
    assert result["result"] == {"status": "failed", "error_code": "AI_JOB_FAILED"}
    assert "private" not in str(result)


def test_activity_provider_model_filters_and_bounded_usage(pg_db):
    from crate.ai import operations
    from crate.db.repositories import ai_configuration as store, ai_usage as usage
    from crate.api.schemas.ai_agents import Usage, Activity

    first = store.create_connection({"label": "Gemini", "provider": "gemini"}, None)
    second = store.create_connection(
        {"label": "DeepSeek", "provider": "deepseek"}, None
    )
    for index, conn in enumerate((first, second)):
        context = {
            "invocation_kind": "probe",
            "connection_id": conn["id"],
            "model_id": "model-a" if index == 0 else "model-b",
        }
        row = usage.reserve_invocation(
            context, idempotency_key=f"key-{index}", input_tokens=100, output_tokens=100
        )
        usage.finish_invocation(
            row["id"], {"input_tokens": 10, "output_tokens": 10}, "succeeded"
        )
    activity = operations.activity(
        {"provider": "gemini", "model_id": "model-a"}, 50, None
    )
    Activity.model_validate(activity)
    assert len(activity["items"]) == 1
    assert activity["items"][0]["connection_id"] == first["id"]
    assert (
        operations.activity({"provider": "gemini", "model_id": "model-b"}, 50, None)[
            "items"
        ]
        == []
    )
    summary = usage.usage_summary(daily_limit=1)
    assert summary["totals"]["calls"] == 2
    assert summary["totals"]["tokens"] == 40
    assert summary["truncated"] is True
    assert len(summary["daily"]) == 1
    Usage.model_validate(summary)
