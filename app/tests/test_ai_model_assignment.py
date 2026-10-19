"""Default-model persistence, per-feature status and the reviewed assignment operation."""

import json
import threading

import pytest

from crate.ai import configuration as service
from crate.ai.actions import ACTIONS
from crate.ai.capabilities import model_capabilities
from crate.ai.contracts import AIConfigurationError, ReasoningConfig
from crate.ai.default_model import derive_action_config
from crate.api.schemas.ai_agents import ModelAssignmentResult, Snapshot
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


LEVEL_HIGH = {"mode": "level", "level": "high", "budget_tokens": None}
IMAGE_ACTIONS = ("shows.extract.vision", "artwork.hero.analyze")
TEXT_ACTIONS = tuple(a for a in ACTIONS if a not in IMAGE_ACTIONS)


def outcomes_by_action(result):
    return {outcome["action_id"]: outcome for outcome in result["outcomes"]}


def scalar(sql, **params):
    with read_scope() as session:
        return session.execute(text(sql), params).scalar_one()


def audit_count(pattern):
    return scalar("SELECT COUNT(*) FROM audit_log WHERE action LIKE :p", p=pattern)


def bound_version(action_id):
    binding = store.get_binding(action_id)
    return store.get_profile_version(binding["profile_id"], binding["profile_version"])


def activate_legacy():
    before = service.snapshot()
    service.activate(before["revision"], None, before["review_fingerprint"])


def assert_nothing_written():
    assert store.list_profiles() == []
    assert store.list_bindings() == []
    state = store.configuration_state()
    assert state["active"] is False
    assert state["default_model"] is None


def test_first_use_activates_every_feature_with_action_limits(pg_db, monkeypatch):
    env = gemini_environment(monkeypatch, legacy_model="gemini/gemini-3.8-flash")

    result = assign("env:gemini", "gemini-3.8-flash", LEVEL_HIGH)

    assert result["dry_run"] is False
    assert result["activation"] is True
    assert [o["action_id"] for o in result["outcomes"]] == list(ACTIONS)
    assert {o["outcome"] for o in result["outcomes"]} == {"applied"}
    state = store.configuration_state()
    assert state["active"] is True
    assert result["revision"] == state["revision"]
    assert result["review_fingerprint"] == service.snapshot()["review_fingerprint"]
    bindings = store.list_bindings()
    assert len(bindings) == 11
    labels = {p["id"]: p["label"] for p in store.list_profiles()}
    for binding in bindings:
        assert labels[binding["profile_id"]] == ACTIONS[binding["action_id"]].label
    music_paths = bound_config("music_paths.refine")
    assert music_paths["timeout_seconds"] == 8
    assert music_paths["max_output_tokens"] == 4096
    assert bound_config("genres.eq.propose")["max_output_tokens"] == 2048
    assert bound_config("shows.extract.vision")["image_detail"] == "ultra_high"
    assert bound_config("artwork.hero.analyze")["image_detail"] == "default"
    assert state["default_model"] == {
        "connection_id": env["id"],
        "model_id": "gemini-3.8-flash",
        "reasoning": LEVEL_HIGH,
    }
    assert audit_count("ai.configuration.activate") == 1
    assert audit_count("ai.default_model.update") == 1
    ModelAssignmentResult.model_validate(result)


def test_text_only_model_leaves_image_features_on_their_legacy_snapshot(
    pg_db, monkeypatch
):
    gemini_environment(monkeypatch)
    ollama = ollama_text()

    result = assign(ollama["id"], "qwen3:8b")

    outcomes = outcomes_by_action(result)
    for action_id in IMAGE_ACTIONS:
        assert outcomes[action_id]["outcome"] == "kept_legacy"
        assert outcomes[action_id]["reason"] == "AI_ACTION_NEEDS_IMAGE"
    assert (
        service.resolve_action("shows.extract.vision")["config"]["kind"]
        == "legacy_snapshot"
    )
    for action_id in TEXT_ACTIONS:
        assert outcomes[action_id]["outcome"] == "applied"
        version = bound_version(action_id)
        assert version["model_id"] == "qwen3:8b"
        assert version["connection_id"] == ollama["id"]
    assert result["activation"] is True
    assert store.configuration_state()["active"] is True


