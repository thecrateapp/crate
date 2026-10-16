"""Public phase-four contracts through the official MCP HTTP client."""

import asyncio
from dataclasses import replace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from crate.agent_access import ALLOWED_GRANTS
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_operation_jobs, agent_plans
from crate.db.repositories.tasks_updates import start_task
from crate.mcp import schemas

from tests.agent_command_fixtures import UID, change, scalar
from tests.agent_command_fixtures import command_world as command_world  # noqa: PLC0414
from tests.test_mcp_actions import ARTIST_UID, PLAN_ID, PLAN_VERSION, _client
from tests.test_mcp_actions import action_transport as action_transport  # noqa: PLC0414

APPLY = {
    "plan_id": PLAN_ID,
    "plan_version": PLAN_VERSION,
    "idempotency_key": "apply-one",
}
PREPARE_CASES = [
    (
        "run_health_check",
        "library.health.run",
        "health_check",
        {
            "scope": "global",
            "check_types": ["stale_tracks"],
            "idempotency_key": "prepare-one",
        },
        {"scope": "global", "artist_uid": None, "check_types": ["stale_tracks"]},
    ),
    (
        "run_quality_check",
        "library.quality.run",
        "quality_check",
        {"scope": "global", "idempotency_key": "prepare-one"},
        {"scope": "global"},
    ),
    (
        "preview_repairs",
        "library.repair.run",
        "repairs",
        {"issue_ids": [42, 43], "idempotency_key": "prepare-one"},
        {"issue_ids": [42, 43]},
    ),
    (
        "preview_metadata_update",
        "library.metadata.write",
        "metadata_update",
        {
            "entity_type": "track",
            "entity_uid": ARTIST_UID,
            "patch": {"title": "Edited", "genre": None},
            "idempotency_key": "prepare-one",
        },
        {
            "entity_type": "track",
            "entity_uid": ARTIST_UID,
            "patch": {"title": "Edited", "genre": None},
        },
    ),
    (
        "plan_enrichment",
        "library.enrichment.run",
        "enrichment",
        {
            "artist_uids": [ARTIST_UID],
            "providers": ["lastfm"],
            "facets": ["biography"],
            "idempotency_key": "prepare-one",
        },
        {
            "artist_uids": [ARTIST_UID],
            "providers": ["lastfm"],
            "facets": ["biography"],
            "mode": "missing",
        },
    ),
    (
        "plan_analysis",
        "library.analysis.run",
        "analysis",
        {
            "track_uids": [ARTIST_UID],
            "pipelines": ["bliss"],
            "idempotency_key": "prepare-one",
        },
        {"track_uids": [ARTIST_UID], "pipelines": ["bliss"], "mode": "pending"},
    ),
    (
        "plan_library_sync",
        "library.sync.run",
        "library_sync",
        {"scope": "album", "entity_uid": ARTIST_UID, "idempotency_key": "prepare-one"},
        {"scope": "album", "entity_uid": ARTIST_UID, "limit": 100},
    ),
    (
        "plan_metadata_export",
        "library.metadata.export",
        "metadata_export",
        {
            "album_uids": [ARTIST_UID],
            "destination_preset": "archive",
            "idempotency_key": "prepare-one",
        },
        {"album_uids": [ARTIST_UID], "destination_preset": "archive"},
    ),
    (
        "plan_metadata_rehydrate",
        "library.metadata.rehydrate",
        "metadata_rehydrate",
        {
            "album_uids": [ARTIST_UID],
            "source_preset": "archive",
            "idempotency_key": "prepare-one",
        },
        {
            "album_uids": [ARTIST_UID],
            "source_preset": "archive",
            "conflict_policy": "fill_missing",
        },
    ),
]
APPLY_CASES = [
    ("run_health_check", "library.health.run", "health_check"),
    ("run_quality_check", "library.quality.run", "quality_check"),
    ("apply_metadata_update", "library.metadata.write", "metadata_update"),
    ("run_enrichment", "library.enrichment.run", "enrichment"),
    ("run_analysis", "library.analysis.run", "analysis"),
    ("run_library_sync", "library.sync.run", "library_sync"),
    ("run_metadata_export", "library.metadata.export", "metadata_export"),
    ("run_metadata_rehydrate", "library.metadata.rehydrate", "metadata_rehydrate"),
]


