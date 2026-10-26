"""Pinned Music Paths refinement, cache identity and failure boundaries."""

from copy import deepcopy

import pytest

from crate import music_paths_refinement as refinement
from crate.ai import configuration
from crate.ai.contracts import AIConfigurationError
from tests.test_paths_llm_refinement import _track


@pytest.fixture
def path_input():
    tracks = [
        _track(i, title=str(i), artist=f"Artist {i}", genre_slug="rock")
        for i in (1, 2, 3)
    ]
    return dict(
        origin_label="Origin",
        dest_label="Destination",
        origin_type="genre",
        dest_type="genre",
        tracks=tracks,
        candidates_by_genre={
            "rock": [_track(4, title="Better", artist="Other", genre_slug="rock")]
        },
    )


@pytest.fixture
def pinned(monkeypatch):
    context = {
        "mode": "configured",
        "action_id": "music_paths.refine",
        "provider": "ollama",
        "model_id": "selected",
        "profile_id": "p",
        "profile_version": 1,
        "config_fingerprint": "accepted",
        "config": {"timeout_seconds": 8, "max_output_tokens": 4096},
    }
    cache, calls, writes = {}, [], []
    monkeypatch.setattr(
        configuration, "resolve_action", lambda *a, **k: deepcopy(context)
    )

    def revalidate(accepted):
        if accepted != context:
            raise AIConfigurationError("AI_CONTEXT_STALE", "Changed")

    monkeypatch.setattr(configuration, "revalidate_context", revalidate)
    monkeypatch.setattr(refinement, "get_setting", lambda key, default=None: "false")
    monkeypatch.setattr(refinement, "get_cache", lambda key, **k: cache.get(key))

    def store(key, value, **kwargs):
        writes.append((key, kwargs))
        cache[key] = value

    monkeypatch.setattr(refinement, "set_cache", store)

    def generate(action, model, prompt, **kwargs):
        calls.append((action, prompt, kwargs))
        return model(
            replacements=[
                dict(target_track_id=2, replacement_track_id=4, confidence=0.9)
            ]
        )

    monkeypatch.setattr(refinement, "execute_structured", generate)
    return context, cache, calls, writes


def test_configured_action_ignores_legacy_globals_and_reuses_seven_day_cache(
    path_input, pinned
):
    _, _, calls, writes = pinned
    for _ in range(2):
        result = refinement.refine_music_path_with_llm(**path_input)
        assert [track["id"] for track in result] == [1, 4, 3]
    assert len(calls) == len(writes) == 1
    assert calls[0][0] == "music_paths.refine"
    assert calls[0][2]["context"]["model_id"] == "selected"
    assert writes[0][1] == {"ttl": 7 * 24 * 60 * 60}


@pytest.mark.parametrize(
    "change",
    ["model", "profile", "options", "credential", "prompt", "schema", "country"],
)
def test_cache_identity_changes_only_with_affected_context_or_prompt(
    monkeypatch, path_input, pinned, change
):
    context, cache, calls, _ = pinned
    refinement.refine_music_path_with_llm(**path_input)
    if change == "model":
        context["model_id"] = "new-model"
    elif change == "profile":
        context["profile_version"] = 2
    elif change == "options":
        context["config"]["timeout_seconds"] = 7
    elif change == "credential":
        context["credential_version"] = "rotated"
    elif change == "prompt":
        monkeypatch.setattr(refinement, "_SYSTEM_PROMPT", "Revised instructions")
    elif change == "schema":
        original = refinement.MusicPathLlmRefinementResponse.model_json_schema
        monkeypatch.setattr(
            refinement.MusicPathLlmRefinementResponse,
            "model_json_schema",
            lambda: {**original(), "description": "new contract"},
        )
    else:
        path_input["tracks"][1]["artist_country"] = "GB"
    refinement.refine_music_path_with_llm(**path_input)
    assert len(calls) == len(cache) == 2


@pytest.mark.parametrize(
    "failure",
    ["disabled", "unavailable", "provider", "stale", "cache_read", "cache_write"],
)
def test_failures_preserve_deterministic_path(monkeypatch, path_input, pinned, failure):
    context, cache, calls, writes = pinned

    def fail(*a, **k):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Private provider detail")

    if failure in {"disabled", "unavailable"}:
        monkeypatch.setattr(configuration, "resolve_action", fail)
    elif failure == "provider":
        monkeypatch.setattr(refinement, "execute_structured", fail)
    elif failure == "stale":
        generate = refinement.execute_structured

        def changed(*a, **k):
            value = generate(*a, **k)
            context["profile_version"] += 1
            return value

        monkeypatch.setattr(refinement, "execute_structured", changed)
    else:
        monkeypatch.setattr(
            refinement, "get_cache" if failure == "cache_read" else "set_cache", fail
        )
    assert refinement.refine_music_path_with_llm(**path_input) == path_input["tracks"]
    assert not writes and not cache


