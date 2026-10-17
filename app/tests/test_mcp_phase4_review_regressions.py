"""Regressions found by the phase-four specification/security review."""

from contextlib import nullcontext
import json
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from crate.agent_access import ALLOWED_GRANTS
from crate.agent_diagnostics import DiagnosticError
from crate.api.schemas.agents import (
    IntegrationCreate,
    IntegrationUpdate,
    OAuthClientCreate,
    OAuthClientUpdate,
)
from crate.db.queries.tasks import get_task
from crate.db.repositories.agent_plans import get_owned_plan
from crate.db.tx import read_scope
from crate.db.tx import transaction_scope

from tests.test_agent_library_operations import (
    operation_world as operation_world,
    _prepared,
)
from tests.test_agent_plan_approvals import decide
from tests.test_agent_metadata_portability import (
    portable_world as portable_world,
    _run_export,
    _sidecar,
    _payload,
    _compile_import,
    _authorize,
)

pytest_plugins = [
    "tests.agent_command_fixtures",
    "tests.test_agent_admin",
    "tests.test_mcp_oauth_integration",
]


@pytest.mark.parametrize(
    "model,values",
    [
        (IntegrationCreate, {"name": "Complete catalog"}),
        (IntegrationUpdate, {"expected_policy_revision": 1}),
        (
            OAuthClientCreate,
            {
                "client_id": "complete",
                "name": "Complete",
                "redirect_uris": ["https://client.example/callback"],
            },
        ),
        (OAuthClientUpdate, {"client_id": "complete"}),
    ],
)
def test_admin_can_configure_all_current_grants(model, values):
    field = "grants" if model in {IntegrationCreate, IntegrationUpdate} else "scopes"
    validated = model.model_validate({**values, field: sorted(ALLOWED_GRANTS)})
    assert set(getattr(validated, field)) == ALLOWED_GRANTS


def test_portable_release_type_list_roundtrips_in_jsonb(portable_world):
    from crate import agent_portability

    payload = _payload(portable_world)
    payload["album"]["release_group_secondary_types"] = ["live", "compilation"]
    _sidecar(portable_world, payload)
    plan = _compile_import(portable_world, conflict_policy="replace_unlocked")
    result = agent_portability.apply_operation(
        "metadata_rehydrate",
        plan["execution"],
        portable_world["config"],
        task_id="release-type-import",
        authorize=_authorize,
    )
    assert result["verification"]["status"] == "passed"
    with read_scope() as session:
        actual = session.execute(
            text(
                "SELECT release_group_secondary_types FROM library_albums WHERE id=:id"
            ),
            {"id": portable_world["album_id"]},
        ).scalar_one()
    assert actual == ["live", "compilation"]