def _envelope(data):
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "test-operation",
        "data": data,
    }


def _grant(transport, grants):
    _app, token, principal, credentials, _admission = transport
    credentials[token] = replace(principal, grants=frozenset(grants))
    return credentials[token]


@pytest.mark.parametrize("name,grant,operation,arguments,parameters", PREPARE_CASES)
def test_prepare_routes_only_declared_fields_into_the_shared_worker_engine(
    action_transport, monkeypatch, name, grant, operation, arguments, parameters
):
    app, token, *_ = action_transport
    principal = _grant(action_transport, {grant})
    prepare = Mock(
        return_value=_envelope({"job_id": "prepared-job", "status": "pending"})
    )
    monkeypatch.setattr("crate.agent_library_operations.prepare_operation", prepare)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(name, arguments)
            assert result.is_error is False, result
            assert result.structured_content["data"] == {
                "job_id": "prepared-job",
                "status": "pending",
            }

    asyncio.run(run())
    prepare.assert_called_once_with(
        principal,
        operation,
        parameters,
        "prepare-one",
        trace_id="action-transport-trace",
    )


@pytest.mark.parametrize("name,grant,operation", APPLY_CASES)
def test_apply_routes_only_exact_plan_identity_to_the_shared_engine(
    action_transport, monkeypatch, name, grant, operation
):
    app, token, *_ = action_transport
    principal = _grant(action_transport, {grant})
    apply = Mock(return_value=_envelope({"job_id": "applied-job", "status": "pending"}))
    monkeypatch.setattr("crate.agent_library_operations.apply_operation", apply)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(name, APPLY)
            assert result.is_error is False, result

    asyncio.run(run())
    apply.assert_called_once_with(
        principal,
        operation,
        PLAN_ID,
        PLAN_VERSION,
        "apply-one",
        trace_id="action-transport-trace",
    )


