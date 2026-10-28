"""Integration administration requires a fresh human cookie authority."""

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.api.agent_guards import require_agent_admin_session
from crate.api.permissions import ROLE_CAPABILITIES
from crate.auth import create_jwt
from crate.db.repositories import agent_integrations as integrations
from crate.db.repositories.agent_credentials import resolve_credential
from crate.db.repositories.agent_human_sessions import get_agent_human_session
from crate.db.repositories.auth_sessions import create_session
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.repositories.auth_user_roles import set_user_roles
from crate.db.tx import read_scope, transaction_scope
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import text

ORIGIN = "https://admin.example.test"


@pytest.fixture
def human_actor(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "agent-admin-test-secret-at-least-32-bytes")
    monkeypatch.setenv("CRATE_MCP_ADMIN_ORIGINS", ORIGIN)
    user = create_user("operator@example.test", role="admin")
    sid = str(uuid4())
    create_session(
        sid, user["id"], datetime.now(UTC) + timedelta(days=1), app_id="admin-web"
    )
    user["session_id"] = sid
    return user


def human_token(actor, *, session=True):
    return create_jwt(
        actor["id"],
        actor["email"],
        "admin",
        session_id=actor["session_id"] if session else None,
    )


def human_request(
    actor,
    *,
    method="POST",
    headers=None,
    query="",
    cookie="crate_session",
    session=True,
):
    supplied = {
        "cookie": f"{cookie}={human_token(actor, session=session)}",
        "origin": ORIGIN,
        **(headers or {}),
    }
    return Request(
        {
            "type": "http",
            "method": method,
            "scheme": "https",
            "path": "/api/admin/agent-integrations",
            "query_string": query.encode(),
            "server": ("api.example.test", 443),
            "headers": [
                (key.lower().encode(), value.encode())
                for key, value in supplied.items()
            ],
        }
    )


def mutate(sql, params=None):
    with transaction_scope() as session:
        session.execute(text(sql), params or {})


@pytest.fixture
def admin_client(human_actor):
    from crate.api.agent_integrations import router

    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url="https://api.example.test") as client:
        client.cookies.set("crate_session", human_token(human_actor))
        client.headers["Origin"] = ORIGIN
        yield client


def test_guard_uses_fresh_database_roles_and_not_jwt_role(human_actor):
    set_user_roles(human_actor["id"], ["user", "ops"])
    request = human_request(human_actor)
    user = require_agent_admin_session(request, "ops.health.view")
    assert set(user["roles"]) == {"ops", "user"}
    assert "ops.health.view" in user["capabilities"]
    with pytest.raises(HTTPException) as caught:
        require_agent_admin_session(request, "agents.integrations.manage")
    assert caught.value.status_code == 403


def test_internal_human_show_proofs_are_not_managed_as_remote_integrations(human_actor):
    from crate.db.repositories.show_imports import get_show_editor_principal

    internal = get_show_editor_principal(human_actor["id"])
    assert integrations.list_integrations() == []
    with pytest.raises(DiagnosticError) as error:
        integrations.revoke_integration_credential(human_actor, internal.credential_id)
    assert error.value.code == "NOT_FOUND"


@pytest.mark.parametrize(
    "mutation",
    ["bearer", "remote", "token_query", "media_query", "listen_cookie", "sessionless"],
)
def test_guard_rejects_non_admin_cookie_provenance(human_actor, mutation):
    kwargs = {
        "bearer": {"headers": {"authorization": f"Bearer {human_token(human_actor)}"}},
        "remote": {"headers": {"remote-user": human_actor["email"]}},
        "token_query": {"query": "token=ignored"},
        "media_query": {"query": "media_ticket=ignored"},
        "listen_cookie": {"cookie": "crate_session_listen"},
        "sessionless": {"session": False},
    }[mutation]
    with pytest.raises(HTTPException) as caught:
        require_agent_admin_session(human_request(human_actor, **kwargs))
    assert caught.value.status_code == 401


