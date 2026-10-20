"""Real PostgreSQL/API/worker integration; only provider HTTP is deterministic."""

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from crate.ai import configuration, discovery, runtime, transport
from crate.auth import create_jwt
from crate.db.queries.tasks import get_task
from crate.db.repositories import ai_configuration as store, ai_usage as usage
from crate.db.repositories.auth_sessions import create_session
from crate.db.repositories.auth_user_accounts import create_user, get_user_by_id
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from crate.worker_handlers import ai_configuration as ai_worker
from crate.worker_handlers.show_imports import handle_show_extraction

PREFIX = "/api/admin/ai"
MODELS = {
    "gemini": "gemini-3.8-flash",
    "deepseek": "deepseek-test",
    "ollama": "local-test:1",
}
TEXT = "Private Band | 2027-03-02 | Sala Norte | Madrid"
ANSWER = {
    "candidates": [
        {
            "item_id": "provider-row",
            "artist_name": "Private Band",
            "date": "2027-03-02",
            "venue": "Sala Norte",
            "city": "Madrid",
        }
    ],
    "coverage": "complete",
    "warnings": [],
}


@pytest.fixture
def workflow(pg_db, monkeypatch):
    from crate.api.ai_agents import router as ai_router
    from crate.api.show_imports import router as shows_router
    from crate.llm import provider

    monkeypatch.setenv("JWT_SECRET", "ai-workflow-test-only-secret-at-least-32-bytes")
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-legacy-key")
    monkeypatch.setenv("CRATE_MCP_ENABLED", "false")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")
    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": "gemini/gemini-2.5-flash",
            "provider": "gemini",
            "ollama_url": None,
        },
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    monkeypatch.setattr(
        "crate.show_extraction.recognize_image",
        lambda *a, **k: {
            "text": TEXT,
            "engine": "fixture",
            "languages": ["eng"],
            "elapsed_seconds": 0,
            "extractor": "fixture",
            "truncated": False,
        },
    )
    from crate.ai.capabilities import model_capabilities

    inherited = configuration.ensure_environment_connection("gemini")
    store.save_model_catalog(
        inherited["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        inherited["revision"],
    )
    actor = create_user("ai-workflow@example.test", role="admin")
    sid = str(uuid4())
    create_session(
        sid, actor["id"], datetime.now(UTC) + timedelta(days=1), app_id="admin-web"
    )
    app = FastAPI()
    app.include_router(ai_router)
    app.include_router(shows_router)

    @app.middleware("http")
    async def current_test_identity(request, call_next):
        request.state.user = get_user_by_id(actor["id"])
        return await call_next(request)

    with TestClient(app, base_url="http://localhost:8585") as client:
        client.cookies.set(
            "crate_session",
            create_jwt(actor["id"], actor["email"], "admin", session_id=sid),
        )
        client.headers["Origin"] = "http://localhost:5173"
        yield client, actor


def _post(client, path, body):
    response = client.post(path, json=body)
    assert response.status_code in {200, 202}, response.text
    return response.json()


def _configure(workflow, monkeypatch, provider="gemini", *, daily_calls=1000):
    client, actor = workflow
    conn = _post(
        client,
        PREFIX + "/connections",
        {
            "label": "Integration",
            "provider": provider,
            "daily_calls": daily_calls,
            **({"endpoint": "http://127.0.0.1:11434"} if provider == "ollama" else {}),
        },
    )
    if provider != "ollama":
        conn = _post(
            client,
            PREFIX + f"/connections/{conn['id']}/credential",
            {"api_key": "test-only-stored-key", "expected_revision": conn["revision"]},
        )
    catalog_calls = []

    def catalog(actual_provider, endpoint, path, **kwargs):
        assert actual_provider == provider
        catalog_calls.append(path)
        if provider == "gemini":
            return {
                "models": [
                    {
                        "name": "models/" + MODELS[provider],
                        "supportedGenerationMethods": ["generateContent"],
                    }
                ]
            }
        if provider == "deepseek":
            return {
                "data": [
                    {
                        "id": MODELS[provider],
                        "input_modalities": ["text"],
                        "output_modalities": ["text"],
                        "context_window": 32768,
                        "max_output_tokens": 8192,
                        "effort": {
                            "supported_levels": ["low", "high"],
                            "default_level": "low",
                        },
                    }
                ]
            }
        if path == "/api/tags":
            return {"models": [{"name": MODELS[provider]}]}
        assert path == "/api/show"
        return {
            "capabilities": ["completion"],
            "thinking": {"values": [False, True], "default": False},
            "model_info": {
                "general.architecture": "local",
                "local.context_length": 32768,
            },
        }

    monkeypatch.setattr(discovery, "_request_json", catalog)
    assert (
        client.get(PREFIX + f"/connections/{conn['id']}/models").json()["models"] == []
    )
    assert catalog_calls == []
    queued = _post(
        client,
        PREFIX + f"/connections/{conn['id']}/refresh",
        {"expected_revision": conn["revision"]},
    )
    assert catalog_calls == []
    task = get_task(queued["task_id"])
    assert ai_worker.handle_refresh(task["id"], task["params"], {}) == {
        "status": "succeeded",
        "model_count": 1,
    }
    model = client.get(PREFIX + f"/connections/{conn['id']}/models").json()["models"][0]
    assert model["validated"] and model["structured_output"]
    assert model["reasoning_levels"] == (
        []
        if provider == "ollama"
        else ["low", "high"]
        if provider == "deepseek"
        else ["low", "medium", "high"]
    )
    assert model["reasoning_enabled"] is (provider in {"deepseek", "ollama"})
    profile = _post(
        client,
        PREFIX + "/profiles",
        {
            "label": "Native",
            "connection_id": conn["id"],
            "model_id": MODELS[provider],
            "config": {
                "reasoning": {"mode": "enabled"}
                if provider == "ollama"
                else {"mode": "level", "level": "low"},
                "max_input_tokens": 16384,
                "max_output_tokens": 2048,
                "timeout_seconds": 45,
            },
        },
    )
    before = client.get(PREFIX + "/snapshot").json()
    assert not before["migrated"]
    _post(
        client,
        PREFIX + "/activate",
        {
            "expected_revision": before["revision"],
            "expected_review_fingerprint": before["review_fingerprint"],
        },
    )
    changes = [
        {
            "action_id": "shows.extract." + suffix,
            "profile_id": profile["id"],
            "profile_version": 1,
            "expected_revision": 1,
        }
        for suffix in (
            ["text", "vision", "ocr_text"] if provider == "gemini" else ["text"]
        )
    ]
    _post(client, PREFIX + "/bindings", {"changes": changes})
    return conn, profile, changes


def _accept(client, mode, *, key="one-source"):
    selected = client.get("/api/show-imports/availability").json()["actions"][mode]
    uploads = []
    if mode != "text_llm":
        image = (Path(__file__).parent / "fixtures/shows/flyer.png").read_bytes()
        upload = client.post(
            "/api/show-imports/uploads",
            files={"file": ("flyer.png", image, "image/png")},
        )
        assert upload.status_code == 201, upload.text
        uploads = [upload.json()["upload_id"]]
    body = {
        "mode": mode,
        "raw_text": TEXT if mode == "text_llm" else "",
        "upload_ids": uploads,
        "expected_model": selected["model"],
        "expected_configuration": selected["configuration_fingerprint"],
        "idempotency_key": key,
    }
    return _post(client, "/api/show-imports/extractions", body), body


def _native_http(monkeypatch, provider="gemini"):
    calls = []

    def request(**kwargs):
        calls.append(kwargs)
        assert kwargs["provider"] == provider
        body = kwargs["body"]
        text = json.dumps(ANSWER)
        if provider == "gemini":
            assert body["generationConfig"]["thinkingConfig"] == {
                "thinkingLevel": "low"
            }
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "private thoughts", "thought": True},
                                {"text": text},
                            ]
                        }
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 20,
                    "candidatesTokenCount": 10,
                    "thoughtsTokenCount": 5,
                    "cachedContentTokenCount": 4,
                    "totalTokenCount": 35,
                },
                "modelVersion": MODELS[provider],
            }
        if provider == "deepseek":
            assert (
                body["thinking"] == {"type": "enabled"}
                and body["reasoning_effort"] == "low"
            )
            return {
                "choices": [
                    {
                        "message": {
                            "content": text,
                            "reasoning_content": "private thoughts",
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 15,
                    "completion_tokens_details": {"reasoning_tokens": 5},
                    "prompt_cache_hit_tokens": 4,
                    "total_tokens": 35,
                },
                "model": MODELS[provider],
            }
        assert body["think"] is True and body["stream"] is False
        return {
            "message": {"content": text, "thinking": "private thoughts"},
            "prompt_eval_count": 20,
            "eval_count": 15,
            "model": MODELS[provider],
        }

    monkeypatch.setattr(transport, "_request_json", request)
    return calls


@pytest.mark.parametrize("mode", ["vision", "text_llm", "ocr_text_llm"])
def test_accepted_show_modes_preserve_validated_human_actor(
    workflow, monkeypatch, mode
):
    client, actor = workflow
    _configure(workflow, monkeypatch)
    calls = _native_http(monkeypatch)
    actors = []
    execute = runtime.execute_structured

    def capture(*args, **kwargs):
        actors.append(kwargs.get("actor_id"))
        return execute(*args, **kwargs)

    monkeypatch.setattr(runtime, "execute_structured", capture)
    accepted, body = _accept(client, mode)
    assert (
        _post(client, "/api/show-imports/extractions", body)["job_id"]
        == accepted["job_id"]
    )
    start_task(accepted["job_id"])
    result = handle_show_extraction(accepted["job_id"], {}, {})
    assert result["execution"]["status"] == "extracted", result
    assert actors == [actor["id"]]
    row = usage.list_invocations({})["items"][0]
    assert row["actor_id"] == actor["id"] and row["job_id"] == accepted["job_id"]
    assert (
        row["input_tokens"] == 20
        and row["output_tokens"] == 10
        and row["thought_tokens"] == 5
    )
    assert (
        row["cached_input_tokens"] == 4
        and row["charged_tokens"] == 35
        and row["estimated_cost"] is None
    )
    assert handle_show_extraction(accepted["job_id"], {}, {}) == result
    assert len(calls) == 1
    public = str(client.get(PREFIX + "/activity").json()) + str(result)
    assert (
        TEXT not in public
        and "private thoughts" not in public
        and "test-only-stored-key" not in public
    )
    owned_job = client.get("/api/show-imports/jobs/" + accepted["job_id"]).json()
    owned = client.get(
        "/api/show-imports/drafts/" + owned_job["result"]["execution"]["draft_id"]
    ).json()
    assert owned["result"]["candidates"][0]["date"] == "2027-03-02"


@pytest.mark.parametrize("provider", ["deepseek", "ollama"])
def test_native_provider_catalog_to_bound_show_worker(workflow, monkeypatch, provider):
    client, actor = workflow
    conn, _, _ = _configure(workflow, monkeypatch, provider)
    calls = _native_http(monkeypatch, provider)
    accepted, _ = _accept(client, "text_llm")
    start_task(accepted["job_id"])
    assert (
        handle_show_extraction(accepted["job_id"], {}, {})["execution"]["status"]
        == "extracted"
    )
    row = usage.list_invocations({})["items"][0]
    assert row["actor_id"] == actor["id"] and row["connection_id"] == conn["id"]
    assert row["model_id"] == MODELS[provider] and row["charged_tokens"] == 35
    assert row["thought_tokens"] == (None if provider == "ollama" else 5)
    assert len(calls) == 1


@pytest.mark.parametrize("guard", ["binding", "credential", "actor", "quota"])
def test_accepted_work_rechecks_cas_revocation_and_limits(workflow, monkeypatch, guard):
    client, actor = workflow
    conn, _, changes = _configure(
        workflow, monkeypatch, daily_calls=1 if guard == "quota" else 1000
    )
    calls = _native_http(monkeypatch)
    accepted, _ = _accept(client, "text_llm")
    if guard == "binding":
        # One stale row rolls back the complete batch, including the first valid row.
        batch = [
            {**changes[0], "expected_revision": 2, "enabled": False},
            {**changes[1], "expected_revision": 0},
        ]
        assert (
            client.post(PREFIX + "/bindings", json={"changes": batch}).status_code
            == 409
        )
        assert store.get_binding("shows.extract.text")["enabled"]
        _post(client, PREFIX + "/bindings", {"changes": [batch[0]]})
    elif guard == "credential":
        current = store.get_connection(conn["id"])
        _post(
            client,
            PREFIX + f"/connections/{conn['id']}/credential",
            {"api_key": None, "expected_revision": current["revision"]},
        )
    elif guard == "actor":
        set_user_roles(actor["id"], ["user"])
    else:
        first = usage.reserve_invocation(
            configuration.resolve_action("shows.extract.text"),
            idempotency_key="consumed-quota",
            input_tokens=1,
            output_tokens=1,
            actor_id=actor["id"],
        )
        usage.finish_invocation(
            first["id"], {"input_tokens": 1, "output_tokens": 1}, "succeeded"
        )
    start_task(accepted["job_id"])
    result = handle_show_extraction(accepted["job_id"], {}, {})
    assert result["execution"]["status"] == "failed"
    assert calls == []
    assert len(usage.list_invocations({})["items"]) == (1 if guard == "quota" else 0)
