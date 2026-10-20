"""Direct consumers must dispatch only the registered action and pinned context."""

from importlib import import_module
from types import SimpleNamespace

import pytest


@pytest.fixture
def domain_actor(pg_db):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_roles import set_user_roles

    actor = create_user("consumer@example.test", role="editor")
    set_user_roles(actor["id"], ["editor", "curator"])
    return actor


@pytest.mark.parametrize(
    ("module", "function", "arguments", "action"),
    [
        (
            "artist_bio_research",
            "consolidate_artist_bio",
            dict(artist_name="Band", current_bio="", artist_context={}, sources=[]),
            "artists.bio.research",
        ),
        (
            "genre_node_description",
            "generate_genre_node_description",
            dict(genre_name="Rock", slug="rock"),
            "genres.description.generate",
        ),
        (
            "genre_taxonomy_node_proposal",
            "generate_genre_taxonomy_node_proposal",
            dict(genre_name="Rock", slug="rock"),
            "genres.taxonomy.propose",
        ),
        (
            "eq_preset",
            "generate_eq_preset",
            dict(genre_name="Rock"),
            "genres.eq.propose",
        ),
        (
            "playlist_description",
            "generate_playlist_description",
            dict(name="Mix"),
            "playlists.description.generate",
        ),
        (
            "i18n_translation",
            "generate_i18n_translation_draft",
            dict(target_locale="es", source_messages={"play": "Play"}),
            "i18n.listen.draft",
        ),
    ],
)
def test_prompt_generator_routes_pinned_action(
    monkeypatch, module, function, arguments, action
):
    import crate.llm

    calls = []
    result = object()

    def ask(model, prompt, **kwargs):
        calls.append(kwargs)
        return result

    monkeypatch.setattr(crate.llm, "ask_structured", ask)
    call = {"context": {"private": "pinned"}, "actor_id": 7, "job_id": "job"}
    value = getattr(import_module("crate.llm.prompts." + module), function)(
        **arguments, ai_call=call
    )
    assert value is result
    assert calls[0]["action_id"] == action
    assert calls[0]["context"] is call["context"]
    assert calls[0]["job_id"] == "job"
    assert calls[0]["private_response"] is True


def test_bio_provenance_uses_result_model_without_rereading_global(monkeypatch):
    from crate import artist_bio_research as research
    from crate.llm.prompts import artist_bio_research as prompt
    import crate.llm

    response = prompt.ArtistBioResearchResponse(
        paragraphs=["A researched biography."], bio_action="update"
    )
    object.__setattr__(response, "_ai_model_id", "accepted-model")
    monkeypatch.setattr(research, "collect_artist_research_sources", lambda *a, **k: [])
    monkeypatch.setattr(prompt, "consolidate_artist_bio", lambda **k: response)
    monkeypatch.setattr(
        crate.llm, "get_config", lambda: pytest.fail("mutable global model reread")
    )
    assert research.research_artist_bio({"name": "Band"})["model"] == "accepted-model"


def test_hero_routes_its_action_and_keeps_default_image_detail(monkeypatch):
    from crate import artist_hero_candidates as hero
    from tests.ai_consumer_fakes import pin_actions

    pin_actions(monkeypatch)
    calls = []
    monkeypatch.setattr(
        hero,
        "ask_image_structured",
        lambda *a, **k: calls.append(k) or SimpleNamespace(),
    )
    assert hero.analyze_candidate_image(b"image") is not None
    assert calls[0]["action_id"] == "artwork.hero.analyze"
    assert calls[0].get("image_detail", "default") == "default"
    assert calls[0]["private_response"] is True


