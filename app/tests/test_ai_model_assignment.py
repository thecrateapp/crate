"""Shared fixtures for default-model assignment, plus persistence and status tests.

Task 3 (the transactional assignment operation) reuses the helpers defined here.
"""

from crate.ai import configuration as service
from crate.ai.capabilities import model_capabilities
from crate.ai.contracts import ReasoningConfig
from crate.ai.default_model import derive_action_config
from crate.api.schemas.ai_agents import Snapshot
from crate.db.repositories import ai_configuration as store
from crate.db.tx import read_scope
from sqlalchemy import text


def gemini_environment(
    monkeypatch,
    legacy_model="gemini/gemini-2.5-flash",
    models=("gemini-3.8-flash", "gemini-2.5-flash"),
):
    from crate.llm import provider

    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": legacy_model,
            "provider": "gemini",
            "ollama_url": "http://ollama:11434",
        },
    )
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-for-assignment")
    conn = service.ensure_environment_connection("gemini")
    catalog = [model_capabilities("gemini", m).model_dump(mode="json") for m in models]
    return store.save_model_catalog(conn["id"], catalog, "ready", conn["revision"])


def ollama_text(context=40960):
    conn = service.create_connection(
        {"label": "Local", "provider": "ollama", "endpoint": "http://ollama:11434"},
        None,
    )
    metadata = {
        "capabilities": ["completion"],
        "model_info": {
            "general.architecture": "qwen3",
            "qwen3.context_length": context,
        },
    }
    model = model_capabilities("ollama", "qwen3:8b", metadata).model_dump(mode="json")
    return store.save_model_catalog(conn["id"], [model], "ready", conn["revision"])


def assign(
    connection_id, model_id, reasoning=None, *, snapshot=None, dry_run=False, **kwargs
):
    current = snapshot if snapshot is not None else service.snapshot()
    payload = {
        "connection_id": connection_id,
        "model_id": model_id,
        "expected_revision": current["revision"],
        "expected_review_fingerprint": current["review_fingerprint"],
        "dry_run": dry_run,
    }
    if reasoning is not None:
        payload["reasoning"] = reasoning
    return service.assign_model(payload, None, **kwargs)


def bound_config(action_id):
    binding = store.get_binding(action_id)
    version = store.get_profile_version(
        binding["profile_id"], binding["profile_version"]
    )
    return version["config"]


def test_default_model_is_audited_once_and_changes_the_review(pg_db):
    ollama = ollama_text()
    value = {
        "connection_id": ollama["id"],
        "model_id": "qwen3:8b",
        "reasoning": ReasoningConfig().model_dump(mode="json"),
    }
    before = service.snapshot()["review_fingerprint"]

    assert store.set_default_model(value, None) is True
    assert store.set_default_model(value, None) is False

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT details_json FROM audit_log WHERE action='ai.default_model.update'"
                )
            )
            .mappings()
            .all()
        )
    assert len(rows) == 1
    assert rows[0]["details_json"] == {"revision": 0}
    assert "qwen3:8b" not in str(rows[0])

    after = service.snapshot()["review_fingerprint"]
    assert after != before


def test_snapshot_reports_feature_status_against_the_default(pg_db, monkeypatch):
    gemini_environment(monkeypatch)
    before = service.snapshot()
    service.activate(before["revision"], None, before["review_fingerprint"])

    ollama = ollama_text()
    reasoning = ReasoningConfig()
    assert (
        store.set_default_model(
            {
                "connection_id": ollama["id"],
                "model_id": "qwen3:8b",
                "reasoning": reasoning.model_dump(mode="json"),
            },
            None,
        )
        is True
    )

    capabilities = model_capabilities(
        "ollama",
        "qwen3:8b",
        {
            "capabilities": ["completion"],
            "model_info": {
                "general.architecture": "qwen3",
                "qwen3.context_length": 40960,
            },
        },
    )
    derived = derive_action_config(capabilities, reasoning, "shows.extract.text")
    assert derived.config is not None

    profile = service.create_profile(
        {
            "label": "Default text",
            "connection_id": ollama["id"],
            "model_id": "qwen3:8b",
            "config": derived.config.model_dump(mode="json"),
        },
        None,
    )
    binding = store.get_binding("shows.extract.text")
    service.apply_bindings(
        [
            {
                "action_id": "shows.extract.text",
                "profile_id": profile["id"],
                "profile_version": 1,
                "enabled": True,
                "expected_revision": binding["revision"],
            }
        ],
        None,
    )

    snapshot = service.snapshot()
    default_model = snapshot["default_model"]
    assert default_model["available"] is True
    assert default_model["connection_id"] == ollama["id"]

    by_action = {f["action_id"]: f for f in default_model["features"]}
    assert by_action["shows.extract.text"]["status"] == "default"
    assert by_action["shows.extract.vision"]["status"] == "incompatible"
    assert by_action["shows.extract.vision"]["reason"] == "AI_ACTION_NEEDS_IMAGE"
    assert by_action["genres.eq.propose"]["status"] == "override"

    Snapshot.model_validate(snapshot)


def test_unavailable_default_is_reported_without_raising(pg_db):
    ollama = ollama_text()
    store.set_default_model(
        {
            "connection_id": ollama["id"],
            "model_id": "qwen3:8b",
            "reasoning": ReasoningConfig().model_dump(mode="json"),
        },
        None,
    )
    store.update_connection(ollama["id"], {"enabled": False}, ollama["revision"], None)

    default_model = service.snapshot()["default_model"]
    assert default_model["available"] is False
    assert default_model["error_code"] == "AI_CONNECTION_UNAVAILABLE"
    assert default_model["features"] == []


def test_snapshot_reads_the_default_connection_once(pg_db, monkeypatch):
    from sqlalchemy import event
    from crate.db.engine import get_engine
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
    ollama = ollama_text()
    store.set_default_model(
        {
            "connection_id": ollama["id"],
            "model_id": "qwen3:8b",
            "reasoning": ReasoningConfig().model_dump(mode="json"),
        },
        None,
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
    assert len(statements) == 6
    Snapshot.model_validate(result)
