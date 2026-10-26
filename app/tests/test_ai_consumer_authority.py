"""Current human authority is checked against PostgreSQL at AI boundaries."""

from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from crate.ai import consumers, runtime
from crate.ai.contracts import AIConfigurationError
from crate.ai.transport import NativeResponse
from crate.api.permissions import has_capability
from crate.db.repositories.auth_user_accounts import create_user, get_user_by_id
from crate.db.repositories.auth_user_admin import update_user_status
from crate.db.repositories.auth_user_roles import set_user_roles

ACTIONS = [
    ("shows.extract.vision", "curator"),
    ("shows.extract.text", "curator"),
    ("shows.extract.ocr_text", "curator"),
    ("artwork.hero.analyze", "editor"),
    ("artists.bio.research", "editor"),
    ("genres.description.generate", "curator"),
    ("genres.taxonomy.propose", "curator"),
    ("genres.eq.propose", "curator"),
    ("playlists.description.generate", "curator"),
    ("i18n.listen.draft", "admin"),
]


class Answer(BaseModel):
    ok: bool


@pytest.fixture
def legacy_runtime(pg_db, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-key")
    monkeypatch.setattr(
        "crate.llm.provider.get_config",
        lambda: {"model": "gemini/gemini-2.5-flash", "provider": "gemini"},
    )


@pytest.mark.parametrize(("action", "role"), ACTIONS)
@pytest.mark.parametrize("timing", ["before", "during", "authorized"])
def test_all_human_actions_recheck_current_authority(
    legacy_runtime, monkeypatch, action, role, timing
):
    actor = create_user("actor@example.test", role=role)
    accepted = consumers.accept_action(action)
    call = consumers.resume_action(action, accepted, actor_id=actor["id"])
    calls = []

    def generate(*a, **k):
        calls.append(action)
        if timing == "during":
            set_user_roles(actor["id"], ["user"])
        return NativeResponse(
            '{"ok":true}', {"input_tokens": 4, "output_tokens": 3}, "reported-model", 1
        )

    monkeypatch.setattr(runtime.transport, "generate_legacy", generate)
    if timing == "before":
        set_user_roles(actor["id"], ["user"])
    if timing == "authorized":
        assert runtime.execute_structured(action, Answer, "private source", **call).ok
        assert len(calls) == 1
        if role != "admin":
            assert not has_capability(get_user_by_id(actor["id"]), "ai.config.manage")
    else:
        with pytest.raises(AIConfigurationError) as error:
            runtime.execute_structured(action, Answer, "private source", **call)
        assert error.value.code == "AI_AUTHORITY_REVOKED"
        assert len(calls) == (1 if timing == "during" else 0)
        if timing == "during":
            row = runtime.usage.list_invocations({})["items"][0]
            assert row["status"] == "failed"
            assert row["error_code"] == "AI_AUTHORITY_REVOKED"


@pytest.mark.parametrize("change", ["suspended", "deleted", "role"])
def test_actual_bio_enqueue_rejects_changed_actor_before_research(
    legacy_runtime, monkeypatch, change
):
    from crate.api import artist_research
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.tasks import create_task_dedup
    from crate.worker_handlers.enrichment import _handle_research_artist_bio

    actor = create_user("editor@example.test", role="editor")
    request = SimpleNamespace(state=SimpleNamespace(user=actor))
    monkeypatch.setattr(
        artist_research,
        "create_task_dedup",
        lambda *a, **k: create_task_dedup(*a, **k, dispatch=False),
    )
    task_id = artist_research._queue_research(
        request, {"id": 1, "name": "Band"}, artist_research.ArtistBioResearchRequest()
    )["task_id"]
    task = get_task(task_id)
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_id",
        lambda _: {"id": 1, "name": "Band"},
    )
    assert set(task["params"]["ai_acceptance"]) == {"action_id", "fingerprint"}
    if change == "role":
        set_user_roles(actor["id"], ["user"])
    else:
        update_user_status(actor["id"], change)
    monkeypatch.setattr(
        "crate.artist_bio_research.research_artist_bio",
        lambda *a, **k: pytest.fail(
            "revoked actor must not research or invoke provider"
        ),
    )
    with pytest.raises(AIConfigurationError) as error:
        _handle_research_artist_bio(task_id, task["params"], {})
    assert error.value.code == "AI_AUTHORITY_REVOKED"
    assert get_task(task_id)["result"] is None
    assert runtime.usage.list_invocations({})["items"] == []


@pytest.mark.parametrize("operation", ["eq", "playlist"])
def test_inflight_domain_apply_rechecks_real_actor(
    legacy_runtime, monkeypatch, operation
):
    actor = create_user("curator@example.test", role="curator")
    request = SimpleNamespace(state=SimpleNamespace(user=actor))
    writes = []

    def generated(**kwargs):
        set_user_roles(actor["id"], ["user"])
        return SimpleNamespace(
            gains=[0.0] * 10, reasoning="Private draft", description="Private draft"
        )

    if operation == "eq":
        from crate.api import genres as api

        monkeypatch.setattr(api, "get_genre_taxonomy_node_id", lambda _: 1)
        monkeypatch.setattr(api, "get_genre_detail", lambda _: {})
        monkeypatch.setattr(api, "set_genre_eq_gains", lambda *a, **k: writes.append(k))
        monkeypatch.setattr("crate.llm.prompts.eq_preset.generate_eq_preset", generated)

        def invoke():
            return api.generate_genre_eq(request, "rock", apply=True)
    else:
        from crate.api import system_playlists as api

        monkeypatch.setattr(api, "_require_system_playlist", lambda _: {"name": "Mix"})
        monkeypatch.setattr(api, "get_playlist_tracks", lambda _: [])
        monkeypatch.setattr(api, "update_playlist", lambda *a, **k: writes.append(k))
        monkeypatch.setattr(
            "crate.llm.prompts.playlist_description.generate_playlist_description",
            generated,
        )

        def invoke():
            return api.admin_generate_playlist_description(
                request, 1, api.GeneratePlaylistDescriptionRequest(apply=True)
            )

    with pytest.raises(AIConfigurationError) as error:
        invoke()
    assert error.value.code == "AI_AUTHORITY_REVOKED"
    assert writes == []