INVALID_CASES = [
    (
        "preview_metadata_update",
        {
            "entity_type": "track",
            "entity_uid": ARTIST_UID,
            "patch": {},
            "idempotency_key": "key",
        },
    ),
    (
        "preview_metadata_update",
        {
            "entity_type": "track",
            "entity_uid": ARTIST_UID,
            "patch": {"path": "/music/track"},
            "idempotency_key": "key",
        },
    ),
    (
        "preview_metadata_update",
        {
            "entity_type": "artist",
            "entity_uid": ARTIST_UID,
            "patch": {"title": "Wrong entity"},
            "idempotency_key": "key",
        },
    ),
    (
        "preview_metadata_update",
        {
            "entity_type": "album",
            "entity_uid": ARTIST_UID,
            "patch": {"tracknumber": "1"},
            "idempotency_key": "key",
        },
    ),
    (
        "preview_metadata_update",
        {
            "entity_type": "track",
            "entity_uid": "wrong",
            "patch": {"title": "Title"},
            "idempotency_key": "key",
        },
    ),
    (
        "preview_metadata_update",
        {
            "entity_type": "track",
            "entity_uid": ARTIST_UID,
            "patch": {"title": "x" * 4097},
            "idempotency_key": "key",
        },
    ),
    (
        "preview_metadata_update",
        {
            "entity_type": "track",
            "entity_uid": ARTIST_UID,
            "patch": {"title": "Title"},
            "idempotency_key": "key",
            "files": [],
        },
    ),
    (
        "run_health_check",
        {
            "scope": "global",
            "artist_uid": ARTIST_UID,
            "check_types": ["stale_tracks"],
            "idempotency_key": "key",
        },
    ),
    (
        "run_health_check",
        {"scope": "artist", "check_types": ["stale_tracks"], "idempotency_key": "key"},
    ),
    (
        "run_health_check",
        {
            "scope": "global",
            "check_types": ["stale_tracks", "stale_tracks"],
            "idempotency_key": "key",
        },
    ),
    (
        "run_health_check",
        {"scope": "global", "check_types": ["unknown"], "idempotency_key": "key"},
    ),
    ("run_health_check", {**APPLY, "scope": "global"}),
    ("run_health_check", {"plan_version": PLAN_VERSION, "idempotency_key": "key"}),
    ("run_quality_check", {"idempotency_key": "key"}),
    ("run_quality_check", {"scope": "artist", "idempotency_key": "key"}),
    ("run_quality_check", {**APPLY, "scope": "global"}),
    ("run_quality_check", {"plan_id": PLAN_ID, "idempotency_key": "key"}),
    ("preview_repairs", {"issue_ids": [], "idempotency_key": "key"}),
    ("preview_repairs", {"issue_ids": [42, 42], "idempotency_key": "key"}),
    ("preview_repairs", {"issue_id": 42, "issue_ids": [43], "idempotency_key": "key"}),
    ("preview_repairs", {"issue_ids": [True], "idempotency_key": "key"}),
    ("preview_repairs", {"issue_ids": list(range(1, 22)), "idempotency_key": "key"}),
    (
        "plan_enrichment",
        {
            "artist_uids": [ARTIST_UID] * 2,
            "providers": ["lastfm"],
            "facets": ["biography"],
            "idempotency_key": "key",
        },
    ),
    (
        "plan_enrichment",
        {
            "artist_uids": [ARTIST_UID],
            "providers": ["lastfm"] * 2,
            "facets": ["biography"],
            "idempotency_key": "key",
        },
    ),
    (
        "plan_enrichment",
        {
            "artist_uids": [ARTIST_UID],
            "providers": ["lastfm"],
            "facets": ["artwork"],
            "idempotency_key": "key",
        },
    ),
    (
        "plan_enrichment",
        {
            "artist_uids": [ARTIST_UID],
            "providers": ["arbitrary-url"],
            "facets": ["biography"],
            "idempotency_key": "key",
        },
    ),
    ("plan_analysis", {"track_uids": [ARTIST_UID] * 2, "idempotency_key": "key"}),
    (
        "plan_analysis",
        {
            "track_uids": [ARTIST_UID],
            "pipelines": ["analysis"] * 2,
            "idempotency_key": "key",
        },
    ),
    (
        "plan_analysis",
        {"track_uids": [ARTIST_UID], "pipelines": ["custom"], "idempotency_key": "key"},
    ),
    (
        "plan_analysis",
        {"track_uids": [str(uuid4()) for _ in range(201)], "idempotency_key": "key"},
    ),
    (
        "plan_library_sync",
        {"scope": "global", "entity_uid": ARTIST_UID, "idempotency_key": "key"},
    ),
    ("plan_library_sync", {"scope": "album", "idempotency_key": "key"}),
    (
        "plan_library_sync",
        {
            "scope": "artist",
            "entity_uid": ARTIST_UID,
            "limit": True,
            "idempotency_key": "key",
        },
    ),
    (
        "plan_metadata_export",
        {
            "album_uids": [ARTIST_UID],
            "destination_preset": "../exports",
            "idempotency_key": "key",
        },
    ),
    (
        "plan_metadata_export",
        {
            "album_uids": [ARTIST_UID],
            "destination_preset": "archive",
            "include_audio": True,
            "idempotency_key": "key",
        },
    ),
    (
        "plan_metadata_export",
        {
            "album_uids": [ARTIST_UID] * 2,
            "destination_preset": "archive",
            "idempotency_key": "key",
        },
    ),
    (
        "plan_metadata_rehydrate",
        {
            "album_uids": [ARTIST_UID] * 2,
            "source_preset": "archive",
            "idempotency_key": "key",
        },
    ),
    (
        "plan_metadata_rehydrate",
        {
            "album_uids": [ARTIST_UID],
            "source_preset": "archive",
            "conflict_policy": "overwrite_all",
            "idempotency_key": "key",
        },
    ),
    ("get_analysis_status", {}),
    ("get_analysis_status", {"track_uids": [ARTIST_UID], "plan_id": PLAN_ID}),
    ("get_analysis_status", {"track_uids": [ARTIST_UID] * 2}),
    ("get_analysis_status", {"track_uids": [ARTIST_UID], "refresh": True}),
    ("apply_metadata_update", {**APPLY, "patch": {"title": "Spoof"}}),
    ("run_analysis", {**APPLY, "track_uids": [ARTIST_UID]}),
]


