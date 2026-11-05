"""Artist hero candidate analysis runs in the ai queue (SMQ.PR5).

POST /api/artwork/artists/{id}/hero-candidates/analyze sent the candidate image
to the vision model inside the request (artwork.hero.analyze). It now answers
202 and the analysis arrives as the task result.
"""

from io import BytesIO

import pytest
from sqlalchemy import text

from crate.ai.contracts import AIConfigurationError
from tests.ai_consumer_fakes import pin_actions

ANALYSIS = {
    "summary": "Strong editorial fit with useful negative space.",
    "desktop": {
        "score": 92,
        "reason": "Faces remain clear.",
        "focal_x": 0.7,
        "focal_y": 0.4,
    },
    "mobile": {
        "score": 76,
        "reason": "Needs a tighter crop.",
        "focal_x": 0.5,
        "focal_y": 0.35,
    },
}


def _image() -> bytes:
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (2400, 1200), "gray").save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def candidate(monkeypatch):
    from crate.artist_hero_candidates import encode_candidate_token

    monkeypatch.setenv("JWT_SECRET", "hero-candidate-test-secret-0123456789")
    return encode_candidate_token(
        artist_id=7, origin="local-photo", reference="artist.jpg"
    )


@pytest.fixture
def no_dispatch(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: sent.append((task_type, task_id)),
    )
    return sent


def _analysis_tasks():
    from crate.db.tx import read_scope

    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT id, pool, params_json FROM tasks "
                    "WHERE type = 'analyze_artist_hero_candidate' ORDER BY created_at"
                )
            ).mappings()
        ]


def test_returns_202_and_enqueues_once(
    pg_db, test_app, monkeypatch, candidate, no_dispatch
):
    pin_actions(monkeypatch)
    monkeypatch.setattr("crate.api.artwork.artist_name_from_id", lambda _: "Converge")
    monkeypatch.setattr(
        "crate.artist_hero_candidates.ask_image_structured",
        lambda *a, **k: pytest.fail("the request must not call the model"),
    )
    path = "/api/artwork/artists/7/hero-candidates/analyze"

    first = test_app.post(path, json={"candidate": candidate})
    second = test_app.post(path, json={"candidate": candidate})

    assert first.status_code == 202, first.text
    assert first.json() == {
        "task_id": first.json()["task_id"],
        "status": "queued",
        "deduplicated": False,
    }
    assert second.status_code == 202, second.text
    assert second.json() == {**first.json(), "deduplicated": True}
    tasks = _analysis_tasks()
    assert len(tasks) == 1 and tasks[0]["pool"] == "ai"
    params = tasks[0]["params_json"]
    assert params["artist_id"] == 7
    assert params["candidate"] == candidate
    assert params["actor_user_id"] == 1
    assert params["ai_acceptance"]["action_id"] == "artwork.hero.analyze"
    assert no_dispatch == [("analyze_artist_hero_candidate", tasks[0]["id"])]


def test_a_rediscovered_candidate_joins_the_same_task(
    pg_db, test_app, monkeypatch, candidate, no_dispatch
):
    import crate.artist_hero_candidates as hero

    pin_actions(monkeypatch)
    monkeypatch.setattr("crate.api.artwork.artist_name_from_id", lambda _: "Converge")
    path = "/api/artwork/artists/7/hero-candidates/analyze"
    first = test_app.post(path, json={"candidate": candidate})

    # A later discovery signs the same image with a new expiry.
    now = hero.time.time()
    with monkeypatch.context() as later:
        later.setattr(hero.time, "time", lambda: now + 60)
        resigned = hero.encode_candidate_token(
            artist_id=7, origin="local-photo", reference="artist.jpg"
        )
    other = hero.encode_candidate_token(
        artist_id=7, origin="local-background", reference="background.jpg"
    )
    assert resigned != candidate

    again = test_app.post(path, json={"candidate": resigned})
    different = test_app.post(path, json={"candidate": other})

    assert again.json() == {**first.json(), "deduplicated": True}
    assert different.status_code == 202
    assert different.json()["task_id"] != first.json()["task_id"]
    assert len(_analysis_tasks()) == 2