@pytest.mark.parametrize("origin", ["https://attacker.test", "null", ""])
def test_guard_rejects_cross_origin_or_missing_origin_mutation(human_actor, origin):
    with pytest.raises(HTTPException) as caught:
        require_agent_admin_session(
            human_request(human_actor, headers={"origin": origin})
        )
    assert caught.value.status_code == 403


@pytest.mark.parametrize("mutation", ["suspended", "revoked", "expired", "wrong_owner"])
def test_guard_checks_live_user_and_session_state(human_actor, mutation):
    statements = {
        "suspended": "UPDATE users SET status='suspended' WHERE id=:id",
        "revoked": "UPDATE sessions SET revoked_at=NOW() WHERE id=:sid",
        "expired": "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:sid",
        "wrong_owner": "UPDATE sessions SET user_id=(SELECT id FROM users WHERE id<>:id LIMIT 1) WHERE id=:sid",
    }
    if mutation == "wrong_owner":
        create_user("another@example.test", role="user")
    mutate(
        statements[mutation],
        {"id": human_actor["id"], "sid": human_actor["session_id"]},
    )
    with pytest.raises(HTTPException) as caught:
        require_agent_admin_session(human_request(human_actor))
    assert caught.value.status_code == 401


def test_integration_secret_is_one_time_and_rotation_revokes_old_secret(human_actor):
    issued = integrations.create_integration(
        human_actor, name="Reader", grants=["library.health.read"]
    )
    principal = resolve_credential(issued["token"])
    assert principal.id == issued["principal_id"]
    listed = integrations.list_integrations()
    assert listed[0]["kind"] == "service"
    assert listed[0]["credentials"][0]["credential_id"] == issued["credential_id"]
    encoded = json.dumps(listed, default=str)
    assert issued["token"] not in encoded
    assert "token_digest" not in encoded
    rotated = integrations.rotate_integration_credential(
        human_actor, issued["credential_id"], expires_in_days=1
    )
    assert resolve_credential(issued["token"]) is None
    assert resolve_credential(rotated["token"]).id == principal.id
    assert integrations.revoke_integration_credential(
        human_actor, rotated["credential_id"]
    ) == {"revoked": True}
    assert resolve_credential(rotated["token"]) is None
    activity = integrations.read_integration_activity(principal.id)
    assert {row["action"] for row in activity} >= {
        "agent.integration.created",
        "agent.integration.rotated",
        "agent.integration.revoked",
    }
    assert all(
        raw not in json.dumps(activity, default=str)
        for raw in (issued["token"], rotated["token"])
    )


def test_integration_policy_update_is_compare_and_set_and_invalidates_access(
    human_actor,
):
    issued = integrations.create_integration(
        human_actor, name="Reader", grants=["library.health.read"]
    )
    updated = integrations.update_integration(
        human_actor,
        issued["principal_id"],
        expected_policy_revision=1,
        enabled=False,
        require_approval=True,
    )
    assert updated["policy_revision"] == 2
    assert resolve_credential(issued["token"]) is None
    with pytest.raises(DiagnosticError) as caught:
        integrations.update_integration(
            human_actor,
            issued["principal_id"],
            expected_policy_revision=1,
            enabled=True,
        )
    assert caught.value.code == "STATE_CONFLICT"
    assert integrations.list_integrations()[0]["enabled"] is False


def test_management_capability_does_not_delegate_absent_domain_permission(
    human_actor, monkeypatch
):
    monkeypatch.setitem(
        ROLE_CAPABILITIES,
        "ops",
        (*ROLE_CAPABILITIES["ops"], "agents.integrations.manage"),
    )
    set_user_roles(human_actor["id"], ["ops"])
    with pytest.raises(DiagnosticError) as caught:
        integrations.create_integration(
            human_actor, name="Escalation", grants=["library.repair.photo_flag"]
        )
    assert caught.value.code == "FORBIDDEN"
    assert integrations.list_integrations() == []
    issued = integrations.create_integration(
        human_actor, name="Operations", grants=["ops.status.read"]
    )
    with pytest.raises(DiagnosticError) as caught:
        integrations.update_integration(
            human_actor,
            issued["principal_id"],
            expected_policy_revision=1,
            grants=["library.repair.photo_flag"],
        )
    assert caught.value.code == "FORBIDDEN"
    assert resolve_credential(issued["token"]).grants == {"ops.status.read"}