@pytest.mark.parametrize("name,arguments", INVALID_CASES)
def test_invalid_selection_never_reaches_admission_or_domain_services(
    action_transport, name, arguments
):
    app, token, _principal, _credentials, admission = action_transport
    _grant(action_transport, ALLOWED_GRANTS)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(name, arguments)
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "INVALID_ARGUMENT"

    asyncio.run(run())
    admission.assert_not_called()


@pytest.mark.parametrize(
    "provided",
    [
        {"bio": "Only biography"},
        {"title": None},
        {"tags": []},
        {"urls": {"official": "https://artist.example"}},
    ],
)
def test_metadata_patch_preserves_explicit_fields_and_omits_every_unprovided_default(
    provided,
):
    kind = "track" if "title" in provided else "artist"
    parsed = schemas.MetadataPreviewInput.model_validate(
        {
            "entity_type": kind,
            "entity_uid": ARTIST_UID,
            "patch": provided,
            "idempotency_key": "key",
        }
    )
    assert parsed.patch.model_dump(exclude_unset=True) == provided


@pytest.mark.parametrize("enabled", ["true", "false"])
def test_new_action_discovery_and_catalog_describe_actual_grants_and_flags(
    action_transport, monkeypatch, enabled
):
    app, token, *_ = action_transport
    _grant(action_transport, ALLOWED_GRANTS)
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", enabled)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client = session[0]
            listed = {tool.name: tool for tool in (await client.list_tools()).tools}
            catalog = (
                await client.call_tool("get_operation_catalog", {})
            ).structured_content["data"]
            entries = {entry["name"]: entry for entry in catalog["operations"]}
            names = {case[0] for case in PREPARE_CASES} | {
                case[0] for case in APPLY_CASES
            }
            for name in names:
                assert entries[name]["status"] == (
                    "enabled" if enabled == "true" else "disabled"
                )
                assert (name in listed) is (enabled == "true")
                if enabled == "true":
                    assert listed[name].input_schema["additionalProperties"] is False
                    assert listed[name].annotations.read_only_hint is False
            assert "get_analysis_status" in listed

    asyncio.run(run())


@pytest.mark.parametrize(
    "grant",
    [
        "library.metadata.write",
        "library.analysis.run",
        "library.enrichment.run",
        "library.repair.run",
    ],
)
def test_get_plan_discovery_requires_one_operation_grant_but_not_the_photo_grant(
    action_transport, grant
):
    app, token, *_ = action_transport
    _grant(action_transport, {grant})

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            names = {tool.name for tool in (await session[0].list_tools()).tools}
            assert "get_plan" in names
            assert "get_analysis_status" not in names

    asyncio.run(run())


@pytest.mark.parametrize(
    "grants,arguments,allowed",
    [
        ({"library.repair.photo_flag"}, {"issue_id": 42}, True),
        (
            {"library.repair.photo_flag"},
            {"issue_ids": [42], "idempotency_key": "key"},
            False,
        ),
        ({"library.repair.run"}, {"issue_id": 42}, False),
        ({"library.repair.run"}, {"issue_ids": [42], "idempotency_key": "key"}, True),
    ],
)
def test_legacy_and_generic_repair_previews_require_their_distinct_grants(
    action_transport, monkeypatch, grants, arguments, allowed
):
    app, token, *_ = action_transport
    _grant(action_transport, grants)
    legacy = Mock(return_value={"plan_id": PLAN_ID})
    generic = Mock(return_value=_envelope({"job_id": "prepare-repairs"}))
    monkeypatch.setattr(
        "crate.db.repositories.agent_repair_plans.preview_repair", legacy
    )
    monkeypatch.setattr("crate.agent_library_operations.prepare_operation", generic)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool("preview_repairs", arguments)
            assert result.is_error is (not allowed)
            if not allowed:
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    assert legacy.call_count == int(allowed and "issue_id" in arguments)
    assert generic.call_count == int(allowed and "issue_ids" in arguments)