def test_queue_acceptance_persists_only_safe_identity_and_rejects_stale_worker(
    monkeypatch,
):
    from crate.ai import consumers, configuration
    from crate.ai.contracts import AIConfigurationError

    context = {
        "action_id": "artists.bio.research",
        "profile_id": "profile",
        "profile_version": 2,
        "config_fingerprint": "accepted",
        "endpoint": "http://private",
        "credential_ref": "secret-ref",
    }
    seen = []

    def resolve(action, expected_fingerprint=None):
        seen.append(expected_fingerprint)
        if (
            expected_fingerprint
            and expected_fingerprint != context["config_fingerprint"]
        ):
            raise AIConfigurationError("AI_CONTEXT_STALE", "Configuration changed")
        return dict(context)

    monkeypatch.setattr(configuration, "resolve_action", resolve)
    accepted = consumers.accept_action("artists.bio.research")
    assert accepted == {
        "action_id": "artists.bio.research",
        "profile_id": "profile",
        "profile_version": 2,
        "fingerprint": "accepted",
    }
    call = consumers.resume_action("artists.bio.research", accepted, job_id="job")
    assert call["context"]["endpoint"] == "http://private"
    assert seen == [None, "accepted"]
    context["config_fingerprint"] = "rotated"
    with pytest.raises(AIConfigurationError, match="changed"):
        consumers.resume_action("artists.bio.research", accepted, job_id="job")
    with pytest.raises(AIConfigurationError):
        consumers.resume_action("artists.bio.research", None, job_id="old-job")


@pytest.mark.parametrize("mode", ["vision", "text_llm", "ocr_text_llm"])
def test_show_modes_use_pinned_runtime_action(monkeypatch, mode):
    from crate import show_extraction as shows
    from crate.ai import configuration
    from io import BytesIO
    from PIL import Image

    action = {
        "vision": "shows.extract.vision",
        "text_llm": "shows.extract.text",
        "ocr_text_llm": "shows.extract.ocr_text",
    }[mode]
    context = {
        "action_id": action,
        "model_id": "gemini-3.8-flash",
        "legacy_model": "gemini/gemini-3.8-flash",
        "provider": "gemini",
        "config_fingerprint": "bound",
    }
    monkeypatch.setattr(configuration, "resolve_action", lambda *a, **k: context)
    monkeypatch.setattr(configuration, "revalidate_context", lambda c: None)
    calls = []

    def ask(*args, **kwargs):
        calls.append(kwargs)
        return shows.ExtractedShows(candidates=[], coverage="incomplete")

    monkeypatch.setattr(shows.provider, "ask_structured", ask)
    monkeypatch.setattr(shows.provider, "ask_image_structured", ask)
    monkeypatch.setattr(
        shows,
        "recognize_image",
        lambda *a, **k: {
            "text": "Tour 2027; 02.03 Madrid",
            "engine": "test",
            "languages": [],
            "elapsed_seconds": 0,
            "extractor": "test",
            "truncated": False,
        },
    )
    data = BytesIO()
    Image.new("RGB", (2, 2)).save(data, format="PNG")
    images = (
        [{"id": "id", "sha256": "hash", "content": data.getvalue()}]
        if mode != "text_llm"
        else []
    )
    result = shows.extract_show_candidates(
        {"mode": mode, "raw_text": "Tour 2027; 02.03 Madrid"},
        images,
        ai_call={"context": context, "job_id": "job"},
    )
    assert "error_code" not in result
    assert len(calls) == 1
    assert calls[0]["action_id"] == action
    assert calls[0]["context"] is context
    assert calls[0]["private_response"] is True


def test_bio_enqueue_accepts_context_before_creating_task(monkeypatch):
    from crate.api import artist_research as api
    from crate.ai import configuration

    events = []
    monkeypatch.setattr(api, "require_permission", lambda *a: {"id": 7})
    monkeypatch.setattr(
        configuration,
        "resolve_action",
        lambda action: (
            events.append("resolved")
            or {
                "action_id": action,
                "config_fingerprint": "accepted",
                "credential_ref": "private",
            }
        ),
    )
    monkeypatch.setattr(
        api,
        "create_task_dedup",
        lambda kind, params, **kw: events.append(params) or "job",
    )
    assert api._queue_research(
        None, {"id": 1, "name": "Band"}, api.ArtistBioResearchRequest()
    ) == {"task_id": "job"}
    assert events[0] == "resolved"
    assert events[1]["ai_acceptance"] == {
        "action_id": "artists.bio.research",
        "fingerprint": "accepted",
    }
    assert "private" not in str(events[1])