def test_repository_revalidates_stale_actor_before_issuing_a_secret(human_actor):
    assert get_agent_human_session(human_actor["id"], human_actor["session_id"])
    mutate(
        "UPDATE sessions SET revoked_at=NOW() WHERE id=:id",
        {"id": human_actor["session_id"]},
    )
    with pytest.raises(DiagnosticError) as caught:
        integrations.create_integration(
            human_actor, name="Stale", grants=["library.health.read"]
        )
    assert caught.value.code == "FORBIDDEN"
    assert integrations.list_integrations() == []


def test_activity_is_principal_scoped_redacted_and_allowlisted(human_actor):
    first = integrations.create_integration(
        human_actor, name="First", grants=["library.health.read"]
    )
    second = integrations.create_integration(
        human_actor, name="Second", grants=["library.health.read"]
    )
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json)
            VALUES(NOW(),'agent.diagnostic','agent_principal',:id,CAST(:details AS jsonb))"""),
            {
                "id": first["principal_id"],
                "details": json.dumps(
                    {
                        "principal_id": first["principal_id"],
                        "tool": "token=secret-value",
                        "password": "hidden-password",
                        "arguments": {"path": "/secret/path"},
                        "result": {
                            "execution": {
                                "before": {"password": "unbounded-secret"},
                                "after": ["private-value"] * 1000,
                            }
                        },
                    }
                ),
            },
        )
    activity = integrations.read_integration_activity(first["principal_id"], limit=1)
    assert len(activity) == 1
    assert activity[0]["evidence"]["principal_id"] == first["principal_id"]
    assert activity[0]["evidence"]["before"] is None
    assert activity[0]["evidence"]["after"] is None
    serialized = json.dumps(activity, default=str)
    for hidden in (
        second["principal_id"],
        "secret-value",
        "hidden-password",
        "/secret/path",
        "arguments",
        "unbounded-secret",
        "private-value",
    ):
        assert hidden not in serialized
    assert "[redacted]" in serialized
    older = integrations.read_integration_activity(
        first["principal_id"], before=activity[0]["id"]
    )
    assert all(row["id"] < activity[0]["id"] for row in older)
    with read_scope() as session:
        audit = session.execute(
            text(
                "SELECT user_id FROM audit_log WHERE action='agent.integration.created' AND target_name=:id"
            ),
            {"id": first["principal_id"]},
        ).scalar_one()
    assert audit == human_actor["id"]


def test_list_integrations_has_bounded_stable_keyset(human_actor):
    for index in range(3):
        integrations.create_integration(
            human_actor, name=f"Reader {index}", grants=["library.health.read"]
        )
    first = integrations.list_integrations(limit=2)
    rest = integrations.list_integrations(limit=2, before=first[-1]["principal_id"])
    assert len(first) == 2 and len(rest) == 1
    assert len({row["principal_id"] for row in [*first, *rest]}) == 3


def test_admin_http_provision_rotation_listing_and_conflict_contract(admin_client):
    base = "/api/admin/agent-integrations"
    created = admin_client.post(
        base, json={"name": "HTTP reader", "grants": ["library.health.read"]}
    )
    assert created.status_code == 200, created.text
    issued = created.json()
    assert resolve_credential(issued["token"])
    listed = admin_client.get(base)
    assert listed.status_code == 200
    assert set(listed.json()) == {"items", "next_cursor"}
    assert issued["token"] not in listed.text and "token_digest" not in listed.text
    catalog = admin_client.get(f"{base}/catalog")
    assert catalog.status_code == 200
    assert all(scope["can_grant"] for scope in catalog.json()["scopes"])
    assert catalog.json()["limits"]["active_maintenance_jobs"] == 1
    changed = admin_client.patch(
        f"{base}/{issued['principal_id']}",
        json={"expected_policy_revision": 1, "require_approval": True},
    )
    assert changed.status_code == 200
    assert changed.json()["policy_revision"] == 2
    conflict = admin_client.patch(
        f"{base}/{issued['principal_id']}",
        json={"expected_policy_revision": 1, "enabled": False},
    )
    assert conflict.status_code == 409
    assert conflict.headers["X-Crate-Error"] == "STATE_CONFLICT"
    rotated = admin_client.post(
        f"{base}/credentials/{issued['credential_id']}/rotate",
        json={"expires_in_days": 1},
    )
    assert rotated.status_code == 200
    assert resolve_credential(issued["token"]) is None
    assert resolve_credential(rotated.json()["token"])
    activity = admin_client.get(f"{base}/{issued['principal_id']}/activity?limit=1")
    assert activity.status_code == 200
    assert len(activity.json()["items"]) == 1
    assert activity.json()["next_cursor"]
    revoked = admin_client.post(
        f"{base}/credentials/{rotated.json()['credential_id']}/revoke"
    )
    assert revoked.json() == {"revoked": True}
    assert resolve_credential(rotated.json()["token"]) is None


def test_catalog_serves_permission_details_and_presets(admin_client):
    base = "/api/admin/agent-integrations"
    catalog = admin_client.get(f"{base}/catalog")
    assert catalog.status_code == 200, catalog.text
    body = catalog.json()

    group_ids = {group["id"] for group in body["scope_groups"]}
    for group in body["scope_groups"]:
        assert set(group) == {"id", "label"}
    for scope in body["scopes"]:
        assert scope["label"]
        assert scope["group"] in group_ids
        assert scope["access"] in {"read", "change"}

    by_scope = {scope["scope"]: scope for scope in body["scopes"]}
    assert by_scope["curation.shows.read"]["label"] == "Read upcoming shows"

    assert [preset["id"] for preset in body["presets"]] == [
        "read_only",
        "shows_curator",
        "editorial_curator",
        "library_maintainer",
        "crate_agent",
        "crate_operator",
    ]
    for preset in body["presets"]:
        assert set(preset) == {"id", "label", "description", "scopes"}


def test_catalog_mcp_url_comes_from_the_oauth_issuer(admin_client, monkeypatch):
    base = "/api/admin/agent-integrations"
    monkeypatch.delenv("CRATE_MCP_OAUTH_ALLOW_LOCALHOST", raising=False)

    monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", "https://api.example.test")
    secure = admin_client.get(f"{base}/catalog")
    assert secure.status_code == 200
    assert secure.json()["mcp_url"] == "https://api.example.test/mcp"

    monkeypatch.setenv("CRATE_MCP_OAUTH_ISSUER", "http://insecure.example.test")
    insecure = admin_client.get(f"{base}/catalog")
    assert insecure.status_code == 200
    assert insecure.json()["mcp_url"] is None

    monkeypatch.delenv("CRATE_MCP_OAUTH_ISSUER", raising=False)
    unset = admin_client.get(f"{base}/catalog")
    assert unset.status_code == 200
    assert unset.json()["mcp_url"] is None


@pytest.mark.parametrize(
    "mutation,expected",
    [
        ("bearer", 401),
        ("cross_origin", 403),
        ("unknown_field", 422),
        ("unknown_grant", 400),
        ("unbounded_limit", 422),
    ],
)
def test_admin_http_rejects_invalid_authority_and_closed_inputs(
    admin_client, human_actor, mutation, expected
):
    base = "/api/admin/agent-integrations"
    body = {"name": "HTTP reader", "grants": ["library.health.read"]}
    headers = {}
    if mutation == "bearer":
        headers["Authorization"] = f"Bearer {human_token(human_actor)}"
    elif mutation == "cross_origin":
        headers["Origin"] = "https://attacker.test"
    elif mutation == "unknown_field":
        body["admin"] = True
    elif mutation == "unknown_grant":
        body["grants"] = ["library.repair.any"]
    if mutation == "unbounded_limit":
        response = admin_client.get(f"{base}?limit=101")
    else:
        response = admin_client.post(base, json=body, headers=headers)
    assert response.status_code == expected, response.text
    assert integrations.list_integrations() == []


def test_detail_bounds_credential_and_authorization_history(human_actor):
    from crate.db.repositories.mcp_oauth import register_oauth_client

    issued = integrations.create_integration(
        human_actor, name="Long lived", grants=["library.health.read"]
    )
    current = issued
    for _ in range(21):
        current = integrations.rotate_integration_credential(
            human_actor, current["credential_id"]
        )
    register_oauth_client(
        "history-client",
        "History",
        ["https://agent.test/callback"],
        {"library.health.read"},
    )
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO mcp_oauth_authorizations
            (id,user_id,client_id,issuer,resource,principal_id,credential_id,scopes,revoked_at)
            VALUES(:id,:user,'history-client','https://api.example.test','https://api.example.test/mcp',:principal,:credential,
                   ARRAY['library.health.read'],:revoked)"""),
            [
                {
                    "id": str(uuid4()),
                    "user": human_actor["id"],
                    "principal": issued["principal_id"],
                    "credential": current["credential_id"],
                    "revoked": None if number == 21 else datetime.now(UTC),
                }
                for number in range(22)
            ],
        )
    detail = integrations.get_integration(issued["principal_id"])
    assert detail["principal_id"] == issued["principal_id"]
    assert len(detail["credentials"]) == len(detail["authorizations"]) == 20
    assert detail["credentials_truncated"] is detail["authorizations_truncated"] is True
    assert current["credential_id"] in {
        item["credential_id"] for item in detail["credentials"]
    }
    assert any(item["revoked_at"] is None for item in detail["authorizations"])
    encoded = json.dumps(detail, default=str)
    assert issued["token"] not in encoded and current["token"] not in encoded
    assert "token_digest" not in encoded