@pytest.mark.parametrize(
    "operation,grants,allowed",
    [
        ("repairs", {"library.repair.run"}, True),
        ("repair_photo_flag", {"library.repair.run"}, False),
        ("repair_photo_flag", {"library.repair.photo_flag"}, True),
    ],
)
def test_apply_repairs_dispatches_by_owned_plan_operation_without_grant_fallback(
    action_transport, monkeypatch, operation, grants, allowed
):
    app, token, *_ = action_transport
    _grant(action_transport, grants)
    monkeypatch.setattr(
        "crate.db.repositories.agent_plans.get_owned_plan",
        Mock(return_value={"operation": operation}),
    )
    legacy = Mock(return_value={"job_id": "legacy-apply"})
    generic = Mock(return_value=_envelope({"job_id": "generic-apply"}))
    monkeypatch.setattr("crate.db.repositories.agent_requests.accept_apply", legacy)
    monkeypatch.setattr("crate.agent_library_operations.apply_operation", generic)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool("apply_repairs", APPLY)
            assert result.is_error is (not allowed)
            if not allowed:
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    assert legacy.call_count == int(allowed and operation == "repair_photo_flag")
    assert generic.call_count == int(allowed and operation == "repairs")


@pytest.mark.parametrize("state", ["ready", "queued", "applied", "partial"])
def test_analysis_status_plan_uses_its_exact_generation_references(
    action_transport, monkeypatch, state
):
    app, token, *_ = action_transport
    principal = _grant(
        action_transport, {"library.health.read", "library.analysis.run"}
    )
    references = [
        {
            "track_uid": ARTIST_UID,
            "pipeline": "bliss",
            "generation": 17,
            "source_version": "f" * 64,
        }
    ]
    owned = Mock(return_value={"state": state, "references": references})
    status = Mock(return_value={"status": "pending", "items": references})
    monkeypatch.setattr(
        "crate.db.repositories.agent_plans.get_owned_analysis_references", owned
    )
    monkeypatch.setattr("crate.agent_analysis.get_analysis_status", status)

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(
                "get_analysis_status", {"plan_id": PLAN_ID}
            )
            assert result.is_error is False, result
            if state in {"ready", "queued"}:
                assert result.structured_content["data"]["status"] == "not_submitted"
            else:
                assert result.structured_content["data"]["status"] == "pending"

    asyncio.run(run())
    owned.assert_called_once_with(principal, PLAN_ID)
    if state in {"ready", "queued"}:
        status.assert_not_called()
    else:
        status.assert_called_once_with(references=references)


def test_analysis_plan_references_require_current_operation_grant(command_world):
    world = command_world
    queued = agent_operation_jobs.prepare_operation(
        world["principal"], "analysis", {"track_uids": [UID]}, "prepare-analysis"
    )
    start_task(queued["job_id"])
    references = [{"track_uid": UID, "pipeline": "analysis", "generation": 7}]
    result = agent_operation_jobs.publish_plan(
        queued["job_id"],
        {
            "document": {
                "operation": "analysis",
                "targets": [{"entity_type": "artist", "entity_uid": UID}],
                "changes": [{"field": "generation", "before": 6, "after": 7}],
                "risk": "safe",
            },
            "execution": {"references": references, "target_keys": [f"artist:{UID}"]},
        },
    )
    plan_id = result["plan"]["plan_id"]
    assert (
        agent_plans.get_owned_analysis_references(world["principal"], plan_id)[
            "references"
        ]
        == references
    )
    change(
        "UPDATE agent_principals SET grants=array_remove(grants,'library.analysis.run') WHERE id=:id",
        {"id": world["principal"].id},
    )
    with pytest.raises(DiagnosticError) as caught:
        agent_plans.get_owned_analysis_references(world["principal"], plan_id)
    assert caught.value.code == "FORBIDDEN"