def test_a_forged_candidate_is_rejected_before_queueing(
    pg_db, test_app, monkeypatch, candidate, no_dispatch
):
    pin_actions(monkeypatch)
    monkeypatch.setattr("crate.api.artwork.artist_name_from_id", lambda _: "Converge")

    response = test_app.post(
        "/api/artwork/artists/8/hero-candidates/analyze", json={"candidate": candidate}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Candidate not found"
    assert _analysis_tasks() == []
    assert no_dispatch == []


def test_unavailable_when_action_disabled(
    pg_db, test_app, monkeypatch, candidate, no_dispatch
):
    monkeypatch.setattr("crate.api.artwork.artist_name_from_id", lambda _: "Converge")

    def disabled(action_id, expected_fingerprint=None):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Action is disabled")

    monkeypatch.setattr("crate.ai.configuration.resolve_action", disabled)

    response = test_app.post(
        "/api/artwork/artists/7/hero-candidates/analyze", json={"candidate": candidate}
    )

    assert response.status_code == 503
    assert response.headers["X-Crate-Error"] == "AI_ACTION_DISABLED"
    assert _analysis_tasks() == []
    assert no_dispatch == []


@pytest.fixture
def editor(pg_db):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_roles import set_user_roles

    actor = create_user("hero-editor@example.test", role="editor")
    set_user_roles(actor["id"], ["editor"])
    return actor


def _params(editor, candidate):
    from crate.ai.consumers import accept_action

    return {
        "artist_id": 7,
        "candidate": candidate,
        "actor_user_id": editor["id"],
        "ai_acceptance": accept_action("artwork.hero.analyze"),
    }


@pytest.fixture
def artist_files(monkeypatch, tmp_path):
    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    (artist_dir / "artist.jpg").write_bytes(_image())
    monkeypatch.setattr(
        "crate.worker_handlers.ai_proposals.get_library_artist_by_id",
        lambda artist_id: {"id": artist_id, "name": "Converge"},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.ai_proposals.resolve_artist_dir",
        lambda root, artist, **kwargs: artist_dir,
    )
    return {"library_path": str(tmp_path)}


def test_worker_stores_analysis(monkeypatch, editor, candidate, artist_files):
    from crate import actors
    from crate.db.queries.tasks import get_task
    from crate.db.repositories.tasks import create_task

    pin_actions(monkeypatch)
    calls = []

    def analyze(model, prompt, **kwargs):
        calls.append(kwargs)
        return model.model_validate(ANALYSIS)

    monkeypatch.setattr("crate.artist_hero_candidates.ask_image_structured", analyze)
    monkeypatch.setattr("crate.db.events._publish_to_redis", lambda *a, **k: None)
    monkeypatch.setattr("crate.config.load_config", lambda: artist_files)
    monkeypatch.setattr(actors, "_check_memory", lambda: None)
    task_id = create_task(
        "analyze_artist_hero_candidate", _params(editor, candidate), dispatch=False
    )

    actors._execute_task("analyze_artist_hero_candidate", task_id)

    task = get_task(task_id)
    assert task["status"] == "completed", task.get("error")
    assert task["result"] == ANALYSIS
    assert len(calls) == 1
    assert calls[0]["action_id"] == "artwork.hero.analyze"
    assert calls[0]["job_id"] == task_id
    assert calls[0]["actor_id"] == editor["id"]
    assert calls[0]["image"] == _image()


def test_worker_reports_the_closed_error_code(
    monkeypatch, editor, candidate, artist_files
):
    from crate.worker_handlers.ai_proposals import (
        _handle_analyze_artist_hero_candidate,
    )

    pin_actions(monkeypatch)

    def fail(*args, **kwargs):
        raise AIConfigurationError(
            "AI_PROVIDER_FAILED", "Provider request could not be completed"
        )

    monkeypatch.setattr("crate.artist_hero_candidates.ask_image_structured", fail)

    result = _handle_analyze_artist_hero_candidate(
        "hero-job", _params(editor, candidate), artist_files
    )

    assert result == {
        "status": "failed",
        "error": "Provider request could not be completed",
        "error_code": "AI_PROVIDER_FAILED",
    }


def test_worker_rechecks_the_editor_before_the_call(
    monkeypatch, editor, candidate, artist_files
):
    from crate.db.repositories.auth_user_roles import set_user_roles
    from crate.worker_handlers.ai_proposals import (
        _handle_analyze_artist_hero_candidate,
    )

    pin_actions(monkeypatch)
    monkeypatch.setattr(
        "crate.artist_hero_candidates.ask_image_structured",
        lambda *a, **k: pytest.fail("a revoked editor must not reach the model"),
    )
    params = _params(editor, candidate)
    set_user_roles(editor["id"], ["user"])

    result = _handle_analyze_artist_hero_candidate("hero-job", params, artist_files)

    assert result["status"] == "failed"
    assert result["error_code"] == "AI_AUTHORITY_REVOKED"


def test_worker_fails_when_the_candidate_is_gone(
    monkeypatch, editor, candidate, artist_files, tmp_path
):
    from crate.worker_handlers.ai_proposals import (
        _handle_analyze_artist_hero_candidate,
    )

    pin_actions(monkeypatch)
    monkeypatch.setattr(
        "crate.artist_hero_candidates.ask_image_structured",
        lambda *a, **k: pytest.fail("a missing image must not reach the model"),
    )
    (tmp_path / "Converge" / "artist.jpg").unlink()

    result = _handle_analyze_artist_hero_candidate(
        "hero-job", _params(editor, candidate), artist_files
    )

    assert result == {"status": "failed", "error": "Candidate not found"}
