"""Cookie-authenticated Admin show review uses the common plan/job engine."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from crate.auth import create_jwt
from crate.db.repositories.auth_sessions import create_session
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.repositories.tasks_updates import start_task
from crate.agent_library_operations import execute_operation_job


@pytest.fixture
def editor_client(pg_db, monkeypatch):
    from crate.api.show_imports import router

    monkeypatch.setenv("JWT_SECRET", "show-import-api-test-secret-at-least-32-bytes")
    monkeypatch.setenv("CRATE_MCP_ENABLED", "false")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    user = create_user("curator@example.test", role="curator")
    sid = str(uuid4())
    create_session(
        sid, user["id"], datetime.now(UTC) + timedelta(days=1), app_id="admin-web"
    )
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url="http://localhost:8585") as client:
        client.cookies.set(
            "crate_session",
            create_jwt(user["id"], user["email"], "admin", session_id=sid),
        )
        client.headers["Origin"] = "http://localhost:5173"
        yield client, user


def body(**changes):
    return {
        "idempotency_key": "manual-preview",
        "candidates": [
            {
                "item_id": "manual-1",
                "artist_name": "External Band",
                "date": "2027-03-02",
                "venue": "Sala Norte",
                "city": "Madrid",
                **changes,
            }
        ],
    }


def finish(job_id):
    start_task(job_id)
    return execute_operation_job(job_id, {})


def test_curator_prepares_reviews_and_saves_manual_show_without_llm(editor_client):
    client, _ = editor_client
    response = client.post("/api/show-imports/plans", json=body())
    assert response.status_code == 202, response.text
    assert response.headers["cache-control"] == "no-store"
    job_id = response.json()["job_id"]
    finish(job_id)
    prepared = client.get(f"/api/show-imports/jobs/{job_id}").json()["result"]["plan"]
    plan = client.get(f"/api/show-imports/plans/{prepared['plan_id']}")
    assert plan.status_code == 200
    assert plan.json()["changes"][0]["after"]["date"] == "2027-03-02"
    assert plan.json()["changes"][0]["after"].get("local_time") is None
    applied = client.post(
        f"/api/show-imports/plans/{prepared['plan_id']}/apply",
        json={
            "plan_version": prepared["plan_version"],
            "idempotency_key": "manual-apply",
        },
    )
    assert applied.status_code == 202, applied.text
    finish(applied.json()["job_id"])
    result = client.get(f"/api/show-imports/jobs/{applied.json()['job_id']}").json()
    assert result["result"]["execution"]["items"][0]["status"] == "created"
    assert result["result"]["execution"]["items"][0]["show_id"] > 0


@pytest.mark.parametrize("mutation", ["no_cookie", "bearer", "cross_origin", "role"])
def test_show_editor_enforces_cookie_origin_and_current_capability(
    editor_client, mutation
):
    client, user = editor_client
    if mutation == "no_cookie":
        client.cookies.clear()
    elif mutation == "bearer":
        client.headers["Authorization"] = "Bearer any-agent-token"
    elif mutation == "cross_origin":
        client.headers["Origin"] = "https://attacker.test"
    else:
        set_user_roles(user["id"], ["user"])
    response = client.post("/api/show-imports/plans", json=body())
    assert response.status_code == (401 if mutation in {"no_cookie", "bearer"} else 403)


def test_manual_correction_requires_a_fresh_exact_preview(editor_client):
    client, _ = editor_client
    accepted = client.post("/api/show-imports/plans", json=body()).json()
    prepared = finish(accepted["job_id"])["plan"]
    response = client.post(
        f"/api/show-imports/plans/{prepared['plan_id']}/apply",
        json={"plan_version": "0" * 64, "idempotency_key": "wrong-version"},
    )
    assert response.status_code == 409
    assert (
        client.post(
            "/api/show-imports/plans", json={**body(), "free_dispatch": True}
        ).status_code
        == 422
    )