def test_photo_grant_cannot_admit_a_generic_repair_plan_after_scope_downgrade(
    action_transport, command_world
):
    app, token, _principal, credentials, _admission = action_transport
    world = command_world
    queued = agent_operation_jobs.prepare_operation(
        world["principal"], "repairs", {"issue_ids": [42]}, "prepare-generic"
    )
    start_task(queued["job_id"])
    prepared = agent_operation_jobs.publish_plan(
        queued["job_id"],
        {
            "document": {
                "operation": "repairs",
                "targets": [{"entity_type": "artist", "entity_uid": UID}],
                "changes": [{"entity_uid": UID, "action": "repair"}],
                "risk": "safe",
            },
            "execution": {"target_keys": [f"artist:{UID}"]},
        },
    )["plan"]
    credentials[token] = replace(
        world["principal"], grants=frozenset({"library.repair.photo_flag"})
    )
    change(
        "UPDATE agent_principals SET grants=ARRAY['library.repair.photo_flag']::text[] WHERE id=:id",
        {"id": world["principal"].id},
    )

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            result = await session[0].call_tool(
                "apply_repairs",
                {
                    "plan_id": prepared["plan_id"],
                    "plan_version": prepared["plan_version"],
                    "idempotency_key": "wrong-grant",
                },
            )
            assert result.is_error is True
            assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    assert (
        scalar(
            "SELECT COUNT(*) FROM agent_jobs WHERE operation IN ('apply_repairs','apply_operation')"
        )
        == 0
    )


def test_owned_plan_mcp_uses_the_plans_operation_grant_for_content_access(
    action_transport, command_world
):
    app, token, _principal, credentials, _admission = action_transport
    world = command_world
    queued = agent_operation_jobs.prepare_operation(
        world["principal"], "metadata_update", {"entity_uid": UID}, "prepare-metadata"
    )
    start_task(queued["job_id"])
    prepared = agent_operation_jobs.publish_plan(
        queued["job_id"],
        {
            "document": {
                "operation": "metadata_update",
                "targets": [{"entity_type": "artist", "entity_uid": UID}],
                "changes": [
                    {"entity_uid": UID, "field": "bio", "after": "Private biography"}
                ],
                "risk": "safe",
            },
            "execution": {"target_keys": [f"artist:{UID}"]},
        },
    )["plan"]
    credentials[token] = replace(
        world["principal"], grants=frozenset({"library.metadata.write"})
    )
    with pytest.raises(DiagnosticError) as caught:
        agent_plans.get_owned_analysis_references(
            world["principal"], prepared["plan_id"]
        )
    assert caught.value.code == "INVALID_ARGUMENT"

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            client = session[0]
            allowed = await client.call_tool(
                "get_plan", {"plan_id": prepared["plan_id"]}
            )
            assert allowed.is_error is False, allowed
            assert (
                allowed.structured_content["data"]["changes"][0]["after"]
                == "Private biography"
            )
            credentials[token] = replace(
                world["principal"], grants=frozenset({"library.health.run"})
            )
            denied = await client.call_tool(
                "get_plan", {"plan_id": prepared["plan_id"]}
            )
            assert denied.is_error is True
            assert denied.structured_content["error"]["code"] == "FORBIDDEN"
            assert "Private biography" not in str(denied.structured_content)

    asyncio.run(run())


def test_disabling_actions_blocks_every_new_mutation_before_admission(
    action_transport, monkeypatch
):
    app, token, _principal, _credentials, admission = action_transport
    _grant(action_transport, ALLOWED_GRANTS)
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "false")

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            for name, _grant_name, _operation, arguments, _parameters in PREPARE_CASES:
                result = await session[0].call_tool(name, arguments)
                assert result.is_error is True
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    admission.assert_not_called()


def test_absent_operation_grants_block_new_mutations_before_admission(action_transport):
    app, token, _principal, _credentials, admission = action_transport
    _grant(action_transport, {"ops.status.read"})

    async def run():
        async with app.router.lifespan_context(app), _client(app, token) as session:
            for name, _grant_name, _operation, arguments, _parameters in PREPARE_CASES:
                result = await session[0].call_tool(name, arguments)
                assert result.is_error is True
                assert result.structured_content["error"]["code"] == "FORBIDDEN"

    asyncio.run(run())
    admission.assert_not_called()