def test_cached_result_is_revalidated_before_application(
    monkeypatch, path_input, pinned
):
    context, cache, calls, _ = pinned
    refinement.refine_music_path_with_llm(**path_input)

    def stale_cache(key, **kwargs):
        context["profile_version"] += 1
        return cache[key]

    monkeypatch.setattr(refinement, "get_cache", stale_cache)
    assert refinement.refine_music_path_with_llm(**path_input) == path_input["tracks"]
    assert len(calls) == 1


@pytest.mark.parametrize("gate", ["none", "env", "provider", "stored"])
def test_legacy_ollama_requires_explicit_opt_in(monkeypatch, path_input, pinned, gate):
    context, _, calls, _ = pinned
    context["mode"] = "legacy"
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("CRATE_ENABLE_PATH_LLM_REFINEMENT", raising=False)
    monkeypatch.setattr(
        refinement,
        "get_setting",
        lambda key, default=None: (
            "true"
            if key == "paths_llm_refinement_enabled"
            else ("ollama/test" if gate == "stored" else "")
        ),
    )
    if gate == "env":
        monkeypatch.setenv("CRATE_ENABLE_PATH_LLM_REFINEMENT", "1")
    if gate == "provider":
        monkeypatch.setenv("LLM_PROVIDER", "ollama/test")
    result = refinement.refine_music_path_with_llm(**path_input)
    assert len(calls) == (0 if gate == "none" else 1)
    assert [row["id"] for row in result] == ([1, 2, 3] if gate == "none" else [1, 4, 3])