def test_blocked_legacy_snapshot_rejects_without_writes(pg_db, monkeypatch):
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
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-for-assignment")
    ollama = ollama_text()

    preview = assign(ollama["id"], "qwen3:8b", dry_run=True)

    outcomes = outcomes_by_action(preview)
    for action_id in IMAGE_ACTIONS:
        assert outcomes[action_id]["outcome"] == "blocked"
        assert outcomes[action_id]["reason"] == "AI_MODEL_UNVALIDATED"
    for action_id in TEXT_ACTIONS:
        assert outcomes[action_id]["outcome"] == "applied"
    ModelAssignmentResult.model_validate(preview)
    with pytest.raises(AIConfigurationError) as blocked:
        assign(ollama["id"], "qwen3:8b")
    assert blocked.value.code == "AI_SETUP_BLOCKED"
    assert_nothing_written()
    assert [c["id"] for c in store.list_connections()] == [ollama["id"]]


def test_after_activation_incompatible_features_keep_their_binding(pg_db, monkeypatch):
    gemini_environment(monkeypatch)
    activate_legacy()
    legacy = {b["action_id"]: b for b in store.list_bindings()}
    ollama = ollama_text()

    result = assign(ollama["id"], "qwen3:8b")

    assert result["activation"] is False
    outcomes = outcomes_by_action(result)
    after = {b["action_id"]: b for b in store.list_bindings()}
    for action_id in IMAGE_ACTIONS:
        assert outcomes[action_id]["outcome"] == "kept_current"
        assert outcomes[action_id]["reason"] == "AI_ACTION_NEEDS_IMAGE"
        for key in ("revision", "profile_id", "profile_version"):
            assert after[action_id][key] == legacy[action_id][key]
    for action_id in TEXT_ACTIONS:
        assert outcomes[action_id]["outcome"] == "applied"
        assert after[action_id]["profile_id"] == legacy[action_id]["profile_id"]
        assert after[action_id]["profile_version"] == 2
        version = bound_version(action_id)
        assert version["model_id"] == "qwen3:8b"
        assert version["config"].get("kind") != "legacy_snapshot"


def test_shared_or_operator_named_profiles_are_not_rewritten(pg_db, monkeypatch):
    env = gemini_environment(monkeypatch)
    activate_legacy()
    shared_actions = ("genres.eq.propose", "genres.description.generate")
    operator_action = "genres.taxonomy.propose"
    profiles = {}
    for label in ("Shared", "Operator"):
        profiles[label] = service.create_profile(
            {
                "label": label,
                "connection_id": env["id"],
                "model_id": "gemini-2.5-flash",
                "config": {},
            },
            None,
        )
    service.apply_bindings(
        [
            {
                "action_id": action_id,
                "profile_id": profiles[label]["id"],
                "profile_version": 1,
                "enabled": True,
                "expected_revision": store.get_binding(action_id)["revision"],
            }
            for action_id, label in (
                *((a, "Shared") for a in shared_actions),
                (operator_action, "Operator"),
            )
        ],
        None,
    )

    assign("env:gemini", "gemini-3.8-flash", LEVEL_HIGH)

    current = {p["id"]: p for p in store.list_profiles()}
    for label in ("Shared", "Operator"):
        assert current[profiles[label]["id"]]["current_version"] == 1
    for action_id in (*shared_actions, operator_action):
        binding = store.get_binding(action_id)
        assert binding["profile_id"] not in {p["id"] for p in profiles.values()}
        assert current[binding["profile_id"]]["label"] == ACTIONS[action_id].label
        assert binding["profile_version"] == 1