def test_activity_cursor_uses_timestamp_then_id_and_is_principal_bound(human_actor):
    issued = integrations.create_integration(
        human_actor, name="First", grants=["library.health.read"]
    )
    other = integrations.create_integration(
        human_actor, name="Other", grants=["library.health.read"]
    )
    mutate(
        "DELETE FROM audit_log WHERE details_json->>'principal_id'=:principal",
        {"principal": issued["principal_id"]},
    )
    with transaction_scope() as session:
        for age, action in ((30, "older"), (10, "newer"), (20, "middle")):
            session.execute(
                text("""INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json)
                VALUES(:timestamp,:action,'agent_principal',:principal,CAST(:details AS jsonb))"""),
                {
                    "timestamp": datetime.now(UTC) - timedelta(seconds=age),
                    "action": action,
                    "principal": issued["principal_id"],
                    "details": json.dumps({"principal_id": issued["principal_id"]}),
                },
            )
    first = integrations.read_integration_activity(issued["principal_id"], limit=1)[0]
    second = integrations.read_integration_activity(
        issued["principal_id"], limit=1, before=first["id"]
    )[0]
    assert first["action"] == "newer"
    assert second["action"] == "middle"
    assert second["id"] > first["id"]
    assert (
        integrations.read_integration_activity(
            other["principal_id"], before=first["id"]
        )
        == []
    )


def test_admin_http_secrets_and_metadata_are_not_cacheable(admin_client):
    base = "/api/admin/agent-integrations"
    created = admin_client.post(
        base, json={"name": "No store", "grants": ["library.health.read"]}
    )
    assert created.status_code == 200
    assert created.headers["Cache-Control"] == "no-store"
    principal = created.json()["principal_id"]
    for path in (
        base,
        f"{base}/catalog",
        f"{base}/{principal}",
        f"{base}/{principal}/activity",
    ):
        response = admin_client.get(path)
        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "no-store"
        assert created.json()["token"] not in response.text