def test_genre_enqueue_accepts_description_action_only_for_ai_task(monkeypatch):
    from crate.api import genres as api
    from crate.ai import configuration

    tasks = []
    monkeypatch.setattr(api, "list_tasks", lambda **k: [])
    monkeypatch.setattr(
        configuration,
        "resolve_action",
        lambda action: {"action_id": action, "config_fingerprint": "accepted"},
    )
    monkeypatch.setattr(
        api, "create_task", lambda kind, params: tasks.append(params) or "job"
    )
    api._get_or_create_task("infer_genre_taxonomy", {"limit": 1})
    assert tasks[0]["ai_acceptance"]["action_id"] == "genres.description.generate"
    api._get_or_create_task("index_genres", {})
    assert "ai_acceptance" not in tasks[1]


def test_i18n_enqueue_accepts_context_and_manual_when_action_disabled(monkeypatch):
    from crate.api import i18n as api
    from crate.ai import configuration
    from crate.ai.contracts import AIConfigurationError

    tasks = []
    monkeypatch.setattr(api, "listen_i18n_ai_is_configured", lambda: True)
    monkeypatch.setattr(api, "update_translation_request_status", lambda **k: k)
    monkeypatch.setattr(
        api, "create_task", lambda kind, params: tasks.append(params) or "job"
    )
    monkeypatch.setattr(
        configuration,
        "resolve_action",
        lambda action: {"action_id": action, "config_fingerprint": "accepted"},
    )
    request = {"app": "listen", "locale": "es", "source_version": "v1"}
    assert api._queue_translation_draft_if_needed(request)["status"] == "drafting_ai"
    assert tasks[0]["ai_acceptance"]["fingerprint"] == "accepted"

    def disabled(*a, **k):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Action is disabled")

    monkeypatch.setattr(configuration, "resolve_action", disabled)
    assert (
        api._queue_translation_draft_if_needed(request)["status"] == "manual_required"
    )
    assert len(tasks) == 1


@pytest.mark.parametrize("operation", ["eq", "playlist"])
def test_configuration_revoked_after_generation_blocks_application(
    monkeypatch, operation, domain_actor
):
    from crate.ai.contracts import AIConfigurationError
    from tests.ai_consumer_fakes import pin_actions

    contexts = pin_actions(monkeypatch)
    writes = []

    def generated(action, result):
        contexts[action]["config_fingerprint"] = "revoked"
        return result

    if operation == "eq":
        from crate.api import genres as api

        monkeypatch.setattr(api, "_require_genre_curator", lambda _: domain_actor)
        monkeypatch.setattr(api, "get_genre_taxonomy_node_id", lambda _: 1)
        monkeypatch.setattr(api, "get_genre_detail", lambda _: {})
        monkeypatch.setattr(api, "set_genre_eq_gains", lambda *a, **k: writes.append(k))
        monkeypatch.setattr(
            "crate.llm.prompts.eq_preset.generate_eq_preset",
            lambda **k: generated(
                "genres.eq.propose",
                SimpleNamespace(gains=[0.0] * 10, reasoning="Review"),
            ),
        )

        def invoke():
            return api.generate_genre_eq(None, "rock", apply=True)
    else:
        from crate.api import system_playlists as api

        monkeypatch.setattr(api, "_require_playlist_curator", lambda _: domain_actor)
        monkeypatch.setattr(api, "_require_system_playlist", lambda _: {"name": "Mix"})
        monkeypatch.setattr(api, "get_playlist_tracks", lambda _: [])
        monkeypatch.setattr(api, "update_playlist", lambda *a, **k: writes.append(k))
        monkeypatch.setattr(
            "crate.llm.prompts.playlist_description.generate_playlist_description",
            lambda **k: generated(
                "playlists.description.generate",
                SimpleNamespace(description="Private draft"),
            ),
        )

        def invoke():
            return api.admin_generate_playlist_description(
                None, 1, api.GeneratePlaylistDescriptionRequest(apply=True)
            )

    with pytest.raises(AIConfigurationError, match="changed"):
        invoke()
    assert writes == []