def test_reapplying_the_same_default_changes_nothing(pg_db, monkeypatch):
    gemini_environment(monkeypatch, legacy_model="gemini/gemini-3.8-flash")
    assign("env:gemini", "gemini-3.8-flash", LEVEL_HIGH)
    versions = scalar("SELECT COUNT(*) FROM ai_profile_versions")
    revisions = {b["action_id"]: b["revision"] for b in store.list_bindings()}
    audits = audit_count("ai.%")

    again = assign("env:gemini", "gemini-3.8-flash", LEVEL_HIGH)

    assert again["activation"] is False
    assert len(again["outcomes"]) == 11
    assert {o["outcome"] for o in again["outcomes"]} == {"unchanged"}
    assert scalar("SELECT COUNT(*) FROM ai_profile_versions") == versions
    assert {b["action_id"]: b["revision"] for b in store.list_bindings()} == revisions
    assert audit_count("ai.%") == audits


def test_stale_review_is_rejected_without_writes(pg_db, monkeypatch):
    gemini_environment(monkeypatch)
    ollama = ollama_text()
    reviewed = service.snapshot()
    store.update_connection(ollama["id"], {"daily_calls": 5}, ollama["revision"], None)

    with pytest.raises(AIConfigurationError) as stale:
        assign(ollama["id"], "qwen3:8b", snapshot=reviewed)
    assert stale.value.code == "AI_CONFIGURATION_CONFLICT"
    assert_nothing_written()

    fresh = service.snapshot()
    with pytest.raises(AIConfigurationError) as ahead:
        assign(
            ollama["id"],
            "qwen3:8b",
            snapshot={**fresh, "revision": fresh["revision"] + 1},
        )
    assert ahead.value.code == "AI_CONFIGURATION_CONFLICT"
    assert_nothing_written()


def test_review_is_rechecked_under_the_lock(pg_db, monkeypatch):
    gemini_environment(monkeypatch)
    ollama = ollama_text()
    apply = store.apply_model_assignment

    def change_then_apply(*args, **kwargs):
        # A write that lands after the pre-check but before the lock is taken.
        store.update_connection(
            ollama["id"], {"daily_calls": 7}, ollama["revision"], None
        )
        return apply(*args, **kwargs)

    monkeypatch.setattr(store, "apply_model_assignment", change_then_apply)

    with pytest.raises(AIConfigurationError) as stale:
        assign(ollama["id"], "qwen3:8b")
    assert stale.value.code == "AI_CONFIGURATION_CONFLICT"
    assert_nothing_written()


