"""Playlist descriptions are generated in the ai queue, never inside the request
(SMQ.PR3)."""

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


@pytest.fixture
def system_playlist(pg_db):
    from crate.db.repositories.playlists import create_playlist

    return create_playlist(
        "Late Night Screamo",
        description="Old copy",
        scope="system",
        is_smart=True,
        smart_rules={"match": "all", "rules": [{"field": "genre", "op": "eq"}]},
    )


def _description_tasks():
    from crate.db.tx import read_scope

    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT id, pool, params_json FROM tasks "
                    "WHERE type = 'generate_playlist_description' ORDER BY created_at"
                )
            ).mappings()
        ]


def test_returns_202_and_enqueues_once(
    test_app, monkeypatch, no_dispatch, system_playlist
):
    pin_actions(monkeypatch)
    monkeypatch.setattr(
        "crate.llm.prompts.playlist_description.generate_playlist_description",
        lambda **_: pytest.fail("the request must not call the model"),
    )
    path = f"/api/admin/system-playlists/{system_playlist}/ai-description"
    rules = {"match": "all", "rules": [{"field": "year", "op": "gte", "value": "2000"}]}

    first = test_app.post(path, json={"apply": False, "smart_rules": rules})
    second = test_app.post(path, json={"apply": False, "smart_rules": rules})

    assert first.status_code == 202, first.text
    assert first.json()["status"] == "queued"
    assert first.json()["deduplicated"] is False
    assert second.status_code == 202
    assert second.json()["task_id"] == first.json()["task_id"]
    assert second.json()["deduplicated"] is True
    tasks = _description_tasks()
    assert len(tasks) == 1
    assert tasks[0]["pool"] == "ai"
    params = tasks[0]["params_json"]
    assert params["playlist_id"] == system_playlist
    assert params["smart_rules"] == rules
    assert params["apply"] is False
    assert params["actor_user_id"] == 1
    assert params["ai_acceptance"]["action_id"] == "playlists.description.generate"
    assert no_dispatch == [("generate_playlist_description", tasks[0]["id"])]

    edited = test_app.post(
        path,
        json={"apply": False, "smart_rules": {**rules, "limit": 10}},
    )
    assert edited.json()["task_id"] != first.json()["task_id"]


def test_unknown_playlist_is_rejected_before_acceptance(test_app, pg_db, no_dispatch):
    response = test_app.post("/api/admin/system-playlists/999999/ai-description")
    assert response.status_code == 404
    assert _description_tasks() == []


def test_unavailable_when_action_disabled(
    test_app, monkeypatch, no_dispatch, system_playlist
):
    def disabled(action_id, expected_fingerprint=None):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Action is disabled")

    monkeypatch.setattr("crate.ai.configuration.resolve_action", disabled)

    response = test_app.post(
        f"/api/admin/system-playlists/{system_playlist}/ai-description"
    )

    assert response.status_code == 503
    assert response.headers["X-Crate-Error"] == "AI_ACTION_DISABLED"
    assert _description_tasks() == []


@pytest.fixture
def curator(pg_db):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_roles import set_user_roles

    actor = create_user("playlist-curator@example.test", role="curator")
    set_user_roles(actor["id"], ["curator"])
    return actor


def _queued_task(curator, playlist_id, *, apply=False, smart_rules=None):
    from crate.ai.consumers import accept_action
    from crate.db.repositories.tasks import create_task

    params = {
        "playlist_id": playlist_id,
        "smart_rules": smart_rules,
        "apply": apply,
        "actor_user_id": curator["id"],
        "ai_acceptance": accept_action("playlists.description.generate"),
    }
    return create_task("generate_playlist_description", params, dispatch=False), params


def test_worker_stores_description(monkeypatch, curator, system_playlist):
    from crate import actors
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.playlists import get_playlist

    pin_actions(monkeypatch)
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(description="Ragged, tender and very loud.")

    monkeypatch.setattr(
        "crate.llm.prompts.playlist_description.generate_playlist_description",
        generate,
    )
    monkeypatch.setattr("crate.db.events._publish_to_redis", lambda *a, **k: None)
    monkeypatch.setattr("crate.config.load_config", lambda: {})
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    draft_rules = {"match": "any", "rules": []}
    task_id, _ = _queued_task(curator, system_playlist, smart_rules=draft_rules)

    actors._execute_task("generate_playlist_description", task_id)

    task = get_task(task_id)
    assert task["status"] == "completed", task.get("error")
    assert task["result"] == {
        "playlist_id": system_playlist,
        "description": "Ragged, tender and very loud.",
        "applied": False,
    }
    assert calls[0]["name"] == "Late Night Screamo"
    assert calls[0]["smart_rules"] == draft_rules
    assert calls[0]["ai_call"]["job_id"] == task_id
    assert get_playlist(system_playlist)["description"] == "Old copy"


def test_worker_applies_when_requested(monkeypatch, curator, system_playlist):
    from crate.db.repositories.playlists import get_playlist
    from crate.worker_handlers.ai_proposals import (
        _handle_generate_playlist_description,
    )

    pin_actions(monkeypatch)
    monkeypatch.setattr(
        "crate.llm.prompts.playlist_description.generate_playlist_description",
        lambda **_: SimpleNamespace(description="New copy"),
    )
    task_id, params = _queued_task(curator, system_playlist, apply=True)

    result = _handle_generate_playlist_description(task_id, params, {})

    assert result["applied"] is True
    assert get_playlist(system_playlist)["description"] == "New copy"


def test_worker_rejects_a_playlist_that_is_no_longer_system(
    monkeypatch, curator, system_playlist
):
    from crate.db.repositories.playlists import update_playlist
    from crate.worker_handlers.ai_proposals import (
        _handle_generate_playlist_description,
    )

    pin_actions(monkeypatch)
    monkeypatch.setattr(
        "crate.llm.prompts.playlist_description.generate_playlist_description",
        lambda **_: pytest.fail("no model call for a missing playlist"),
    )
    task_id, params = _queued_task(curator, system_playlist)
    update_playlist(system_playlist, scope="user")

    result = _handle_generate_playlist_description(task_id, params, {})

    assert result["status"] == "failed"
