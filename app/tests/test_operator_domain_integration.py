"""Real PostgreSQL, native decision/admission and existing worker authority boundary."""

import pytest
from crate import agent_library_operations as operations
from crate import operator_provenance as provenance
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_telegram as store
from crate.db.repositories.tasks_updates import start_task
from crate.worker_handlers.agent_library import _handle_agent_maintenance

from tests import test_agent_library_operations as operation_fixtures
from tests.agent_command_fixtures import change, scalar
from tests.test_agent_library_operations import _apply, _prepared
from tests.test_agent_telegram import button, show_all
from tests.test_operator_provenance import drift, evidence

operation_world = operation_fixtures.operation_world

pytest_plugins = [
    "tests.agent_command_fixtures",
    "tests.test_agent_admin",
    "tests.test_mcp_actions",
]


@pytest.fixture
def operator_world(operation_world, human_actor, tmp_path, monkeypatch):
    world = operation_world
    monkeypatch.setenv("CRATE_OPERATOR_PRINCIPAL_IDS", world["principal"].id)
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "test-instance")
    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    evidence(tmp_path)
    change(
        "UPDATE agent_principals SET require_approval=TRUE WHERE id=:id",
        {"id": world["principal"].id},
    )
    store.bind_human(human_actor, world["principal"].id, 123)
    plan = _prepared(world)
    assert plan["operator_provenance"] == provenance.current_identity()
    return {**world, "plan": plan, "evidence": tmp_path}


@pytest.mark.parametrize(
    "mode",
    ["missing", "stale", "rollback", "deploying", "unverified", "context", "identity"],
)
def test_present_then_drift_denies_native_button_admission(operator_world, mode):
    confirmation, message = show_all(operator_world)
    drift(operator_world["evidence"], mode)
    with pytest.raises(DiagnosticError):
        button(confirmation["confirmation_id"], message, "approve")
    assert scalar("SELECT count(*) FROM agent_jobs") == 1
    assert scalar("SELECT count(*) FROM agent_plan_approvals") == 0
    assert operator_world["adapter"]["effects"] == []


@pytest.mark.parametrize(
    "mode",
    ["missing", "stale", "rollback", "deploying", "unverified", "context", "identity"],
)
def test_approved_queued_then_drift_existing_worker_never_effects(operator_world, mode):
    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    drift(operator_world["evidence"], mode)
    start_task(result["job"]["job_id"])
    outcome = _handle_agent_maintenance(
        result["job"]["job_id"], {}, operator_world["config"]
    )
    assert outcome["execution"]["error_code"] == "EVIDENCE_STALE"
    assert operator_world["adapter"]["effects"] == []
    assert (
        operations.execute_operation_job(
            result["job"]["job_id"], operator_world["config"]
        )["execution"]["error_code"]
        == "EVIDENCE_STALE"
    )


def test_same_identity_refresh_native_approval_then_worker_effect_and_verification(
    operator_world,
):
    confirmation, message = show_all(operator_world)
    evidence(operator_world["evidence"])
    result = button(confirmation["confirmation_id"], message, "approve")
    evidence(operator_world["evidence"])
    start_task(result["job"]["job_id"])
    outcome = _handle_agent_maintenance(
        result["job"]["job_id"], {}, operator_world["config"]
    )
    assert outcome["execution"]["status"] == "completed"
    assert outcome["verification"]["status"] == "passed"
    assert len(operator_world["adapter"]["effects"]) == 1


def test_authority_rechecked_at_actual_effect_after_adapter_started(operator_world):
    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    operator_world["adapter"]["before_effect"] = lambda: drift(
        operator_world["evidence"], "identity"
    )
    start_task(result["job"]["job_id"])
    outcome = _handle_agent_maintenance(
        result["job"]["job_id"], {}, operator_world["config"]
    )
    assert outcome["execution"]["error_code"] == "EVIDENCE_STALE"
    assert operator_world["adapter"]["effects"] == []