def test_concurrent_assignments_have_one_winner(pg_db, monkeypatch):
    gemini_environment(monkeypatch)
    reviewed = service.snapshot()
    barrier = threading.Barrier(2)
    results = {}

    def run(model_id):
        barrier.wait()
        try:
            results[model_id] = assign("env:gemini", model_id, snapshot=reviewed)
        except Exception as error:  # noqa: BLE001 - reported by the assertions below
            results[model_id] = error

    threads = [
        threading.Thread(target=run, args=(model_id,))
        for model_id in ("gemini-3.8-flash", "gemini-2.5-flash")
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    winners = [m for m, r in results.items() if isinstance(r, dict)]
    losers = [r for r in results.values() if not isinstance(r, dict)]
    assert len(winners) == 1, results
    assert len(losers) == 1, results
    assert isinstance(losers[0], AIConfigurationError), losers
    assert losers[0].code == "AI_CONFIGURATION_CONFLICT"
    winner = winners[0]
    assert store.configuration_state()["default_model"]["model_id"] == winner
    bindings = store.list_bindings()
    assert len(bindings) == 11
    for binding in bindings:
        version = store.get_profile_version(
            binding["profile_id"], binding["profile_version"]
        )
        assert version["model_id"] == winner
    assert len(store.list_profiles()) == 11
    assert audit_count("ai.configuration.activate") == 1
    assert audit_count("ai.default_model.update") == 1


def test_dry_run_reports_outcomes_without_writing(pg_db, monkeypatch):
    gemini_environment(monkeypatch)
    ollama = ollama_text()
    reviewed = service.snapshot()

    def observed():
        return (
            store.list_profiles(),
            store.list_bindings(),
            store.configuration_state(),
            store.list_connections(),
            service.snapshot()["review_fingerprint"],
            audit_count("ai.%"),
        )

    before = observed()
    preview = assign(ollama["id"], "qwen3:8b", snapshot=reviewed, dry_run=True)

    assert preview["dry_run"] is True
    assert preview["activation"] is True
    assert preview["revision"] == reviewed["revision"]
    assert preview["review_fingerprint"] == reviewed["review_fingerprint"]
    outcomes = outcomes_by_action(preview)
    assert {outcomes[a]["outcome"] for a in IMAGE_ACTIONS} == {"kept_legacy"}
    assert {outcomes[a]["outcome"] for a in TEXT_ACTIONS} == {"applied"}
    assert observed() == before


def test_connection_must_be_usable(pg_db, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    gemini_environment(
        monkeypatch,
        models=("gemini-3.8-flash", "gemini-2.5-flash", "gemini-pending"),
    )
    disabled = ollama_text()
    store.update_connection(
        disabled["id"], {"enabled": False}, disabled["revision"], None
    )
    keyless = service.create_connection({"label": "Gemini", "provider": "gemini"}, None)
    store.save_model_catalog(
        keyless["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        keyless["revision"],
    )
    cases = (
        (disabled["id"], "qwen3:8b", "AI_CONNECTION_UNAVAILABLE"),
        (keyless["id"], "gemini-2.5-flash", "AI_CREDENTIAL_REQUIRED"),
        ("env:gemini", "gemini-unknown", "AI_MODEL_UNVALIDATED"),
        ("env:gemini", "gemini-pending", "AI_MODEL_UNVALIDATED"),
        ("env:deepseek", "deepseek-chat", "AI_MODEL_UNVALIDATED"),
    )
    for connection_id, model_id, code in cases:
        with pytest.raises(AIConfigurationError) as error:
            assign(connection_id, model_id)
        assert error.value.code == code, (connection_id, model_id)
    assert_nothing_written()
    persisted = {c["id"] for c in store.list_connections()}
    assert service._env_id("deepseek") not in persisted


def test_feature_override_changes_only_that_feature(pg_db, monkeypatch):
    gemini_environment(monkeypatch, legacy_model="gemini/gemini-3.8-flash")
    assign("env:gemini", "gemini-3.8-flash", LEVEL_HIGH)
    default_model = store.configuration_state()["default_model"]
    ollama = ollama_text()
    feature = "playlists.description.generate"
    before = {b["action_id"]: b for b in store.list_bindings()}

    result = assign(ollama["id"], "qwen3:8b", action_ids=[feature], make_default=False)

    assert result["activation"] is False
    assert [(o["action_id"], o["outcome"]) for o in result["outcomes"]] == [
        (feature, "applied")
    ]
    after = {b["action_id"]: b for b in store.list_bindings()}
    for action_id in ACTIONS:
        expected = before[action_id]["revision"] + (action_id == feature)
        assert after[action_id]["revision"] == expected
    assert bound_version(feature)["model_id"] == "qwen3:8b"
    assert store.configuration_state()["default_model"] == default_model

    def status():
        features = service.snapshot()["default_model"]["features"]
        return next(f["status"] for f in features if f["action_id"] == feature)

    assert status() == "override"

    assign(
        "env:gemini",
        "gemini-3.8-flash",
        LEVEL_HIGH,
        action_ids=[feature],
        make_default=False,
    )

    assert status() == "default"
    assert store.configuration_state()["default_model"] == default_model


def test_subset_assignment_requires_setup(pg_db, monkeypatch):
    gemini_environment(monkeypatch)

    with pytest.raises(AIConfigurationError) as error:
        assign(
            "env:gemini",
            "gemini-3.8-flash",
            action_ids=["genres.eq.propose"],
            make_default=False,
        )

    assert error.value.code == "AI_CONFIGURATION_INVALID"
    assert_nothing_written()


def test_assignment_never_contacts_a_provider(pg_db, monkeypatch):
    from crate.ai import discovery, transport

    monkeypatch.setattr(
        transport, "generate", lambda *a, **k: pytest.fail("provider call")
    )
    monkeypatch.setattr(
        discovery, "discover_models", lambda *a, **k: pytest.fail("discovery call")
    )
    gemini_environment(monkeypatch)
    ollama = ollama_text()

    preview = assign(ollama["id"], "qwen3:8b", dry_run=True)
    result = assign(ollama["id"], "qwen3:8b")

    assert preview["activation"] is True
    assert result["activation"] is True
    assert store.configuration_state()["active"] is True


def write_counts():
    return (
        scalar("SELECT COUNT(*) FROM ai_profiles"),
        scalar("SELECT COUNT(*) FROM ai_profile_versions"),
        tuple(
            (b["action_id"], b["revision"], b["profile_id"], b["profile_version"])
            for b in store.list_bindings()
        ),
        store.configuration_state(),
        audit_count("ai.%"),
    )


def bind(action_id, profile_id, version=1):
    binding = store.get_binding(action_id)
    service.apply_bindings(
        [
            {
                "action_id": action_id,
                "profile_id": profile_id,
                "profile_version": version,
                "enabled": True,
                "expected_revision": binding["revision"] if binding else 0,
            }
        ],
        None,
    )


def test_model_that_runs_no_target_feature_is_rejected_without_writes(
    pg_db, monkeypatch
):
    gemini_environment(monkeypatch)
    activate_legacy()
    text_only = ollama_text()
    tiny = ollama_text(context=6000)
    before = write_counts()

    with pytest.raises(AIConfigurationError) as image_only:
        assign(
            text_only["id"],
            "qwen3:8b",
            action_ids=["shows.extract.vision"],
            make_default=False,
        )
    assert image_only.value.code == "AI_MODEL_INCOMPATIBLE"
    with pytest.raises(AIConfigurationError) as too_small:
        assign(tiny["id"], "qwen3:8b")
    assert too_small.value.code == "AI_MODEL_INCOMPATIBLE"
    assert write_counts() == before


def test_owned_profile_with_the_target_as_current_version_is_reused(pg_db, monkeypatch):
    gemini_environment(monkeypatch, legacy_model="gemini/gemini-3.8-flash")
    assign("env:gemini", "gemini-3.8-flash", LEVEL_HIGH)
    feature = "playlists.description.generate"
    ollama = ollama_text()
    assign(ollama["id"], "qwen3:8b", action_ids=[feature], make_default=False)
    profile_id = store.get_binding(feature)["profile_id"]
    # Point the feature back at its first version; version 2 stays current.
    bind(feature, profile_id, 1)
    versions = scalar("SELECT COUNT(*) FROM ai_profile_versions")

    result = assign(ollama["id"], "qwen3:8b", action_ids=[feature], make_default=False)

    assert [(o["action_id"], o["outcome"]) for o in result["outcomes"]] == [
        (feature, "applied")
    ]
    binding = store.get_binding(feature)
    assert (binding["profile_id"], binding["profile_version"]) == (profile_id, 2)
    assert scalar("SELECT COUNT(*) FROM ai_profile_versions") == versions
    current = {p["id"]: p for p in store.list_profiles()}[profile_id]
    assert current["current_version"] == 2


def test_pre_activation_bound_incompatible_feature_keeps_a_valid_binding(
    pg_db, monkeypatch
):
    env = gemini_environment(monkeypatch)
    vision = service.create_profile(
        {
            "label": "Poster reader",
            "connection_id": env["id"],
            "model_id": "gemini-3.8-flash",
            "config": {},
        },
        None,
    )
    bind("shows.extract.vision", vision["id"])
    ollama = ollama_text()

    result = assign(ollama["id"], "qwen3:8b")

    assert result["activation"] is True
    outcomes = outcomes_by_action(result)
    assert outcomes["shows.extract.vision"]["outcome"] == "kept_current"
    assert outcomes["shows.extract.vision"]["reason"] == "AI_ACTION_NEEDS_IMAGE"
    assert outcomes["artwork.hero.analyze"]["outcome"] == "kept_legacy"
    binding = store.get_binding("shows.extract.vision")
    assert (binding["profile_id"], binding["profile_version"]) == (vision["id"], 1)
    assert store.configuration_state()["active"] is True


def test_pre_activation_bound_incompatible_feature_blocks_an_invalid_binding(
    pg_db, monkeypatch
):
    gemini_environment(monkeypatch)
    operator = service.create_connection(
        {"label": "Gemini", "provider": "gemini"}, None
    )
    operator = store.save_model_catalog(
        operator["id"],
        [model_capabilities("gemini", "gemini-3.8-flash").model_dump(mode="json")],
        "ready",
        operator["revision"],
    )
    vision = service.create_profile(
        {
            "label": "Poster reader",
            "connection_id": operator["id"],
            "model_id": "gemini-3.8-flash",
            "config": {},
        },
        None,
    )
    bind("shows.extract.vision", vision["id"])
    store.update_connection(
        operator["id"], {"enabled": False}, operator["revision"], None
    )
    ollama = ollama_text()
    before = write_counts()

    preview = assign(ollama["id"], "qwen3:8b", dry_run=True)

    outcomes = outcomes_by_action(preview)
    assert outcomes["shows.extract.vision"]["outcome"] == "blocked"
    assert outcomes["shows.extract.vision"]["reason"] == "AI_CONNECTION_UNAVAILABLE"
    assert outcomes["artwork.hero.analyze"]["outcome"] == "kept_legacy"
    with pytest.raises(AIConfigurationError) as blocked:
        assign(ollama["id"], "qwen3:8b")
    assert blocked.value.code == "AI_SETUP_BLOCKED"
    assert write_counts() == before


def test_unsupported_legacy_provider_blocks_unbound_image_features(pg_db, monkeypatch):
    from crate.llm import provider

    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {
            "model": "openai/gpt-4o",
            "provider": "openai",
            "ollama_url": "http://ollama:11434",
        },
    )
    ollama = ollama_text()

    preview = assign(ollama["id"], "qwen3:8b", dry_run=True)

    outcomes = outcomes_by_action(preview)
    for action_id in IMAGE_ACTIONS:
        assert outcomes[action_id]["outcome"] == "blocked"
        assert outcomes[action_id]["reason"] == "AI_PROVIDER_UNSUPPORTED"
    assert {outcomes[a]["outcome"] for a in TEXT_ACTIONS} == {"applied"}
    with pytest.raises(AIConfigurationError) as blocked:
        assign(ollama["id"], "qwen3:8b")
    assert blocked.value.code == "AI_SETUP_BLOCKED"
    assert_nothing_written()


def test_apply_model_assignment_rejects_an_unknown_op_without_writes(pg_db):
    ollama = ollama_text()
    state = store.configuration_state()
    valid = {
        "action_id": "genres.eq.propose",
        "op": "create",
        "enabled": True,
        "expected_binding_revision": 0,
        "label": ACTIONS["genres.eq.propose"].label,
        "connection_id": ollama["id"],
        "model_id": "qwen3:8b",
        "config": {},
    }
    unknown = {
        "action_id": "genres.taxonomy.propose",
        "op": "drop",
        "enabled": True,
        "expected_binding_revision": 0,
    }

    def never(*args):
        pytest.fail("callback reached before the steps were checked")

    with pytest.raises(AIConfigurationError) as error:
        store.apply_model_assignment(
            [valid, unknown],
            default_model={
                "connection_id": ollama["id"],
                "model_id": "qwen3:8b",
                "reasoning": ReasoningConfig().model_dump(mode="json"),
            },
            expected_revision=state["revision"],
            expected_review_fingerprint="a" * 64,
            review_fingerprint=never,
            validate_legacy=never,
            validate_bindings=never,
            actor_id=None,
        )
    assert error.value.code == "AI_CONFIGURATION_INVALID"
    assert_nothing_written()


def stored_default(connection_id, model_id, reasoning=None):
    store.set_default_model(
        {
            "connection_id": connection_id,
            "model_id": model_id,
            "reasoning": reasoning or ReasoningConfig().model_dump(mode="json"),
        },
        None,
    )


def test_snapshot_rejects_a_catalog_entry_from_another_provider(pg_db):
    conn = service.create_connection(
        {"label": "Local", "provider": "ollama", "endpoint": "http://ollama:11434"},
        None,
    )
    foreign = model_capabilities("gemini", "gemini-3.8-flash").model_dump(mode="json")
    store.save_model_catalog(conn["id"], [foreign], "ready", conn["revision"])
    stored_default(conn["id"], "gemini-3.8-flash")

    default_model = service.snapshot()["default_model"]

    assert default_model["available"] is False
    assert default_model["error_code"] == "AI_MODEL_UNVALIDATED"
    assert default_model["features"] == []
    current = service.snapshot()
    with pytest.raises(AIConfigurationError) as error:
        assign(conn["id"], "gemini-3.8-flash", snapshot=current)
    assert error.value.code == "AI_MODEL_UNVALIDATED"


def test_snapshot_reports_reasoning_that_is_no_longer_native(pg_db):
    ollama = ollama_text()
    stored_default(
        ollama["id"],
        "qwen3:8b",
        {"mode": "level", "level": "high", "budget_tokens": None},
    )

    result = service.snapshot()

    default_model = result["default_model"]
    assert default_model["available"] is False
    assert default_model["error_code"] == "AI_PROFILE_INCOMPATIBLE"
    assert default_model["features"] == []
    Snapshot.model_validate(result)


def test_malformed_stored_default_reads_as_unavailable(test_app, pg_db):
    from crate.db.tx import transaction_scope

    ollama = ollama_text()
    malformed = (
        {"connection_id": "not-a-uuid", "model_id": "qwen3:8b", "reasoning": {}},
        {},
        {"connection_id": 7, "model_id": ["qwen3:8b"], "reasoning": "high"},
        {
            "connection_id": ollama["id"],
            "model_id": "qwen3:8b",
            "reasoning": {"mode": "level"},
        },
    )
    for value in malformed:
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE ai_configuration_state SET default_model=CAST(:value AS jsonb) WHERE singleton"
                ),
                {"value": json.dumps(value)},
            )
        assert store.configuration_snapshot()["state"]["default_model"] == value
        store.configuration_snapshot(bounded=True)

        result = service.snapshot()

        default_model = result["default_model"]
        assert default_model["available"] is False, value
        assert default_model["error_code"] == "AI_CONFIGURATION_INVALID", value
        assert default_model["features"] == []
        Snapshot.model_validate(result)
        response = test_app.get("/api/admin/ai/snapshot")
        assert response.status_code == 200, response.text
        assert response.json()["default_model"]["available"] is False


