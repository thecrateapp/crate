"""Delegated DSP work requires the current human analysis capability."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from crate import auth
from crate.agent_diagnostics import DiagnosticError
from crate.api.mcp_oauth import router
from crate.db.repositories import mcp_oauth as store
from crate.db.repositories.agent_human_sessions import get_agent_human_session
from crate.db.repositories.agent_requests import _authorize
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.tx import transaction_scope

from tests.test_mcp_oauth_integration import (
    ISSUER,
    _code,
    _exchange,
    _parameters,
    oauth_env as oauth_env,  # noqa: PLC0414 — pytest fixture registration.
)


@pytest.mark.parametrize("role,status", [("editor", 400), ("librarian", 200)])
def test_analysis_consent_requires_current_analysis_management(oauth_env, role, status):
    actor = oauth_env
    set_user_roles(actor["id"], [role])
    fresh = get_agent_human_session(actor["id"], actor["session_id"])
    assert fresh["roles"] == [role]
    assert "library.metadata.write" in fresh["capabilities"]
    assert ("library.analysis.manage" in fresh["capabilities"]) == (role == "librarian")
    store.update_oauth_client("test-client", scopes=["library.analysis.run"])
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url=ISSUER) as client:
        # A stale admin claim cannot replace persisted current capabilities.
        client.cookies.set(
            "crate_session",
            auth.create_jwt(
                actor["id"], actor["email"], "admin", session_id=actor["session_id"]
            ),
        )
        response = client.get(
            "/oauth/authorize", params=_parameters(scope="library.analysis.run")
        )
    assert response.status_code == status, response.text
    if status == 400:
        assert response.json()["error"] == "invalid_scope"
    else:
        assert "library.analysis.run" in response.text


@pytest.mark.parametrize("boundary", ["token", "worker"])
def test_analysis_delegation_stops_after_downgrade_to_editor(oauth_env, boundary):
    actor = oauth_env
    store.update_oauth_client("test-client", scopes=["library.analysis.run"])
    exchanged = _exchange(_code(actor, scope="library.analysis.run"))
    assert exchanged[0] == 200, exchanged
    token = exchanged[1]["access_token"]
    principal = store.resolve_oauth_access_token(token)[0]
    with transaction_scope() as session:
        _authorize(session, principal, {"library.analysis.run"}, worker=True)

    set_user_roles(actor["id"], ["editor"])
    fresh = get_agent_human_session(actor["id"], actor["session_id"])
    assert "library.metadata.write" in fresh["capabilities"]
    assert "library.analysis.manage" not in fresh["capabilities"]
    if boundary == "token":
        assert store.resolve_oauth_access_token(token) is None
    else:
        # Queued work must reauthorize its durable delegation without a token.
        with pytest.raises(DiagnosticError) as denied, transaction_scope() as session:
            _authorize(session, principal, {"library.analysis.run"}, worker=True)
        assert denied.value.code == "FORBIDDEN"