def test_direct_prepare_for_configured_principal_cannot_drop_provenance(operator_world):
    drift(operator_world["evidence"], "missing")
    with pytest.raises(DiagnosticError):
        operations.prepare_operation(
            operator_world["principal"], "metadata_update", {}, "direct-bypass"
        )
    with pytest.raises(DiagnosticError):
        _apply(operator_world, operator_world["plan"])
    assert scalar("SELECT count(*) FROM agent_jobs") == 1


def test_actual_sdk_direct_mutation_cannot_omit_server_provenance(
    operator_world, action_transport
):
    import asyncio

    from tests.test_mcp_actions import _client

    app, token, _principal, credentials, _admission = action_transport
    credentials[token] = operator_world["principal"]

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client, _ = session
            policy = await client.call_tool("get_confirmation_policy", {})
            assert (
                policy.structured_content["data"]["operator_provenance_required"]
                is True
            )
            listed = await client.list_tools()
            assert "approve_plan" not in {tool.name for tool in listed.tools}
            drift(operator_world["evidence"], "missing")
            result = await client.call_tool(
                "request_plan_confirmation",
                {
                    "plan_id": operator_world["plan"]["plan_id"],
                    "plan_version": operator_world["plan"]["plan_version"],
                    "apply_after_approval": True,
                },
            )
            assert result.is_error
            assert result.structured_content["error"]["code"] == "EVIDENCE_STALE"
            # Read policy remains available during deployment drift.
            assert not (await client.call_tool("get_confirmation_policy", {})).is_error

    asyncio.run(run())
    assert scalar("SELECT count(*) FROM agent_telegram_confirmations") == 0


def test_database_readiness_is_real_bounded_read(command_world):
    from crate.db.queries.role_readiness import database_ready

    assert database_ready()


def test_drift_after_first_effect_is_durable_partial_and_never_replayed(
    operator_world, monkeypatch
):
    import sys

    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")

    def apply(operation, execution, config, *, task_id, authorize):
        authorize(lambda: operator_world["adapter"]["effects"].append("first"))
        drift(operator_world["evidence"], "rollback")
        authorize(lambda: operator_world["adapter"]["effects"].append("second"))

    monkeypatch.setattr(
        sys.modules["crate_test_operation_adapter"], "apply_operation", apply
    )
    start_task(result["job"]["job_id"])
    outcome = _handle_agent_maintenance(
        result["job"]["job_id"], {}, operator_world["config"]
    )
    assert outcome["execution"]["status"] == "partial"
    assert outcome["verification"]["status"] == "manual_reconciliation_required"
    assert operator_world["adapter"]["effects"] == ["first"]
    assert (
        _handle_agent_maintenance(result["job"]["job_id"], {}, operator_world["config"])
        == outcome
    )
    assert operator_world["adapter"]["effects"] == ["first"]


def test_approved_operator_job_preserves_cooperative_cancellation(
    operator_world, monkeypatch
):
    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    start_task(result["job"]["job_id"])
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: True)
    outcome = _handle_agent_maintenance(
        result["job"]["job_id"], {}, operator_world["config"]
    )
    assert outcome["execution"]["status"] == "cancelled"
    assert operator_world["adapter"]["effects"] == []


