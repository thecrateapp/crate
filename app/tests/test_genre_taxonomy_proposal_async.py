"""Taxonomy node proposals run in the ai queue, never inside the request
(SMQ.PR2b)."""

from types import SimpleNamespace

import pytest
from sqlalchemy import text

from crate.ai.contracts import AIConfigurationError
from tests.ai_consumer_fakes import pin_actions

HARDCORE = {
    "slug": "hardcore",
    "name": "Hardcore",
    "description": "Fast, direct, and loud.",
    "aliases": ["hc"],
    "top_level": True,
    "facets": [],
    "parents": [],
    "related": ["punk"],
    "influenced_by": [],
    "fusion_of": [],
}
PUNK = {**HARDCORE, "slug": "punk", "name": "Punk", "related": [], "aliases": []}


@pytest.fixture
def catalog(monkeypatch):
    nodes = {"hardcore": dict(HARDCORE), "punk": dict(PUNK)}
    monkeypatch.setattr(
        "crate.genre_taxonomy_proposals.get_genre_catalog",
        lambda: {slug: dict(node) for slug, node in nodes.items()},
    )
    return nodes


@pytest.fixture
def no_dispatch(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: sent.append((task_type, task_id)),
    )
    return sent


def _proposal_tasks():
    from crate.db.tx import read_scope

    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT id, pool, params_json, dedup_key FROM tasks "
                    "WHERE type = 'propose_genre_taxonomy_node' ORDER BY created_at"
                )
            ).mappings()
        ]


def _model_must_not_run(monkeypatch):
    monkeypatch.setattr(
        "crate.llm.prompts.genre_taxonomy_node_proposal."
        "generate_genre_taxonomy_node_proposal",
        lambda **_: pytest.fail("the request must not call the model"),
    )


def test_returns_202_and_enqueues_once(
    pg_db, test_app, monkeypatch, catalog, no_dispatch
):
    pin_actions(monkeypatch)
    _model_must_not_run(monkeypatch)

    first = test_app.post("/api/genres/taxonomy/hardcore/proposal")
    second = test_app.post("/api/genres/taxonomy/Hardcore/proposal")

    assert first.status_code == 202, first.text
    assert first.json()["status"] == "queued"
    assert first.json()["deduplicated"] is False
    assert second.status_code == 202
    assert second.json() == {**first.json(), "deduplicated": True}
    tasks = _proposal_tasks()
    assert len(tasks) == 1
    assert tasks[0]["pool"] == "ai"
    params = tasks[0]["params_json"]
    assert params["slug"] == "hardcore"
    assert params["actor_user_id"] == 1
    assert params["ai_acceptance"]["action_id"] == "genres.taxonomy.propose"
    assert no_dispatch == [("propose_genre_taxonomy_node", tasks[0]["id"])]

    # Editing the node changes the proposal input, so a new task is queued.
    catalog["hardcore"]["description"] = "Faster, angrier."
    edited = test_app.post("/api/genres/taxonomy/hardcore/proposal")
    assert edited.status_code == 202
    assert edited.json()["task_id"] != first.json()["task_id"]


def test_unknown_genre_is_rejected_before_acceptance(
    pg_db, test_app, monkeypatch, catalog, no_dispatch
):
    monkeypatch.setattr(
        "crate.genre_taxonomy_proposals.get_genre_detail", lambda _: None
    )

    response = test_app.post("/api/genres/taxonomy/not-a-genre/proposal")

    assert response.status_code == 404
    assert _proposal_tasks() == []


def test_unavailable_when_action_disabled(
    pg_db, test_app, monkeypatch, catalog, no_dispatch
):
    def disabled(action_id, expected_fingerprint=None):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Action is disabled")

    monkeypatch.setattr("crate.ai.configuration.resolve_action", disabled)

    response = test_app.post("/api/genres/taxonomy/hardcore/proposal")

    assert response.status_code == 503
    assert response.headers["X-Crate-Error"] == "AI_ACTION_DISABLED"
    assert _proposal_tasks() == []


@pytest.fixture
def curator(pg_db):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_roles import set_user_roles

    actor = create_user("taxonomy-curator@example.test", role="curator")
    set_user_roles(actor["id"], ["curator"])
    return actor


def _queued_task(curator):
    from crate.ai.consumers import accept_action
    from crate.db.repositories.tasks import create_task

    params = {
        "slug": "hardcore",
        "actor_user_id": curator["id"],
        "ai_acceptance": accept_action("genres.taxonomy.propose"),
    }
    return create_task("propose_genre_taxonomy_node", params, dispatch=False), params


def _model_response():
    return SimpleNamespace(
        recommended_action="create_node",
        recommended_target_slug=None,
        description="A forceful hardcore offshoot.",
        aliases=["hc"],
        relations=[
            SimpleNamespace(
                relation_type="parent",
                target_slugs=["punk"],
                confidence=0.9,
                reasoning="Scene lineage.",
            )
        ],
        facets=[],
        eq_gains=[1, 2, 1, 0, -1, 0, 1, 2, 1, 0],
        eq_reasoning="Presence and tight lows.",
        reasoning="Local evidence points to punk.",
    )


def test_worker_stores_proposal(monkeypatch, catalog, curator):
    from crate import actors
    from crate.db.queries.tasks import get_task

    pin_actions(monkeypatch)
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return _model_response()

    monkeypatch.setattr(
        "crate.llm.prompts.genre_taxonomy_node_proposal."
        "generate_genre_taxonomy_node_proposal",
        generate,
    )
    monkeypatch.setattr("crate.db.events._publish_to_redis", lambda *a, **k: None)
    monkeypatch.setattr("crate.config.load_config", lambda: {})
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    task_id, _ = _queued_task(curator)

    actors._execute_task("propose_genre_taxonomy_node", task_id)

    task = get_task(task_id)
    assert task["status"] == "completed", task.get("error")
    result = task["result"]
    assert result["ok"] is True
    assert result["slug"] == "hardcore"
    assert result["description"] == "A forceful hardcore offshoot."
    assert result["eq_gains"] == [1.0, 2.0, 1.0, 0.0, -1.0, 0.0, 1.0, 2.0, 1.0, 0.0]
    assert result["relations"][0]["target_slugs"] == ["punk"]
    assert calls[0]["ai_call"]["job_id"] == task_id
    assert calls[0]["ai_call"]["actor_id"] == curator["id"]


def test_worker_fails_closed_when_the_actor_lost_authority(
    monkeypatch, catalog, curator
):
    from crate.db.repositories.auth_user_roles import set_user_roles
    from crate.worker_handlers.ai_proposals import _handle_propose_genre_taxonomy_node

    pin_actions(monkeypatch)
    _model_must_not_run(monkeypatch)
    task_id, params = _queued_task(curator)
    set_user_roles(curator["id"], ["user"])

    result = _handle_propose_genre_taxonomy_node(task_id, params, {})

    assert result["status"] == "failed"
    assert result["error_code"] == "AI_AUTHORITY_REVOKED"


def test_worker_reports_a_genre_that_disappeared(monkeypatch, catalog, curator):
    from crate.worker_handlers.ai_proposals import _handle_propose_genre_taxonomy_node

    pin_actions(monkeypatch)
    _model_must_not_run(monkeypatch)
    monkeypatch.setattr(
        "crate.genre_taxonomy_proposals.get_genre_detail", lambda _: None
    )
    task_id, params = _queued_task(curator)
    catalog.pop("hardcore")

    result = _handle_propose_genre_taxonomy_node(task_id, params, {})

    assert result["status"] == "failed"
    assert "not found" in result["error"].lower()
