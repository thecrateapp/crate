"""Editorial grants, private plans, approval, exact worker effects and replay."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import asyncio

import pytest

from crate import agent_editorial, agent_library_operations
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.agent_credentials import create_credential
from crate.db.repositories.agent_plans import get_plan
from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.repositories.tasks_updates import start_task
from tests.test_agent_plan_approvals import decide
from tests.test_mcp_actions import _client
from tests.test_mcp_actions import action_transport as action_transport  # noqa: PLC0414

pytest_plugins = ["tests.test_agent_admin"]


def _principal(grants):
    issued = create_credential(
        "Editorial agent", grants, datetime.now(timezone.utc) + timedelta(days=1)
    )
    return issued.principal


def _prepare(principal, params, key="prepare"):
    queued = agent_editorial.editorial_plan_prepare(
        principal, idempotency_key=key, **params
    )["data"]
    start_task(queued["job_id"])
    result = agent_library_operations.execute_operation_job(queued["job_id"], {})
    assert result["execution"]["status"] == "prepared", result
    return result["plan"]


def test_editorial_create_requires_publish_and_human_approval(
    pg_db, human_actor, monkeypatch
):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_PUBLIC_LISTEN_BASE_URL", "https://listen.example.test")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    principal = _principal(
        ["editorial.prepare", "editorial.write", "editorial.publish"]
    )
    plan = _prepare(
        principal,
        {
            "kind": "create",
            "name": "Published",
            "generation_mode": "static",
            "track_uids": [],
        },
    )
    assert plan["approval_required"] is True
    assert agent_editorial.editorial_playlists_list(principal)["data"]["items"] == []
    with pytest.raises(DiagnosticError) as pending:
        agent_editorial.editorial_publication_set(
            principal,
            plan_id=plan["plan_id"],
            plan_version=plan["plan_version"],
            idempotency_key="publish",
        )
    assert pending.value.code == "APPROVAL_REQUIRED"

    decide(human_actor, get_plan(plan["plan_id"]))

    no_publish = replace(
        principal, grants=frozenset({"editorial.prepare", "editorial.write"})
    )
    with pytest.raises(DiagnosticError) as denied:
        agent_editorial.editorial_publication_set(
            no_publish,
            plan_id=plan["plan_id"],
            plan_version=plan["plan_version"],
            idempotency_key="denied",
        )
    assert denied.value.code == "FORBIDDEN"

    accepted = agent_editorial.editorial_publication_set(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="publish",
    )["data"]
    replay = agent_editorial.editorial_publication_set(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="publish",
    )["data"]
    assert accepted["job_id"] == replay["job_id"]
    start_task(accepted["job_id"])
    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})
    assert result["execution"]["status"] == "completed", result
    assert result["execution"]["is_active"] is True
    assert get_playlist_tracks(result["execution"]["playlist_id"]) == []
    assert (
        len(agent_editorial.editorial_playlists_list(principal)["data"]["items"]) == 1
    )


def test_editorial_read_tool_schemas_are_closed_and_grants_are_separate(
    pg_db, monkeypatch
):
    from pydantic import ValidationError
    from crate.mcp.editorial_schemas import EditorialPrepare, EditorialPublication
    from crate.mcp.tools import CATALOG, ACTION_CATALOG
    from crate.agent_discovery import get_operation_catalog

    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")

    assert CATALOG["editorial_candidates_search"][1] == "editorial.read"
    assert ACTION_CATALOG["editorial_plan_prepare"][1] == "editorial.prepare"
    assert ACTION_CATALOG["editorial_plan_apply"][1] == "editorial.write"
    assert ACTION_CATALOG["editorial_publication_set"][1] == "editorial.publish"
    principal = _principal(["editorial.prepare", "editorial.write"])
    operations = {
        row["name"]: row
        for row in get_operation_catalog(principal)["data"]["operations"]
    }
    assert operations["editorial_plan_apply"]["required_grants"] == [
        "editorial.prepare",
        "editorial.write",
        "editorial.publish",
    ]
    assert operations["editorial_plan_apply"]["status"] == "denied"
    assert operations["editorial_publication_set"]["grants_by_variant"][
        "prepare_visibility"
    ] == ["editorial.publish"]
    with pytest.raises(ValidationError):
        EditorialPrepare.model_validate(
            {
                "kind": "create",
                "name": "A",
                "idempotency_key": "x",
                "arbitrary_dispatch": "now",
            }
        )
    with pytest.raises(ValidationError):
        EditorialPublication.model_validate(
            {
                "playlist_id": 1,
                "expected_revision": 1,
                "is_active": True,
                "plan_id": "bad",
                "idempotency_key": "x",
            }
        )


@pytest.mark.parametrize(
    ("is_active", "auto_refresh_before", "auto_refresh_after"),
    [
        (True, False, True),
        (True, True, False),
        (False, False, True),
        (False, True, False),
    ],
    ids=["enable-active", "disable-active", "enable-inactive", "disable-inactive"],
)
def test_editorial_refresh_policy_worker_reports_committed_success(
    pg_db,
    human_actor,
    monkeypatch,
    is_active,
    auto_refresh_before,
    auto_refresh_after,
):
    from crate.db.repositories.playlists_collection_reads import get_playlist
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_tracks import add_playlist_tracks
    from tests.test_editorial_plans import _track

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_PUBLIC_LISTEN_BASE_URL", "https://listen.example.test")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    principal = _principal(
        ["editorial.prepare", "editorial.write", "editorial.publish"]
    )
    first, second = _track(pg_db, 121), _track(pg_db, 122)
    playlist_id = create_playlist(
        "Reviewed refresh policy",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2, "sort": "title"},
        auto_refresh_enabled=auto_refresh_before,
        is_active=is_active,
    )
    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "manual", "locked": True},
            {"track_id": second["id"], "source": "generated", "locked": False},
        ],
    )
    original_tracks = get_playlist_tracks(playlist_id)
    original_epoch = get_playlist(playlist_id)["generation_epoch"]
    plan = _prepare(
        principal,
        {
            "kind": "refresh_policy",
            "playlist_id": playlist_id,
            "auto_refresh_enabled": auto_refresh_after,
        },
    )
    reviewed = agent_editorial.editorial_plan_get(principal, plan_id=plan["plan_id"])[
        "data"
    ]
    assert reviewed["changes"][0]["auto_refresh_before"] is auto_refresh_before
    assert reviewed["changes"][0]["auto_refresh_after"] is auto_refresh_after
    assert reviewed["changes"][0]["track_count"] == 2
    assert get_playlist(playlist_id)["auto_refresh_enabled"] is auto_refresh_before
    decide(human_actor, get_plan(plan["plan_id"]))
    accepted = agent_editorial.editorial_plan_apply(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="refresh-policy-apply",
    )["data"]
    start_task(accepted["job_id"])

    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})

    assert get_playlist(playlist_id)["auto_refresh_enabled"] is auto_refresh_after
    assert result["execution"]["status"] == "completed", result
    assert result["execution"]["playlist_id"] == playlist_id
    assert result["execution"]["auto_refresh_enabled"] is auto_refresh_after
    assert result["execution"]["is_active"] is is_active
    assert result["verification"] == {"status": "passed", "track_count": 2}
    expected_url = (
        f"https://listen.example.test/curation/playlist/{playlist_id}"
        if is_active
        else None
    )
    assert result["execution"]["listen_url"] == expected_url
    assert get_playlist_tracks(playlist_id) == original_tracks
    assert get_playlist(playlist_id)["is_active"] is is_active
    assert get_playlist(playlist_id)["generation_epoch"] == original_epoch + 1
    history = agent_editorial.editorial_playlist_get(
        principal, playlist_id=playlist_id, section="history"
    )["data"]
    assert history["playlist"]["listen_url"] == expected_url
    assert history["total"] == 1
    assert history["items"][0]["event_type"] == "editorial"
    assert history["items"][0]["status"] == "applied"
    assert history["items"][0]["kind"] == "refresh_policy"
    assert history["items"][0]["actor_principal_id"] == principal.id
    assert history["items"][0]["track_count"] == 2

    replay = agent_editorial.editorial_plan_apply(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="refresh-policy-apply",
    )["data"]
    assert replay["job_id"] == accepted["job_id"]
    assert replay["result"]["execution"]["status"] == "completed"
    assert (
        agent_library_operations.execute_operation_job(accepted["job_id"], {}) == result
    )
    assert get_playlist(playlist_id)["generation_epoch"] == original_epoch + 1
    assert (
        agent_editorial.editorial_playlist_get(
            principal, playlist_id=playlist_id, section="history"
        )["data"]["total"]
        == 1
    )


def test_refresh_policy_requires_publish_and_human_approval(
    pg_db, human_actor, monkeypatch
):
    from crate.db.repositories.playlists_collection_reads import get_playlist
    from crate.db.repositories.playlists_create import create_playlist

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    principal = _principal(
        ["editorial.prepare", "editorial.write", "editorial.publish"]
    )
    playlist_id = create_playlist(
        "Unapproved refresh policy",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2, "sort": "title"},
        auto_refresh_enabled=False,
    )
    plan = _prepare(
        principal,
        {
            "kind": "refresh_policy",
            "playlist_id": playlist_id,
            "auto_refresh_enabled": True,
        },
    )
    assert plan["approval_required"] is True
    apply_parameters = {
        "plan_id": plan["plan_id"],
        "plan_version": plan["plan_version"],
        "idempotency_key": "refresh-policy-denied",
    }
    with pytest.raises(DiagnosticError) as unapproved:
        agent_editorial.editorial_plan_apply(principal, **apply_parameters)
    assert unapproved.value.code == "APPROVAL_REQUIRED"

    decide(human_actor, get_plan(plan["plan_id"]))
    no_publish = replace(
        principal, grants=frozenset({"editorial.prepare", "editorial.write"})
    )
    with pytest.raises(DiagnosticError) as denied:
        agent_editorial.editorial_plan_apply(no_publish, **apply_parameters)
    assert denied.value.code == "FORBIDDEN"
    assert get_playlist(playlist_id)["auto_refresh_enabled"] is False
    assert (
        agent_editorial.editorial_playlist_get(
            principal, playlist_id=playlist_id, section="history"
        )["data"]["items"]
        == []
    )


@pytest.mark.parametrize("override", ["exclusion", "manual", "locked"])
def test_editorial_worker_preserves_global_override_after_local_mapping(
    pg_db, human_actor, monkeypatch, override
):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.editorial_plans import snapshot_system_playlist
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        remove_playlist_track,
    )
    from tests.test_editorial_plans import _track
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    principal = _principal(
        ["editorial.prepare", "editorial.write", "editorial.publish"]
    )
    local = _track(pg_db, 141)
    _other, _artist, _album, global_uid = _seed_playlist_and_global_track(pg_db)
    playlist_id = create_playlist(
        "Worker global override",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={
            "rules": [
                {"field": "artist", "op": "eq", "value": "Editorial Test Artist"}
            ],
            "limit": 2,
            "sort": "title",
        },
    )
    source = "manual" if override == "manual" else "generated"
    locked = override == "locked"
    add_playlist_tracks(
        playlist_id,
        [{"global_track_uid": global_uid, "source": source, "locked": locked}],
    )
    original_row_id = get_playlist_tracks(playlist_id)[0]["id"]
    if override == "exclusion":
        remove_playlist_track(playlist_id, 1, record_exclusion=True)
    before = snapshot_system_playlist(playlist_id)
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=:id,
            local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
            WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {
                "id": local["id"],
                "uid": str(local["entity_uid"]),
                "global_uid": global_uid,
            },
        )

    plan = _prepare(principal, {"kind": "regenerate", "playlist_id": playlist_id})
    reviewed = agent_editorial.editorial_plan_get(principal, plan_id=plan["plan_id"])[
        "data"
    ]
    decide(human_actor, get_plan(plan["plan_id"]))
    accepted = agent_editorial.editorial_plan_apply(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="global-override-apply",
    )["data"]
    start_task(accepted["job_id"])
    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})
    after = snapshot_system_playlist(playlist_id)

    assert result["execution"]["status"] == "completed", result
    expected = (
        []
        if override == "exclusion"
        else [(original_row_id, None, global_uid, source, locked, 1)]
    )
    for rows in (reviewed["selection"], after["tracks"]):
        assert [
            (
                row["row_id"],
                row["track_uid"],
                row["global_track_uid"],
                row["source"],
                row["locked"],
                row["position"],
            )
            for row in rows
        ] == expected
    assert after["exclusions"] == before["exclusions"]
    assert result["verification"] == {"status": "passed", "track_count": len(expected)}
    replay = agent_editorial.editorial_plan_apply(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="global-override-apply",
    )["data"]
    assert replay["job_id"] == accepted["job_id"]
    assert (
        agent_library_operations.execute_operation_job(accepted["job_id"], {}) == result
    )
    assert snapshot_system_playlist(playlist_id) == after


def test_remote_sdk_create_reviews_and_applies_exact_selection(
    pg_db, action_transport, human_actor, monkeypatch
):
    from tests.test_editorial_plans import _track

    app, _token, _principal, credentials, _admission = action_transport
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_PUBLIC_LISTEN_BASE_URL", "https://listen.example.test")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    issued = create_credential(
        "Remote editorial client",
        ["editorial.read", "editorial.prepare", "editorial.write", "editorial.publish"],
        datetime.now(timezone.utc) + timedelta(days=1),
    )
    credentials[issued.token] = issued.principal
    first, second = _track(pg_db, 91), _track(pg_db, 92)
    params = {
        "kind": "create",
        "name": "SDK editorial",
        "generation_mode": "static",
        "description": "Exact remote order",
        "track_uids": [str(second["entity_uid"]), str(first["entity_uid"])],
        "idempotency_key": "remote-editorial-prepare",
    }

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, issued.token) as session,
        ):
            client, _ = session
            listed = {tool.name for tool in (await client.list_tools()).tools}
            assert {
                "editorial_plan_prepare",
                "editorial_plan_get",
                "editorial_publication_set",
            } <= listed
            before = await client.call_tool("editorial_playlists_list", {})
            existing_ids = {
                row["id"] for row in before.structured_content["data"]["items"]
            }
            accepted = await client.call_tool("editorial_plan_prepare", params)
            assert not accepted.is_error, accepted.structured_content
            job_id = accepted.structured_content["data"]["job_id"]
            start_task(job_id)
            prepared = agent_library_operations.execute_operation_job(job_id, {})
            assert prepared["execution"]["status"] == "prepared"
            plan_id = prepared["plan"]["plan_id"]
            plan_version = prepared["plan"]["plan_version"]
            replay = await client.call_tool("editorial_plan_prepare", params)
            assert (
                replay.structured_content["data"]["result"]["execution"]["plan_id"]
                == plan_id
            )
            plan = await client.call_tool(
                "editorial_plan_get", {"plan_id": plan_id, "limit": 1}
            )
            assert plan.structured_content["data"]["selection_count"] == 2
            first_page = plan.structured_content["data"]["selection"]
            second_page = await client.call_tool(
                "editorial_plan_get", {"plan_id": plan_id, "limit": 1, "offset": 1}
            )
            assert [
                row["track_uid"]
                for row in first_page
                + second_page.structured_content["data"]["selection"]
            ] == params["track_uids"]
            assert (
                plan.structured_content["data"]["metadata"]["description"]
                == params["description"]
            )
            still_before = await client.call_tool("editorial_playlists_list", {})
            assert {
                row["id"] for row in still_before.structured_content["data"]["items"]
            } == existing_ids
            validation = await client.call_tool(
                "editorial_plan_validate", {"plan_id": plan_id}
            )
            assert validation.structured_content["data"]["valid"] is True
            decide(human_actor, get_plan(plan_id))
            published = await client.call_tool(
                "editorial_publication_set",
                {
                    "plan_id": plan_id,
                    "plan_version": plan_version,
                    "idempotency_key": "remote-editorial-publish",
                },
            )
            assert not published.is_error, published.structured_content
            publish_job_id = published.structured_content["data"]["job_id"]
            start_task(publish_job_id)
            completed = agent_library_operations.execute_operation_job(
                publish_job_id, {}
            )
            playlist_id = completed["execution"]["playlist_id"]
            actual = await client.call_tool(
                "editorial_playlist_get", {"playlist_id": playlist_id}
            )
            assert [
                row["track_uid"] for row in actual.structured_content["data"]["items"]
            ] == params["track_uids"]
            assert (
                actual.structured_content["data"]["playlist"]["listen_url"]
                == f"https://listen.example.test/curation/playlist/{playlist_id}"
            )
            history = await client.call_tool(
                "editorial_playlist_get",
                {"playlist_id": playlist_id, "section": "history"},
            )
            assert (
                history.structured_content["data"]["items"][0]["event_type"]
                == "editorial"
            )

            original_rows = actual.structured_content["data"]["items"]
            edit_params = {
                "kind": "edit",
                "playlist_id": playlist_id,
                "track_uids": list(reversed(params["track_uids"])),
                "idempotency_key": "remote-editorial-edit-prepare",
            }
            edit_accepted = await client.call_tool(
                "editorial_plan_prepare", edit_params
            )
            assert not edit_accepted.is_error, edit_accepted.structured_content
            edit_job = edit_accepted.structured_content["data"]["job_id"]
            start_task(edit_job)
            edit_plan = agent_library_operations.execute_operation_job(edit_job, {})[
                "plan"
            ]
            assert [row["row_id"] for row in edit_plan["selection"]] == [
                row["row_id"] for row in reversed(original_rows)
            ]
            decide(human_actor, get_plan(edit_plan["plan_id"]))
            edit_apply = await client.call_tool(
                "editorial_plan_apply",
                {
                    "plan_id": edit_plan["plan_id"],
                    "plan_version": edit_plan["plan_version"],
                    "idempotency_key": "remote-editorial-edit-apply",
                },
            )
            assert not edit_apply.is_error, edit_apply.structured_content
            edit_apply_job = edit_apply.structured_content["data"]["job_id"]
            start_task(edit_apply_job)
            agent_library_operations.execute_operation_job(edit_apply_job, {})
            edited = await client.call_tool(
                "editorial_playlist_get", {"playlist_id": playlist_id}
            )
            assert [
                row["track_uid"] for row in edited.structured_content["data"]["items"]
            ] == edit_params["track_uids"]
            assert [
                row["row_id"] for row in edited.structured_content["data"]["items"]
            ] == [row["row_id"] for row in reversed(original_rows)]
            assert all(
                row["locked"] for row in edited.structured_content["data"]["items"]
            )

            stale_accepted = await client.call_tool(
                "editorial_plan_prepare",
                {
                    **edit_params,
                    "idempotency_key": "remote-editorial-stale-prepare",
                },
            )
            stale_job = stale_accepted.structured_content["data"]["job_id"]
            start_task(stale_job)
            stale_plan = agent_library_operations.execute_operation_job(stale_job, {})[
                "plan"
            ]
            from crate.db.repositories.playlists_mutate import update_playlist

            update_playlist(playlist_id, description="Concurrent Admin change")
            stale_validation = await client.call_tool(
                "editorial_plan_validate", {"plan_id": stale_plan["plan_id"]}
            )
            assert stale_validation.is_error
            assert stale_validation.structured_content["error"]["code"] == "PLAN_STALE"

    asyncio.run(run())


def test_visibility_only_principal_can_review_and_publish(
    pg_db, human_actor, monkeypatch
):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_collection_reads import get_playlist

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_PUBLIC_LISTEN_BASE_URL", "https://listen.example.test")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    playlist_id = create_playlist("Hidden", scope="system", is_active=False)
    principal = _principal(["editorial.publish"])
    assert (
        agent_editorial.editorial_playlist_get(principal, playlist_id=playlist_id)[
            "data"
        ]["playlist"]["listen_url"]
        is None
    )
    revision = get_playlist(playlist_id)["editorial_revision"]
    queued = agent_editorial.editorial_publication_set(
        principal,
        playlist_id=playlist_id,
        expected_revision=revision,
        is_active=True,
        idempotency_key="visibility-prepare",
    )["data"]
    start_task(queued["job_id"])
    plan = agent_library_operations.execute_operation_job(queued["job_id"], {})["plan"]
    visible = agent_editorial.editorial_plan_get(principal, plan_id=plan["plan_id"])[
        "data"
    ]
    assert visible["changes"][0]["is_active_before"] is False
    assert visible["changes"][0]["is_active_after"] is True
    decide(human_actor, get_plan(plan["plan_id"]))
    accepted = agent_editorial.editorial_publication_set(
        principal,
        plan_id=plan["plan_id"],
        plan_version=plan["plan_version"],
        idempotency_key="visibility-apply",
    )["data"]
    start_task(accepted["job_id"])
    result = agent_library_operations.execute_operation_job(accepted["job_id"], {})
    assert result["execution"]["is_active"] is True
    assert (
        result["execution"]["listen_url"]
        == f"https://listen.example.test/curation/playlist/{playlist_id}"
    )
    assert get_playlist(playlist_id)["is_active"] is True


def test_active_apply_replay_rechecks_original_prepare_grant(
    pg_db, human_actor, monkeypatch
):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories import agent_operation_jobs

    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    principal = _principal(
        ["editorial.prepare", "editorial.write", "editorial.publish"]
    )
    plan = _prepare(
        principal,
        {
            "kind": "create",
            "name": "Replay grants",
            "generation_mode": "static",
            "track_uids": [],
        },
        key="replay-grants-prepare",
    )
    decide(human_actor, get_plan(plan["plan_id"]))
    accepted = agent_operation_jobs.apply_operation(
        principal,
        "editorial_change",
        plan["plan_id"],
        plan["plan_version"],
        "replay-grants-apply",
    )
    assert accepted["status"] in {"pending", "running"}
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE agent_principals SET grants=ARRAY['editorial.write','editorial.publish']::text[]
                WHERE id=CAST(:id AS uuid)"""),
            {"id": principal.id},
        )
    with pytest.raises(DiagnosticError) as denied:
        agent_operation_jobs.apply_operation(
            principal,
            "editorial_change",
            plan["plan_id"],
            plan["plan_version"],
            "replay-grants-apply",
        )
    assert denied.value.code == "FORBIDDEN"