def test_i18n_configured_binding_ignores_absent_global_and_disabled_binding(
    monkeypatch,
):
    from crate.api import i18n
    from crate.ai import runtime

    monkeypatch.setattr(
        "crate.llm.get_config", lambda: pytest.fail("global model read")
    )
    monkeypatch.delenv("CRATE_ENABLE_LISTEN_I18N_AI_DRAFTS", raising=False)
    monkeypatch.setattr(
        runtime,
        "action_availability",
        lambda action: {
            "available": True,
            "status": "configured",
            "provider": "ollama",
        },
    )
    assert i18n.listen_i18n_ai_is_configured() is True
    monkeypatch.setattr(
        runtime,
        "action_availability",
        lambda action: {"available": False, "status": "unavailable", "provider": None},
    )
    assert i18n.listen_i18n_ai_is_configured() is False


def test_i18n_revoked_queue_never_calls_provider_or_stores_bundle(monkeypatch):
    from crate.ai import consumers
    from crate.ai.contracts import AIConfigurationError
    from crate.worker_handlers.management import _handle_draft_i18n_translation

    updates = []
    monkeypatch.setattr(
        "crate.llm.prompts.i18n_translation.load_listen_source_messages",
        lambda: {"play": "Play"},
    )
    monkeypatch.setattr(
        consumers,
        "resume_action",
        lambda *a, **k: (_ for _ in ()).throw(
            AIConfigurationError("AI_CONTEXT_STALE", "changed")
        ),
    )
    monkeypatch.setattr(
        "crate.llm.prompts.i18n_translation.generate_i18n_translation_draft",
        lambda **k: pytest.fail("provider"),
    )
    monkeypatch.setattr(
        "crate.db.repositories.i18n.insert_translation_bundle_draft",
        lambda **k: pytest.fail("apply"),
    )
    monkeypatch.setattr(
        "crate.db.repositories.i18n.update_translation_request_status",
        lambda **k: updates.append(k),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.emit_task_event", lambda *a: None
    )
    result = _handle_draft_i18n_translation(
        "job", {"locale": "es", "source_version": "v1"}, {}
    )
    assert result["status"] == "manual_required"
    assert updates[0]["status"] == "manual_required"
    assert result["reason"] == "AI_TRANSLATION_UNAVAILABLE"


def test_batch_item_identity_and_preapply_guard(monkeypatch):
    from crate.ai import consumers
    from tests.ai_consumer_fakes import pin_actions

    contexts = pin_actions(monkeypatch)
    call = consumers.resume_action(
        "genres.description.generate",
        consumers.accept_action("genres.description.generate"),
        job_id="job",
    )
    first = consumers.item_call(call, "rock")
    assert first["context"] is call["context"]
    assert first["idempotency_key"] == "job:job:rock"
    assert (
        consumers.item_call(call, "jazz")["idempotency_key"] != first["idempotency_key"]
    )
    contexts["genres.description.generate"]["config_fingerprint"] = "changed"
    from crate.ai.contracts import AIConfigurationError

    with pytest.raises(AIConfigurationError):
        consumers.revalidate_call(call)