def test_version_fingerprint_is_stable_and_matches_stored_versions(pg_db):
    pinned = "00000000-0000-0000-0000-000000000001"
    legacy = {
        "kind": "legacy_snapshot",
        "action_id": "genres.eq.propose",
        "legacy_model": "gemini/gemini-2.5-flash",
        "legacy_options": {
            "timeout_seconds": None,
            "max_tokens": None,
            "image_detail": "default",
        },
        "legacy_deadline_seconds": 60.0,
    }
    tuned = {
        "reasoning": {"mode": "level", "level": "high"},
        "timeout_seconds": 8,
        "max_output_tokens": 4096,
    }
    # Digests recorded before _version stopped normalising twice; they must not move.
    assert (
        store.version_fingerprint(pinned, "qwen3:8b", {})
        == "c60b66ec2663115cfb1cb1216dd66ca58d6e151bd2c3ca682b90e8bac9d11886"
    )
    assert (
        store.version_fingerprint(pinned, "gemini-3.8-flash", tuned)
        == "44f1e000d739e8e23799172137e37dd0a1633696d764ae5126a911781f776d78"
    )
    assert (
        store.version_fingerprint(pinned, "gemini-2.5-flash", legacy)
        == "b1af350cd6dfba1bd6ceefb0f0ed83730cf3796437c967fd4c32a9590071c5f0"
    )

    ollama = ollama_text()
    for config in ({}, tuned, legacy):
        profile = store.create_profile(
            {
                "label": "Pinned",
                "connection_id": ollama["id"],
                "model_id": "qwen3:8b",
                "config": config,
            },
            None,
        )
        stored = store.get_profile_version(profile["id"], 1)
        assert stored["fingerprint"] == store.version_fingerprint(
            ollama["id"], "qwen3:8b", config
        )
