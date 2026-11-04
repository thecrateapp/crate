"""Genre EQ proposals run in the ai queue, never inside the request (SMQ.PR2)."""

from types import SimpleNamespace

import pytest
from sqlalchemy import text

from crate.ai.contracts import AIConfigurationError
from tests.ai_consumer_fakes import pin_actions


@pytest.fixture
def no_dispatch(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: sent.append((task_type, task_id)),
    )
    return sent


def _eq_tasks():
    from crate.db.tx import read_scope

    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT id, pool, params_json, dedup_key FROM tasks "
                    "WHERE type = 'propose_genre_eq' ORDER BY created_at"
                )
            ).mappings()
        ]


def test_returns_202_and_enqueues_once(pg_db, test_app, monkeypatch, no_dispatch):
    pin_actions(monkeypatch)
    monkeypatch.setattr("crate.api.genres.get_genre_taxonomy_node_id", lambda _: 7)
    monkeypatch.setattr(
        "crate.llm.prompts.eq_preset.generate_eq_preset",
        lambda **_: pytest.fail("the request must not call the model"),
    )

    first = test_app.post("/api/genres/post-hardcore/generate-eq")
    second = test_app.post("/api/genres/post-hardcore/generate-eq")

    assert first.status_code == 202, first.text
    assert second.status_code == 202, second.text
    assert first.json() == {
        "task_id": first.json()["task_id"],
        "status": "queued",
        "deduplicated": False,
    }
    assert second.json()["task_id"] == first.json()["task_id"]
    assert second.json()["deduplicated"] is True
    tasks = _eq_tasks()
    assert len(tasks) == 1
    assert tasks[0]["pool"] == "ai"
    params = tasks[0]["params_json"]
    assert params["slug"] == "post-hardcore"
    assert params["apply"] is False
    assert params["actor_user_id"] == 1
    assert params["ai_acceptance"]["action_id"] == "genres.eq.propose"
    assert no_dispatch == [("propose_genre_eq", tasks[0]["id"])]

    applied = test_app.post("/api/genres/post-hardcore/generate-eq?apply=true")
    assert applied.status_code == 202
    assert applied.json()["task_id"] != first.json()["task_id"]


def test_unavailable_when_action_disabled(pg_db, test_app, monkeypatch, no_dispatch):
    monkeypatch.setattr("crate.api.genres.get_genre_taxonomy_node_id", lambda _: 7)

    def disabled(action_id, expected_fingerprint=None):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Action is disabled")

    monkeypatch.setattr("crate.ai.configuration.resolve_action", disabled)

    response = test_app.post("/api/genres/post-hardcore/generate-eq")

    assert response.status_code == 503
    assert response.headers["X-Crate-Error"] == "AI_ACTION_DISABLED"
    assert _eq_tasks() == []
    assert no_dispatch == []


@pytest.fixture
def curator(pg_db):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_roles import set_user_roles

    actor = create_user("eq-curator@example.test", role="curator")
    set_user_roles(actor["id"], ["curator"])
    return actor


def _queued_task(monkeypatch, curator, *, apply=False):
    from crate.ai.consumers import accept_action
    from crate.db.repositories.genres_taxonomy_nodes import (
        upsert_genre_taxonomy_node,
    )
    from crate.db.repositories.tasks import create_task

    upsert_genre_taxonomy_node("post-hardcore", name="Post-Hardcore")
    params = {
        "slug": "post-hardcore",
        "apply": apply,
        "actor_user_id": curator["id"],
        "ai_acceptance": accept_action("genres.eq.propose"),
    }
    return create_task("propose_genre_eq", params, dispatch=False), params


def test_worker_stores_proposal(pg_db, monkeypatch, curator):
    from crate import actors
    from crate.db.queries.tasks import get_task

    pin_actions(monkeypatch)
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            gains=[14.0, 3.04, 0, 0, 0, 0, 0, 0, -2.0, -20.0],
            reasoning="Bright guitars, tight low end.",
        )

    monkeypatch.setattr("crate.llm.prompts.eq_preset.generate_eq_preset", generate)
    monkeypatch.setattr("crate.db.events._publish_to_redis", lambda *a, **k: None)
    monkeypatch.setattr("crate.config.load_config", lambda: {})
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    task_id, _ = _queued_task(monkeypatch, curator)

    actors._execute_task("propose_genre_eq", task_id)

    task = get_task(task_id)
    assert task["status"] == "completed", task.get("error")
    assert task["result"] == {
        "slug": "post-hardcore",
        "gains": [12.0, 3.0, 0, 0, 0, 0, 0, 0, -2.0, -12.0],
        "reasoning": "Bright guitars, tight low end.",
        "applied": False,
    }
    assert calls[0]["genre_name"] == "Post Hardcore"
    assert calls[0]["ai_call"]["job_id"] == task_id
    assert calls[0]["ai_call"]["actor_id"] == curator["id"]


def test_worker_applies_only_after_rechecking_the_actor(pg_db, monkeypatch, curator):
    from crate.db.repositories.auth_user_roles import set_user_roles
    from crate.worker_handlers.ai_proposals import _handle_propose_genre_eq

    pin_actions(monkeypatch)
    writes = []
    monkeypatch.setattr(
        "crate.worker_handlers.ai_proposals.set_genre_eq_gains",
        lambda *args, **kwargs: writes.append((args, kwargs)),
    )

    def generate(**kwargs):
        set_user_roles(curator["id"], ["user"])
        return SimpleNamespace(gains=[0.0] * 10, reasoning="Flat")

    monkeypatch.setattr("crate.llm.prompts.eq_preset.generate_eq_preset", generate)
    task_id, params = _queued_task(monkeypatch, curator, apply=True)

    result = _handle_propose_genre_eq(task_id, params, {})

    assert result["error_code"] == "AI_AUTHORITY_REVOKED"
    assert writes == []


def test_worker_applies_when_requested(pg_db, monkeypatch, curator):
    from crate.db.tx import read_scope
    from crate.worker_handlers.ai_proposals import _handle_propose_genre_eq

    pin_actions(monkeypatch)
    monkeypatch.setattr(
        "crate.llm.prompts.eq_preset.generate_eq_preset",
        lambda **_: SimpleNamespace(gains=[1.0] * 10, reasoning="Even lift"),
    )
    task_id, params = _queued_task(monkeypatch, curator, apply=True)

    result = _handle_propose_genre_eq(task_id, params, {})

    assert result["applied"] is True
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT eq_gains, eq_reasoning FROM genre_taxonomy_nodes "
                    "WHERE slug = 'post-hardcore'"
                )
            )
            .mappings()
            .one()
        )
    assert list(row["eq_gains"]) == [1.0] * 10
    assert row["eq_reasoning"] == "Even lift"