@pytest.mark.parametrize(
    ("module", "function", "arguments", "action", "payload"),
    [
        (
            "artist_bio_research",
            "consolidate_artist_bio",
            dict(artist_name="Band", current_bio="", artist_context={}, sources=[]),
            "artists.bio.research",
            {"paragraphs": ["An evidence based biography."], "bio_action": "update"},
        ),
        (
            "genre_node_description",
            "generate_genre_node_description",
            dict(genre_name="Rock", slug="rock"),
            "genres.description.generate",
            {"description": "A distinct style of instrumental music."},
        ),
        (
            "genre_taxonomy_node_proposal",
            "generate_genre_taxonomy_node_proposal",
            dict(genre_name="Rock", slug="rock"),
            "genres.taxonomy.propose",
            {"description": "A style of music.", "relations": []},
        ),
        (
            "eq_preset",
            "generate_eq_preset",
            dict(genre_name="Rock"),
            "genres.eq.propose",
            {"gains": [0.0] * 10, "reasoning": "Balanced."},
        ),
        (
            "playlist_description",
            "generate_playlist_description",
            dict(name="Mix"),
            "playlists.description.generate",
            {"description": "A collection for late evenings."},
        ),
        (
            "i18n_translation",
            "generate_i18n_translation_draft",
            dict(target_locale="es", source_messages={"play": "Play"}),
            "i18n.listen.draft",
            {
                "locale": "es",
                "messages": [
                    {"key": "play", "translation": "Reproducir", "confidence": 0.9}
                ],
            },
        ),
    ],
)
def test_bound_generators_execute_runtime_without_global_model(
    monkeypatch, module, function, arguments, action, payload
):
    import json
    from crate.ai import runtime
    from crate.ai.transport import NativeResponse
    from tests.test_ai_runtime import context

    accepted = context(action=action)
    calls = []
    monkeypatch.setattr(
        "crate.llm.provider.get_config", lambda: pytest.fail("mutable global model")
    )
    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda c: None)
    monkeypatch.setattr(
        runtime.configuration, "load_context_key", lambda c: "test-only-key"
    )
    monkeypatch.setattr(
        runtime.usage,
        "reserve_invocation",
        lambda *a, **k: {"id": "invocation", "claimed": True},
    )
    monkeypatch.setattr(runtime.usage, "finish_invocation", lambda *a, **k: None)
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda c, **k: (
            calls.append(c)
            or NativeResponse(json.dumps(payload), None, "reported-model", 1)
        ),
    )
    result = getattr(import_module("crate.llm.prompts." + module), function)(
        **arguments, ai_call={"context": accepted}
    )
    assert calls[0]["action_id"] == action
    assert calls[0]["model_id"] == "model-one"
    assert getattr(result, "_ai_model_id") == "reported-model"


def test_action_availability_for_bio_and_show_modes_uses_bindings(monkeypatch):
    from crate.ai import configuration
    from crate.api import artist_research
    from crate import show_extraction

    monkeypatch.setattr(
        "crate.llm.provider.get_config", lambda: pytest.fail("global model")
    )
    monkeypatch.setattr(artist_research, "require_permission", lambda *a: {})

    def configured(action):
        return {
            "action_id": action,
            "mode": "configured",
            "provider": "gemini",
            "model_id": "bound-model",
            "config_fingerprint": "bound",
        }

    monkeypatch.setattr(configuration, "get_action_configuration", configured)
    assert artist_research.artist_bio_research_status(None)["available"] is True
    state = show_extraction.probe_show_extractors()
    assert set(state["actions"]) == set(show_extraction.SHOW_ACTIONS)
    assert all(item["configured"] for item in state["actions"].values())
    from crate.ai.contracts import AIConfigurationError

    monkeypatch.setattr(
        configuration,
        "get_action_configuration",
        lambda action: (_ for _ in ()).throw(
            AIConfigurationError("AI_ACTION_DISABLED", "Disabled")
        ),
    )
    assert artist_research.artist_bio_research_status(None)["available"] is False
    assert all(
        not show_extraction.show_llm_configuration(mode)["configured"]
        for mode in show_extraction.SHOW_ACTIONS
    )


def test_show_actions_say_why_a_model_method_is_unavailable(monkeypatch):
    from crate.ai import configuration
    from crate.ai.contracts import AIConfigurationError
    from crate import show_extraction

    def configured(action):
        return {
            "action_id": action,
            "mode": "configured",
            "provider": "gemini",
            "model_id": "bound-model",
            "config_fingerprint": "bound",
        }

    monkeypatch.setattr(configuration, "get_action_configuration", configured)
    for mode in show_extraction.SHOW_ACTIONS:
        assert show_extraction.show_llm_configuration(mode)["reason"] is None

    monkeypatch.setattr(
        configuration,
        "get_action_configuration",
        lambda action: (_ for _ in ()).throw(
            AIConfigurationError("AI_ACTION_DISABLED", "Disabled")
        ),
    )
    for mode in show_extraction.SHOW_ACTIONS:
        state = show_extraction.show_llm_configuration(mode)
        assert state["configured"] is False
        assert state["reason"] == "AI_ACTION_DISABLED"