@pytest.fixture
def configured_pg(pg_db, monkeypatch):
    from sqlalchemy import text
    from crate.ai.capabilities import model_capabilities
    from crate.db.repositories import ai_configuration as store
    from crate.db.tx import transaction_scope

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    conn = configuration.ensure_environment_connection("gemini")
    store.save_model_catalog(
        conn["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        1,
    )
    profile = configuration.create_profile(
        dict(
            label="Paths",
            connection_id=conn["id"],
            model_id="gemini-2.5-flash",
            config=dict(timeout_seconds=8, max_output_tokens=4096),
        ),
        None,
    )
    binding = dict(
        action_id="music_paths.refine",
        profile_id=profile["id"],
        profile_version=1,
        enabled=True,
        expected_revision=0,
    )
    configuration.apply_bindings([binding], None)
    with transaction_scope() as session:
        session.execute(text("UPDATE ai_configuration_state SET active=TRUE"))
    monkeypatch.setattr(
        "crate.llm.provider.get_config",
        lambda: pytest.fail("Configured Music Paths must not read global settings"),
    )
    return conn, profile, binding


@pytest.mark.parametrize(
    "timing", ["authorized", "before", "during", "precache", "cached"]
)
def test_real_runtime_actor_and_db_boundaries(
    monkeypatch, path_input, configured_pg, timing
):
    from crate import music_paths
    from crate.ai import runtime
    from crate.ai.transport import NativeResponse
    from crate.db.engine import get_pool_runtime
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_admin import update_user_status
    from crate.api.permissions import has_capability

    actor = create_user("paths@example.test", role="user")
    assert not has_capability(actor, "ai.config.manage")
    calls, cache = [], {}
    from crate.db import paths_scene
    from crate.db.queries import paths_scene_queries

    # Exercise the real preparation/query boundaries with a tiny synthetic
    # selection. Both candidate SQL and artist graph SQL finish before generation.
    query = paths_scene_queries.list_scene_path_candidates

    def candidates(*args, **kwargs):
        query(*args, **kwargs)
        return path_input["candidates_by_genre"]

    monkeypatch.setattr(paths_scene_queries, "list_scene_path_candidates", candidates)
    monkeypatch.setattr(
        paths_scene, "build_scene_genre_route", lambda *a: ["rock", "punk"]
    )
    monkeypatch.setattr(
        paths_scene,
        "build_scene_path_from_candidates",
        lambda *a, **k: path_input["tracks"],
    )
    monkeypatch.setattr(refinement, "get_setting", lambda *a, **k: "false")
    monkeypatch.setattr(refinement, "get_cache", lambda key, **k: cache.get(key))
    monkeypatch.setattr(
        refinement, "set_cache", lambda key, value, **k: cache.setdefault(key, value)
    )

    def generate(context, **kwargs):
        calls.append(context)
        assert get_pool_runtime()["checked_out"] == 0
        assert context["config"]["timeout_seconds"] == 8
        assert context["config"]["max_output_tokens"] == 4096
        if timing == "during":
            update_user_status(actor["id"], "suspended")
        return NativeResponse(
            '{"replacements":[{"target_track_id":2,"replacement_track_id":4,"confidence":0.9}]}',
            {"input_tokens": 20, "output_tokens": 30},
            "actual",
            1,
        )

    monkeypatch.setattr(runtime.transport, "generate", generate)
    if timing == "before":
        update_user_status(actor["id"], "suspended")
    if timing == "precache":
        execute = refinement.execute_structured

        def revoke_after_runtime(*a, **k):
            response = execute(*a, **k)
            update_user_status(actor["id"], "suspended")
            return response

        monkeypatch.setattr(refinement, "execute_structured", revoke_after_runtime)

    def invoke():
        return music_paths.compute_scene_path(
            origin_type="genre",
            origin_value="rock",
            dest_type="genre",
            dest_value="punk",
            step_count=5,
            user_id=actor["id"],
        )

    result = invoke()
    expected = [1, 4, 3] if timing in {"authorized", "cached"} else [1, 2, 3]
    assert [track["track_id"] for track in result] == expected
    assert len(calls) == (0 if timing == "before" else 1)
    assert bool(cache) == (timing in {"authorized", "cached"})
    rows = runtime.usage.list_invocations({})["items"]
    if calls:
        assert rows[0]["actor_id"] == actor["id"]
        assert rows[0]["status"] == ("failed" if timing == "during" else "succeeded")
    if timing == "cached":
        update_user_status(actor["id"], "suspended")
        assert [track["track_id"] for track in invoke()] == [1, 2, 3]
        assert len(calls) == 1


@pytest.mark.parametrize(
    "option,value", [("timeout_seconds", 9), ("max_output_tokens", 4097)]
)
def test_new_profiles_cannot_expand_paths_limits(configured_pg, option, value):
    conn, _, _ = configured_pg
    profile = configuration.create_profile(
        dict(
            label="Too large",
            connection_id=conn["id"],
            model_id="gemini-2.5-flash",
            config={"timeout_seconds": 8, "max_output_tokens": 4096, option: value},
        ),
        None,
    )
    with pytest.raises(AIConfigurationError):
        configuration.apply_bindings(
            [
                dict(
                    action_id="music_paths.refine",
                    profile_id=profile["id"],
                    profile_version=1,
                    enabled=True,
                    expected_revision=1,
                )
            ],
            None,
        )


def test_legacy_runtime_keeps_exact_omitted_options(pg_db, monkeypatch, path_input):
    from crate.ai import runtime
    from crate.ai.transport import NativeResponse

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    monkeypatch.setattr(
        "crate.llm.provider.get_config",
        lambda: {"model": "gemini/gemini-2.5-flash", "provider": "gemini"},
    )
    monkeypatch.setattr(refinement, "get_cache", lambda *a, **k: None)
    monkeypatch.setattr(refinement, "set_cache", lambda *a, **k: None)
    calls = []

    def generate(context, **kwargs):
        calls.append(context)
        assert context["legacy_options"]["timeout_seconds"] is None
        assert context["legacy_options"]["max_tokens"] is None
        assert context["legacy_deadline_seconds"] == 60
        return NativeResponse('{"replacements":[]}', None, None, 1)

    monkeypatch.setattr(runtime.transport, "generate_legacy", generate)
    assert refinement.refine_music_path_with_llm(**path_input) == path_input["tracks"]
    assert len(calls) == 1


def test_real_binding_changes_invalidate_only_affected_refinement(
    monkeypatch, path_input, configured_pg
):
    from crate.ai import runtime
    from crate.ai.transport import NativeResponse

    conn, profile, binding = configured_pg
    cache, calls = {}, []
    monkeypatch.setattr(refinement, "get_cache", lambda key, **k: cache.get(key))
    monkeypatch.setattr(
        refinement, "set_cache", lambda key, value, **k: cache.setdefault(key, value)
    )
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda context, **kwargs: (
            calls.append(context)
            or NativeResponse('{"replacements":[]}', None, None, 1)
        ),
    )
    initial = configuration.resolve_action("music_paths.refine")
    refinement.refine_music_path_with_llm(**path_input)
    configuration.apply_bindings(
        [{**binding, "action_id": "genres.description.generate"}], None
    )
    assert configuration.resolve_action("music_paths.refine") == initial
    refinement.refine_music_path_with_llm(**path_input)
    assert len(calls) == len(cache) == 1
    changed = configuration.create_profile(
        dict(
            label="Replacement",
            connection_id=conn["id"],
            model_id="gemini-2.5-flash",
            config=dict(timeout_seconds=7, max_output_tokens=2048),
        ),
        None,
    )
    configuration.apply_bindings(
        [{**binding, "profile_id": changed["id"], "expected_revision": 1}], None
    )
    refinement.refine_music_path_with_llm(**path_input)
    assert len(calls) == len(cache) == 2
    assert calls[0]["profile_id"] == profile["id"]
    assert calls[1]["profile_id"] == changed["id"]