def test_full_api_auth_chain_allows_only_dedicated_artifact_bearer(
    portable_world, monkeypatch
):
    from crate.api import create_app

    _, result = _run_export(portable_world)
    artifact = result["execution"]["artifacts"][0]
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    monkeypatch.setattr("crate.mcp.artifacts.admission", lambda *_: nullcontext())
    human_resolver = Mock(
        side_effect=AssertionError("Machine resources must not resolve human sessions")
    )
    monkeypatch.setattr(
        "crate.api.auth.AuthMiddleware._resolve_token_user", human_resolver
    )
    client = TestClient(create_app(), base_url="http://localhost:8585")
    headers = {"Authorization": f"Bearer {portable_world['token']}"}
    assert client.get(artifact["download_path"], headers=headers).status_code == 200
    assert (
        client.get("/api/auth/me", headers=headers).json()["error"]
        == "MCP_CREDENTIAL_WRONG_RESOURCE"
    )
    assert (
        client.get(
            artifact["download_path"],
            headers={**headers, "Cookie": "crate_token=human"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            artifact["download_path"] + "?token=extra", headers=headers
        ).status_code
        == 401
    )
    assert (
        client.get(
            artifact["download_path"],
            headers={**headers, "Remote-User": "admin@example.test"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            artifact["download_path"],
            headers={"Authorization": "Bearer human.jwt.invalid"},
        ).status_code
        == 401
    )
    human_resolver.assert_not_called()


def test_generic_task_surfaces_never_publish_exact_owned_plan_values(operation_world):
    from crate.worker_handlers.agent_library import _handle_agent_maintenance

    secret_metadata = "https://artist.example/private-value" + "x" * 2500
    operation_world["adapter"]["compiled"]["document"]["changes"][0]["after"] = (
        secret_metadata
    )
    plan = _prepared(operation_world)
    task = get_task(operation_world["dispatched"][-1][1])
    assert task is not None
    assert "plan" not in task["result"]
    assert secret_metadata not in str(task["result"])
    assert (
        get_owned_plan(operation_world["principal"], plan["plan_id"])["changes"][0][
            "after"
        ]
        == secret_metadata
    )
    public = _handle_agent_maintenance(operation_world["dispatched"][-1][1], {}, {})
    assert public["execution"]["plan_id"] == plan["plan_id"]
    assert "plan" not in public and secret_metadata not in str(public)


def test_manual_plan_can_be_rejected_but_cannot_be_approved(
    operation_world, human_actor
):
    operation_world["adapter"]["compiled"]["document"].update(
        executable=False, risk="destructive"
    )
    plan = _prepared(operation_world)
    with pytest.raises(DiagnosticError) as denied:
        decide(human_actor, plan)
    assert denied.value.code == "NOT_EXECUTABLE"
    assert decide(human_actor, plan, "rejected")["state"] == "rejected"


@pytest.mark.parametrize(
    "prepare_options,pipeline",
    [
        pytest.param({}, "analysis", id="legacy-default"),
        pytest.param({"pipeline": "bliss"}, "bliss", id="bliss"),
    ],
)
def test_analysis_planned_generation_is_not_submitted_until_it_is_requeued(
    pg_db, tmp_path, prepare_options, pipeline
):
    from crate.agent_analysis import get_analysis_status
    from tests.test_agent_analysis_sync import (
        TestExactAnalysisOperations as AnalysisFixture,
    )

    _, _, plan = AnalysisFixture()._prepare(pg_db, tmp_path, **prepare_options)
    result = get_analysis_status(references=plan["execution"]["references"])
    assert result["status"] == "not_submitted"
    assert result["verification"]["status"] == "not_started"
    assert result["items"][0]["status"] == "not_submitted"
    assert result["items"][0]["pipeline"] == pipeline


def test_sync_does_not_reintroduce_quarantined_albums_into_artist_summary(
    pg_db, tmp_path, monkeypatch
):
    from crate.agent_sync import apply_operation
    from tests.test_agent_analysis_sync import TestExactSyncOperations as SyncFixture

    _, album, config, plan = SyncFixture()._prepare(pg_db, tmp_path, monkeypatch)
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO library_albums(artist,name,path,track_count,total_size,formats_json,quarantined_at)
            VALUES(:artist,'Hidden copy','/music/hidden-copy',999,999999,'["mp3"]'::jsonb,NOW())"""),
            {"artist": album["artist"]},
        )
    result = apply_operation(
        "library_sync",
        plan["execution"],
        config,
        task_id="sync-after-quarantine",
        authorize=_authorize,
    )
    assert result["verification"]["status"] == "passed"
    with read_scope() as session:
        counts = (
            session.execute(
                text(
                    "SELECT album_count,track_count,formats_json FROM library_artists WHERE name=:artist"
                ),
                {"artist": album["artist"]},
            )
            .mappings()
            .one()
        )
    assert counts["album_count"] == 1
    assert counts["track_count"] == 1
    assert counts["formats_json"] == ["flac"]


def test_quality_pages_with_long_unicode_paths_fit_the_transport_budget(monkeypatch):
    from crate.agent_discovery import get_library_quality
    from tests.test_agent_quality import _record

    record = _record(
        items=[
            {
                "path": "Artist/Album/" + "音" * 800 + str(index),
                "reason": "metadata only",
            }
            for index in range(100)
        ],
        total=100,
    )
    monkeypatch.setattr(
        "crate.agent_quality.read_quality_report_snapshot", lambda **_: record
    )
    result = get_library_quality(category="corrupt", limit=100)
    assert len(json.dumps(result, ensure_ascii=False).encode()) < 60000
    assert 0 < result["returned_count"] < 100
    assert result["next_cursor"]