@pytest.mark.parametrize(
    ("handler", "target", "action"),
    [
        (
            "_handle_infer_genre_taxonomy",
            "crate.genre_taxonomy_inference.infer_genre_taxonomy_batch",
            "genres.description.generate",
        ),
        (
            "_handle_rebuild_genre_taxonomy_proposals",
            "crate.genre_taxonomy_proposals.build_genre_taxonomy_rebuild_proposal",
            "genres.taxonomy.propose",
        ),
        (
            "_handle_research_artist_bio",
            "crate.artist_bio_research.research_artist_bio",
            "artists.bio.research",
        ),
    ],
)
def test_queued_workers_keep_accepted_context_and_actor(
    monkeypatch, handler, target, action, domain_actor
):
    from crate.ai import consumers
    from crate.worker_handlers import analysis, enrichment
    from tests.ai_consumer_fakes import pin_actions

    pin_actions(monkeypatch)
    calls = []
    monkeypatch.setattr(target, lambda *a, **k: calls.append(k) or {"ok": True})
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_id",
        lambda _: {"id": 1, "name": "Band"},
    )
    module = enrichment if action == "artists.bio.research" else analysis
    monkeypatch.setattr(module, "emit_task_event", lambda *a: None)
    monkeypatch.setattr(module, "emit_progress", lambda *a, **k: None)
    accepted = consumers.accept_action(action)
    assert getattr(module, handler)(
        "job",
        {
            "artist_id": 1,
            "actor_user_id": domain_actor["id"],
            "ai_acceptance": accepted,
        },
        {},
    ) == {"ok": True}
    assert (
        calls[0]["ai_call"]["context"]["config_fingerprint"] == accepted["fingerprint"]
    )
    assert calls[0]["ai_call"]["actor_id"] == domain_actor["id"]
    assert calls[0]["ai_call"]["job_id"] == "job"


def test_batch_items_execute_separately_and_repeat_does_not_call_provider(monkeypatch):
    from crate.ai import consumers, runtime
    from crate.ai.contracts import AIConfigurationError
    from crate.ai.transport import NativeResponse
    from crate.llm.prompts.genre_node_description import generate_genre_node_description
    from tests.test_ai_runtime import context

    accepted = context(action="genres.description.generate")
    seen = set()
    calls = []

    def reserve(*a, **kwargs):
        key = kwargs["idempotency_key"]
        claimed = key not in seen
        seen.add(key)
        return {"id": "invocation", "claimed": claimed}

    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda c: None)
    monkeypatch.setattr(
        runtime.configuration, "load_context_key", lambda c: "test-only-key"
    )
    monkeypatch.setattr(runtime.usage, "reserve_invocation", reserve)
    monkeypatch.setattr(runtime.usage, "finish_invocation", lambda *a, **k: None)
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda c, **k: (
            calls.append(c)
            or NativeResponse(
                '{"description":"A distinct style of instrumental music."}',
                None,
                "model-one",
                1,
            )
        ),
    )
    call = {"context": accepted, "job_id": "batch"}
    for slug in ["rock", "jazz"]:
        generate_genre_node_description(
            genre_name=slug, slug=slug, ai_call=consumers.item_call(call, slug)
        )
    with pytest.raises(AIConfigurationError) as error:
        generate_genre_node_description(
            genre_name="rock", slug="rock", ai_call=consumers.item_call(call, "rock")
        )
    assert error.value.code == "AI_EXECUTION_ALREADY_ACCEPTED"
    assert len(calls) == 2


def test_show_availability_exposes_each_action_without_global_model(monkeypatch):
    from crate.api import show_imports
    from tests.ai_consumer_fakes import pin_actions

    pin_actions(monkeypatch)
    monkeypatch.setattr(show_imports, "_principal", lambda _: None)
    monkeypatch.setattr(
        "crate.db.repositories.show_extraction_jobs.show_extractor_readiness",
        lambda: {},
    )
    monkeypatch.setattr(
        "crate.llm.provider.get_config", lambda: pytest.fail("global model")
    )
    result = show_imports.show_import_availability(None)
    assert {item["action_id"] for item in result["actions"].values()} == {
        "shows.extract.vision",
        "shows.extract.text",
        "shows.extract.ocr_text",
    }
    assert result["limits"]["selected_shows"] == 50
    assert result["limits"]["draft_candidates"] == 200
    assert all("reason" in item for item in result["actions"].values())