def test_native_admission_enrolls_real_supervisor_then_delivers_actual_verified_job(
    operator_world, tmp_path, monkeypatch
):
    import threading
    import urllib.request
    from types import SimpleNamespace

    from crate.agent_diagnostics import get_job
    from crate.db.repositories.tasks_mutations import update_task

    from deploy.operator.delivery import Delivery
    from deploy.operator.server import Poller, make_http_server
    from deploy.operator.state import State
    from deploy.operator.supervisor import Rule, Supervisor
    from tests.test_agent_telegram import event
    from tests.test_hermes_confirmation import plugin

    confirmation, message = show_all(operator_world)
    result = button(confirmation["confirmation_id"], message, "approve")
    job_id = result["job"]["job_id"]
    state = State(tmp_path / "supervisor-state")
    supervisor = Supervisor(
        state,
        "test-instance",
        [
            Rule(
                "api",
                "api",
                "get_instance_inventory",
                ("data", "sources", "release_manifest"),
            )
        ],
    )
    server = make_http_server(supervisor, "independent-read-watch-key")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    native = plugin()
    token = tmp_path / "read-token"
    token.write_text("independent-read-watch-key")
    monkeypatch.setattr(native, "WATCH_TOKEN_FILE", token)
    monkeypatch.setattr(
        native, "WATCH_URL", f"http://127.0.0.1:{server.server_port}/v1/watch-job"
    )
    provider = object.__new__(native.DomainProvider)
    provider._post = lambda value: event(
        value["kind"], **{k: v for k, v in value.items() if k != "kind"}
    )
    provider.opener = urllib.request.build_opener(
        native.NoRedirect(), urllib.request.ProxyHandler({})
    )
    try:
        pending = event("pending")
        provider._watch_outcome(pending)
        assert job_id in state.snapshot()["watches"]
        # Retries only enroll the same read watch; they never re-admit execution.
        provider._watch_outcome(pending)
        event(
            "outcome_delivered",
            confirmation_id=confirmation["confirmation_id"],
            chat_id=123,
            message_id=99,
        )
        start_task(job_id)
        outcome = _handle_agent_maintenance(job_id, {}, operator_world["config"])
        update_task(job_id, status="completed", result=outcome)
        delivered = []
        delivery = Delivery(
            state,
            SimpleNamespace(
                send=lambda item, *_: delivered.append(item["message"]) or "delivered"
            ),
        )
        poller = Poller(
            supervisor,
            SimpleNamespace(
                call=lambda name, args: (
                    get_job(args["job_id"]) if name == "get_job" else {}
                )
            ),
            delivery,
        )
        poller.tick()
        assert any(
            job_id in text and '"verification_status": "passed"' in text
            for text in delivered
        )
        assert len(operator_world["adapter"]["effects"]) == 1
        assert scalar("SELECT count(*) FROM agent_jobs") == 2
        poller.tick()
        assert len([text for text in delivered if job_id in text]) == 1
    finally:
        server.shutdown()
        server.server_close()
        state.close()


def test_directed_photo_plan_retains_native_approval_and_effect_gate(
    command_world, human_actor, tmp_path, monkeypatch
):
    from crate.artist_photo import observe_artist_photo
    from crate.db.repositories import agent_repair_plans, agent_requests

    from tests.agent_command_fixtures import UID, observed_plan

    _, old = observed_plan(command_world)
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "test-instance")
    monkeypatch.setenv("CRATE_OPERATOR_PRINCIPAL_IDS", command_world["principal"].id)
    evidence(tmp_path)
    change("UPDATE agent_principals SET require_approval=TRUE")
    store.bind_human(human_actor, command_world["principal"].id, 123)
    plan = agent_repair_plans.preview_repair(
        command_world["principal"], old["issue_id"]
    )
    assert plan["operator_provenance"] == provenance.current_identity()
    confirmation, message = show_all({**command_world, "plan": plan})
    result = button(confirmation["confirmation_id"], message, "approve")
    start_task(result["job"]["job_id"])
    drift(tmp_path, "context")
    with pytest.raises(DiagnosticError):
        agent_requests.complete_photo_repair(
            result["job"]["job_id"], observe_artist_photo(command_world["config"], UID)
        )
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 0
    with pytest.raises(DiagnosticError):
        agent_repair_plans.preview_repair(command_world["principal"], old["issue_id"])


def test_server_operator_identity_never_downgrades_to_autonomous_legacy_authority(
    operator_world,
):
    from crate.db.repositories import agent_requests

    from tests.agent_command_fixtures import UID

    change("UPDATE agent_principals SET require_approval=FALSE")
    with pytest.raises(DiagnosticError) as denied:
        agent_requests.accept_health_check(
            operator_world["principal"], UID, "legacy-bypass"
        )
    assert denied.value.code == "APPROVAL_REQUIRED"
    plan = _prepared(operator_world, key="still-human")
    assert plan["approval_required"] is True and plan["state"] == "awaiting_approval"
    with pytest.raises(DiagnosticError):
        _apply(operator_world, plan)
