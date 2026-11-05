"""Queueing an AI task never throws away a paid result (review M4).

When the duplicate of a request finishes between the dedup check and the
lookup of the active task, the route returns that finished task instead of an
error, so the client can read the result it already paid for.
"""

import pytest

from tests.ai_consumer_fakes import pin_actions


@pytest.fixture
def race(monkeypatch):
    """The dedup hit's task completed a moment before the active lookup."""
    import crate.api.ai_tasks as ai_tasks

    monkeypatch.setattr(ai_tasks, "create_task_dedup", lambda *a, **k: None)
    monkeypatch.setattr(
        ai_tasks, "find_active_task_by_type_params", lambda *a, **k: None
    )
    monkeypatch.setattr(
        ai_tasks,
        "find_latest_task_by_dedup_key",
        lambda task_type, dedup_key: {"id": "finished-task", "status": "completed"},
    )


def _system_playlist():
    from crate.db.repositories.playlists import create_playlist

    return create_playlist("Mix", scope="system", is_smart=True, smart_rules={})


@pytest.mark.parametrize("route", ["eq", "taxonomy", "playlist"])
def test_a_just_finished_duplicate_is_returned(
    pg_db, test_app, monkeypatch, race, route
):
    pin_actions(monkeypatch)
    monkeypatch.setattr("crate.api.genres.get_genre_taxonomy_node_id", lambda _: 7)
    monkeypatch.setattr(
        "crate.api.genres.node_proposal_input_fingerprint", lambda _: "f" * 64
    )
    path = {
        "eq": "/api/genres/hardcore/generate-eq",
        "taxonomy": "/api/genres/taxonomy/hardcore/proposal",
        "playlist": f"/api/admin/system-playlists/{_system_playlist()}/ai-description",
    }[route]

    response = test_app.post(path)

    assert response.status_code == 202, response.text
    assert response.json() == {
        "task_id": "finished-task",
        "status": "completed",
        "deduplicated": True,
    }


def test_latest_task_by_dedup_key(pg_db):
    from crate.db.queries.tasks import find_latest_task_by_dedup_key
    from crate.db.repositories.tasks import create_task_dedup, update_task

    first = create_task_dedup(
        "propose_genre_eq", {"slug": "a"}, dedup_key="k", dispatch=False
    )
    update_task(first, status="completed", result={"gains": []})

    assert find_latest_task_by_dedup_key("propose_genre_eq", "k") == {
        "id": first,
        "status": "completed",
    }
    assert find_latest_task_by_dedup_key("propose_genre_eq", "other") is None