def test_actorless_i18n_still_invokes_and_accepts_result(legacy_runtime, monkeypatch):
    action = "i18n.listen.draft"
    call = consumers.resume_action(action, consumers.accept_action(action))
    monkeypatch.setattr(
        runtime.transport,
        "generate_legacy",
        lambda *a, **k: NativeResponse('{"ok":true}', None, None, 1),
    )
    assert runtime.execute_structured(action, Answer, "translation", **call).ok
    consumers.revalidate_call(call)


@pytest.mark.parametrize(
    "task_type", ["infer_genre_taxonomy", "rebuild_genre_taxonomy_proposals"]
)
def test_genre_queue_checks_revoked_actor_before_batch(
    legacy_runtime, monkeypatch, task_type
):
    from crate.api import genres
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.tasks import create_task
    from crate.worker_handlers import analysis

    actor = create_user("curator@example.test", role="curator")
    request = SimpleNamespace(state=SimpleNamespace(user=actor))
    monkeypatch.setattr(
        genres, "create_task", lambda *a, **k: create_task(*a, **k, dispatch=False)
    )
    if task_type == "infer_genre_taxonomy":
        task_id = genres.infer_genre_taxonomy(
            request, genres.InferTaxonomyBody(limit=1)
        )["task_id"]
        target = "crate.genre_taxonomy_inference.infer_genre_taxonomy_batch"
    else:
        task_id = genres.rebuild_taxonomy_proposal(
            request, genres.GenreTaxonomyRebuildProposalRequest()
        )["task_id"]
        target = "crate.genre_taxonomy_proposals.build_genre_taxonomy_rebuild_proposal"
    set_user_roles(actor["id"], ["user"])
    monkeypatch.setattr(
        target, lambda *a, **k: pytest.fail("revoked batch must not invoke provider")
    )
    task = get_task(task_id)
    with pytest.raises(AIConfigurationError) as error:
        getattr(analysis, "_handle_" + task_type)(task_id, task["params"], {})
    assert error.value.code == "AI_AUTHORITY_REVOKED"
    assert get_task(task_id)["result"] is None
    assert runtime.usage.list_invocations({})["items"] == []


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
def test_worker_discards_final_result_if_actor_changed_during_batch(
    legacy_runtime, monkeypatch, handler, target, action
):
    from crate.worker_handlers import analysis, enrichment

    role = "editor" if action == "artists.bio.research" else "curator"
    actor = create_user("actor@example.test", role=role)
    module = enrichment if role == "editor" else analysis
    monkeypatch.setattr(module, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(module, "emit_progress", lambda *a, **k: None)
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_id",
        lambda _: {"id": 1, "name": "Band"},
    )

    def batch(*a, **k):
        set_user_roles(actor["id"], ["user"])
        return {"private": "completed draft"}

    monkeypatch.setattr(target, batch)
    params = {
        "artist_id": 1,
        "actor_user_id": actor["id"],
        "ai_acceptance": consumers.accept_action(action),
    }
    with pytest.raises(AIConfigurationError) as error:
        getattr(module, handler)("job", params, {})
    assert error.value.code == "AI_AUTHORITY_REVOKED"


def test_actorless_i18n_service_still_persists_review_bundle(
    legacy_runtime, monkeypatch
):
    from crate.worker_handlers.management import _handle_draft_i18n_translation
    from crate.db.repositories.i18n import upsert_translation_request
    from crate.db.queries.i18n import get_translation_bundle
    from crate.db.repositories.tasks import create_task
    from crate.db.queries.tasks import get_task

    params = {
        "locale": "es",
        "source_version": "v1",
        "ai_acceptance": consumers.accept_action("i18n.listen.draft"),
    }
    upsert_translation_request(
        app="listen",
        locale="es",
        source_version="v1",
        client="web",
        reason="unsupported-locale",
    )
    task_id = create_task("draft_i18n_translation", params, dispatch=False)
    monkeypatch.setattr(
        "crate.llm.prompts.i18n_translation.load_listen_source_messages",
        lambda: {"play": "Play"},
    )
    monkeypatch.setattr(
        runtime.transport,
        "generate_legacy",
        lambda *a, **k: NativeResponse(
            '{"locale":"es","messages":[{"key":"play","translation":"Reproducir","confidence":0.9}]}',
            None,
            None,
            1,
        ),
    )
    result = _handle_draft_i18n_translation(task_id, get_task(task_id)["params"], {})
    assert result["status"] == "needs_review"
    bundle = get_translation_bundle(result["bundle_id"])
    assert bundle["published_at"] is None
    assert bundle["messages_json"] == {"play": "Reproducir"}
