"""Human repair review is prepared in a worker and consumed once by its owner."""

import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import Mock

import pytest
from sqlalchemy import text

from crate import admin_repairs
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import admin_repair_plans as plans
from crate.db.repositories.tasks import create_task, start_task, update_task
from crate.db.tx import read_scope, transaction_scope
from crate.worker_handlers.management import (
    _handle_prepare_library_repairs,
    _handle_repair,
)
from tests import test_repair_selection_contract as selection_fixtures

ARTIST_UID = selection_fixtures.ARTIST_UID
OTHER_UID = selection_fixtures.OTHER_UID
prepared_admin_photo_plan = selection_fixtures.prepared_admin_photo_plan
persisted_photo_plan = selection_fixtures.persisted_photo_plan


def _scalar(sql, values=None):
    with read_scope() as session:
        return session.execute(text(sql), values or {}).scalar_one()


def _change(sql, values=None):
    with transaction_scope() as session:
        session.execute(text(sql), values or {})


def _accept(preview, *, selected=None, confirm=False, version=None):
    return plans.accept_admin_repair_selection(
        preview["preparation_task_id"],
        1,
        plan_version=version or preview["plan_version"],
        plan_item_ids=selected
        if selected is not None
        else [preview["items"][0]["plan_item_id"]],
        confirm_risky=confirm,
    )


def _params(task_id):
    return _scalar("SELECT params_json FROM tasks WHERE id=:id", {"id": task_id})


def _payload(preview):
    return _scalar(
        "SELECT payload FROM admin_repair_preparations WHERE task_id=:id",
        {"id": preview["preparation_task_id"]},
    )


def test_worker_persists_full_sources_privately_and_publishes_only_preparation_marker(
    prepared_admin_photo_plan,
):
    _config, issues, preview = prepared_admin_photo_plan
    task_id = preview["preparation_task_id"]
    marker = _scalar("SELECT result_json FROM tasks WHERE id=:id", {"id": task_id})
    assert marker == {"status": "prepared", "preparation_task_id": task_id}
    assert {item["issue_id"] for item in preview["items"]} == {
        issue["id"] for issue in issues
    }
    private = _payload(preview)
    assert len(private["compiled"]["execution"]["items"]) == 2
    assert private["compiled"]["execution"]["items"][0]["database_version"]
    assert "compiled" not in preview
    assert "execution" not in preview
    assert "database_version" not in json.dumps(marker)
    assert preview["status"] == "completed"


def test_owned_preparation_http_returns_public_exact_review_without_private_execution(
    test_app,
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    response = test_app.get(
        "/api/manage/repair-preparations/" + preview["preparation_task_id"]
    )
    assert response.status_code == 200
    result = response.json()
    assert result["plan_version"] == preview["plan_version"]
    assert result["document"] == preview["document"]
    assert "compiled" not in result
    assert "consumed_by" not in result
    assert "effect_started" not in result


def test_another_repair_operator_cannot_read_or_consume_a_preparation(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    with transaction_scope() as session:
        actor = session.execute(
            text(
                "INSERT INTO users(email,role,created_at) VALUES ('other-repair@test.local','admin',NOW()) RETURNING id"
            )
        ).scalar_one()
        session.execute(
            text("INSERT INTO user_roles(user_id,role) VALUES (:id,'admin')"),
            {"id": actor},
        )
    for read in (
        lambda: plans.read_admin_repair_preparation(
            preview["preparation_task_id"], actor
        ),
        lambda: plans.accept_admin_repair_selection(
            preview["preparation_task_id"],
            actor,
            plan_version=preview["plan_version"],
            plan_item_ids=[preview["items"][0]["plan_item_id"]],
            confirm_risky=False,
        ),
    ):
        with pytest.raises(ValueError, match="not found"):
            read()
    assert _scalar("SELECT COUNT(*) FROM tasks WHERE type='repair'") == 0


@pytest.mark.parametrize("expiration", ["preparation", "task"])
def test_expired_preparation_requires_a_new_review(
    prepared_admin_photo_plan, expiration
):
    _config, _issues, preview = prepared_admin_photo_plan
    if expiration == "preparation":
        _change(
            "UPDATE admin_repair_preparations SET expires_at=NOW()-INTERVAL '1 second' WHERE task_id=:id",
            {"id": preview["preparation_task_id"]},
        )
    else:
        _change(
            "UPDATE tasks SET created_at=NOW()-INTERVAL '2 hours' WHERE id=:id",
            {"id": preview["preparation_task_id"]},
        )
    with pytest.raises(ValueError, match="expired"):
        _accept(preview)
    assert _scalar("SELECT COUNT(*) FROM tasks WHERE type='repair'") == 0


@pytest.mark.parametrize("status", ["pending", "running", "failed", "cancelled"])
def test_only_successfully_completed_preparations_can_be_consumed(
    prepared_admin_photo_plan, status
):
    _config, _issues, preview = prepared_admin_photo_plan
    _change(
        "UPDATE tasks SET status=:status WHERE id=:id",
        {"status": status, "id": preview["preparation_task_id"]},
    )
    with pytest.raises(ValueError, match="not complete"):
        _accept(preview)
    assert not _payload(preview).get("consumed_by")


def test_concurrent_identical_selection_enqueues_exactly_one_apply_job(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    with ThreadPoolExecutor(max_workers=2) as executor:
        jobs = list(executor.map(lambda _: _accept(preview), range(2)))
    assert jobs[0] == jobs[1]
    assert _scalar("SELECT COUNT(*) FROM tasks WHERE type='repair'") == 1
    assert _params(jobs[0]) == {
        "preparation_task_id": preview["preparation_task_id"],
        "actor_user_id": 1,
        "plan_version": preview["plan_version"],
        "plan_item_ids": [preview["items"][0]["plan_item_id"]],
        "confirm_risky": False,
    }


def test_consumed_preparation_does_not_accept_a_different_selection(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    with pytest.raises(ValueError, match="already used"):
        _accept(preview, selected=[preview["items"][1]["plan_item_id"]])
    assert _payload(preview)["consumed_by"] == job
    assert _scalar("SELECT COUNT(*) FROM tasks WHERE type='repair'") == 1


def test_stale_version_is_rejected_before_consuming_preparation(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    with pytest.raises(ValueError, match="stale"):
        _accept(preview, version="repair-contract:other")
    assert not _payload(preview).get("consumed_by")


@pytest.mark.parametrize("revocation", ["suspended", "role"])
def test_current_authority_is_required_for_selection_and_owned_reads(
    prepared_admin_photo_plan, revocation
):
    _config, _issues, preview = prepared_admin_photo_plan
    if revocation == "suspended":
        _change("UPDATE users SET status='suspended' WHERE id=1")
    else:
        _change("UPDATE users SET role='user' WHERE id=1")
        _change("DELETE FROM user_roles WHERE user_id=1")
        _change("INSERT INTO user_roles(user_id,role) VALUES (1,'user')")
    with pytest.raises(ValueError, match="permission"):
        _accept(preview)
    with pytest.raises(ValueError, match="permission"):
        plans.read_admin_repair_preparation(preview["preparation_task_id"], 1)
    assert not _payload(preview).get("effect_started")


def test_authority_uses_hydrated_roles_instead_of_legacy_primary_role(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    _change("UPDATE users SET role='user' WHERE id=1")
    _change("DELETE FROM user_roles WHERE user_id=1")
    _change("INSERT INTO user_roles(user_id,role) VALUES (1,'librarian')")
    called = Mock(return_value="authorized effect")
    assert plans.with_admin_repair_authority(1, called) == "authorized effect"
    called.assert_called_once_with()
    assert _accept(preview)


def test_worker_executes_only_selected_frozen_item_and_replay_has_no_effect(
    prepared_admin_photo_plan,
):
    config, issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    start_task(job)
    params = _params(job)
    result = _handle_repair(job, params, config)
    assert result["status"] == "completed"
    assert result["summary"] == {"applied": 1, "failed": 0}
    assert result["resolved_ids"] == [issues[0]["id"]]
    assert (
        _scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=CAST(:uid AS uuid)",
            {"uid": ARTIST_UID},
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=CAST(:uid AS uuid)",
            {"uid": OTHER_UID},
        )
        == 0
    )
    assert set(result["item_results"][0]) == {
        "issue_id",
        "item_key",
        "plan_item_id",
        "check_type",
        "outcome",
    }
    assert "actions" not in result
    assert str(config["library_path"]) not in json.dumps(result)
    audit_count = _scalar("SELECT COUNT(*) FROM audit_log")
    assert _handle_repair(job, params, config) == result
    assert _scalar("SELECT COUNT(*) FROM audit_log") == audit_count
    owned = plans.read_admin_repair_preparation(preview["preparation_task_id"], 1)
    assert owned["result"]["actions"][0]["applied"] is True
    assert "details" in owned["result"]["item_results"][0]


def test_recovery_after_effect_started_does_not_repeat_uncertain_effect(
    prepared_admin_photo_plan, monkeypatch
):
    config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    first = plans.load_admin_repair_execution(job, preview["preparation_task_id"], 1)
    assert len(first["execution"]["items"]) == 1
    effect = Mock(side_effect=AssertionError("uncertain effect was repeated"))
    monkeypatch.setattr(admin_repairs, "apply_operation", effect)
    result = admin_repairs.apply_admin_repairs(job, _params(job), config)
    assert result["status"] == "partial"
    assert result["verification"]["status"] == "manual_reconciliation_required"
    effect.assert_not_called()
    assert _scalar("SELECT SUM(has_photo) FROM library_artists") == 0


def test_revocation_after_acceptance_prevents_loading_effect(
    prepared_admin_photo_plan, monkeypatch
):
    config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    _change("UPDATE users SET status='suspended' WHERE id=1")
    effect = Mock(side_effect=AssertionError("revoked actor reached repair"))
    monkeypatch.setattr(admin_repairs, "apply_operation", effect)
    with pytest.raises(ValueError, match="permission"):
        admin_repairs.apply_admin_repairs(job, _params(job), config)
    effect.assert_not_called()
    assert not _payload(preview).get("effect_started")


def test_cancelled_apply_does_not_mark_effect_started(
    prepared_admin_photo_plan, monkeypatch
):
    config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: True)
    assert (
        admin_repairs.apply_admin_repairs(job, _params(job), config)["status"]
        == "cancelled"
    )
    assert not _payload(preview).get("effect_started")
    assert _scalar("SELECT SUM(has_photo) FROM library_artists") == 0


def test_changed_photo_after_preparation_never_writes_a_stale_flag(
    prepared_admin_photo_plan,
):
    config, issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    photo = Path(config["library_path"]) / "selected" / "artist.jpg"
    photo.write_bytes(b"changed after exact review")
    result = admin_repairs.apply_admin_repairs(job, _params(job), config)
    assert result["status"] != "completed"
    assert result["summary"]["applied"] == 0
    assert (
        _scalar(
            "SELECT has_photo FROM library_artists WHERE entity_uid=CAST(:uid AS uuid)",
            {"uid": ARTIST_UID},
        )
        == 0
    )
    assert (
        _scalar(
            "SELECT status FROM health_issues WHERE id=:id", {"id": issues[0]["id"]}
        )
        == "open"
    )


def test_empty_preparation_is_durable_and_has_no_private_payload_in_task_result(
    prepared_admin_photo_plan,
):
    config, _issues, _preview = prepared_admin_photo_plan
    params = {"issue_ids": [], "actor_user_id": 1}
    task_id = create_task("prepare_library_repairs", params)
    start_task(task_id)
    result = _handle_prepare_library_repairs(task_id, params, config)
    update_task(task_id, status="completed", result=result)
    assert result == {"status": "prepared", "preparation_task_id": task_id}
    owned = plans.read_admin_repair_preparation(task_id, 1)
    assert owned["items"] == []
    assert owned["plan_version"] == "repair-contract:empty"
    with pytest.raises(ValueError, match="Select at least one"):
        _accept(owned, selected=[])


def test_preparation_review_budget_rejects_large_document_without_truncating(
    prepared_admin_photo_plan, monkeypatch
):
    config, issues, _preview = prepared_admin_photo_plan
    params = {"issue_ids": [issues[0]["id"]], "actor_user_id": 1}
    task_id = create_task("prepare_library_repairs", params)
    compile_full = admin_repairs.compile_operation

    def oversized(*args, **kwargs):
        compiled = compile_full(*args, **kwargs)
        compiled["document"]["complete_source_evidence"] = "x" * 40001
        return compiled

    monkeypatch.setattr(admin_repairs, "compile_operation", oversized)
    with pytest.raises(ValueError, match="review budget"):
        admin_repairs.prepare_admin_repairs(task_id, params, config)
    assert (
        _scalar(
            "SELECT COUNT(*) FROM admin_repair_preparations WHERE task_id=:id",
            {"id": task_id},
        )
        == 0
    )


def test_preparation_runtime_is_lazy_bounded_and_does_not_mutate_quality():
    from crate.actors import TASK_POOL_CONFIG
    from crate.quality_task_policy import QUALITY_MUTATING_TASK_TYPES
    from crate.resource_governor import RESOURCE_GOVERNED_TASK_TYPES
    from crate.task_registry import TASK_TYPES
    from crate.worker import TASK_HANDLERS

    runtime = TASK_POOL_CONFIG["prepare_library_repairs"]
    assert runtime.queue == "maintenance"
    assert runtime.max_retries == 0
    assert runtime.time_limit_seconds == 1800
    assert "prepare_library_repairs" in TASK_TYPES
    assert "prepare_library_repairs" in RESOURCE_GOVERNED_TASK_TYPES
    assert "prepare_library_repairs" not in QUALITY_MUTATING_TASK_TYPES
    assert TASK_HANDLERS["prepare_library_repairs"] is _handle_prepare_library_repairs


@pytest.mark.parametrize("revocation", ["user_status", "role_membership"])
def test_authority_holds_user_and_role_grants_until_the_effect_finishes(
    prepared_admin_photo_plan, revocation
):
    from sqlalchemy.exc import OperationalError

    _change(
        "INSERT INTO user_roles(user_id,role) VALUES (1,'admin') ON CONFLICT DO NOTHING"
    )

    def revoke():
        with transaction_scope() as session:
            session.execute(text("SET LOCAL lock_timeout='150ms'"))
            if revocation == "user_status":
                session.execute(text("UPDATE users SET status='suspended' WHERE id=1"))
            else:
                session.execute(
                    text("UPDATE user_roles SET role='user' WHERE user_id=1")
                )

    def effect():
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(revoke)
            with pytest.raises(OperationalError, match="lock timeout"):
                future.result(timeout=5)
        return "effect completed under the current grant"

    assert (
        plans.with_admin_repair_authority(1, effect)
        == "effect completed under the current grant"
    )


def test_library_root_replacement_is_a_conflict_even_if_photo_inodes_are_preserved(
    prepared_admin_photo_plan,
):
    config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    root = Path(config["library_path"])
    photo = root / "selected" / "artist.jpg"
    original_inode = photo.stat().st_ino
    original_fingerprint = observe_artist_photo(config, ARTIST_UID)[
        "filesystem_fingerprint"
    ]
    backup = root.with_name(root.name + "-replaced")
    root.rename(backup)
    root.mkdir()
    for name in ("selected", "untouched"):
        (backup / name).rename(root / name)
    assert photo.stat().st_ino == original_inode
    assert (
        observe_artist_photo(config, ARTIST_UID)["filesystem_fingerprint"]
        == original_fingerprint
    )

    result = admin_repairs.apply_admin_repairs(job, _params(job), config)

    assert result["status"] != "completed"
    assert result["summary"]["applied"] == 0
    assert _scalar("SELECT SUM(has_photo) FROM library_artists") == 0


def test_cancelled_preparation_does_not_compile_or_store_a_plan(
    prepared_admin_photo_plan, monkeypatch
):
    config, issues, _preview = prepared_admin_photo_plan
    params = {"issue_ids": [issues[0]["id"]], "actor_user_id": 1}
    task_id = create_task("prepare_library_repairs", params)
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: True)
    compiler = Mock(side_effect=AssertionError("cancelled preparation compiled files"))
    monkeypatch.setattr(admin_repairs, "compile_operation", compiler)

    result = admin_repairs.prepare_admin_repairs(task_id, params, config)

    assert result == {"status": "cancelled"}
    compiler.assert_not_called()
    assert (
        _scalar(
            "SELECT COUNT(*) FROM admin_repair_preparations WHERE task_id=:id",
            {"id": task_id},
        )
        == 0
    )


def test_preparation_publication_cannot_replace_the_first_frozen_sources(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    original = _payload(preview)

    persisted = plans.store_admin_repair_preparation(
        preview["preparation_task_id"],
        1,
        {"preview": {"plan_version": "replacement"}, "compiled": {}},
    )

    assert persisted == original["preview"]
    assert _payload(preview) == original


def test_concurrent_worker_deliveries_claim_frozen_effect_only_once(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    start_task(job)
    ready = Barrier(2)

    def load_execution(_delivery):
        ready.wait(timeout=10)
        return plans.load_admin_repair_execution(job, preview["preparation_task_id"], 1)

    with ThreadPoolExecutor(max_workers=2) as executor:
        deliveries = list(executor.map(load_execution, range(2)))
    executions = [item for item in deliveries if "execution" in item]
    uncertain = [item for item in deliveries if "result" in item]
    assert len(executions) == 1
    assert len(uncertain) == 1
    assert (
        uncertain[0]["result"]["verification"]["status"]
        == "manual_reconciliation_required"
    )
    assert _scalar("SELECT SUM(has_photo) FROM library_artists") == 0


def test_a_different_apply_task_cannot_load_or_finish_the_owned_execution(
    prepared_admin_photo_plan,
):
    _config, _issues, preview = prepared_admin_photo_plan
    job = _accept(preview)
    other_job = create_task("repair", {"actor_user_id": 1})
    with pytest.raises(ValueError, match="not authorized"):
        plans.load_admin_repair_execution(other_job, preview["preparation_task_id"], 1)
    with pytest.raises(ValueError, match="owner changed"):
        plans.finish_admin_repair_execution(
            other_job, preview["preparation_task_id"], {"status": "completed"}
        )
    assert _payload(preview)["consumed_by"] == job
    assert not _payload(preview).get("effect_started")


def test_artist_get_is_diagnostic_and_post_queues_only_canonical_issue_ids(
    test_app, prepared_admin_photo_plan, monkeypatch
):
    _config, issues, _preview = prepared_admin_photo_plan
    worker_only = Mock(
        side_effect=AssertionError("HTTP request inspected repair filesystem")
    )
    monkeypatch.setattr("crate.agent_repairs.compile_operation", worker_only)
    monkeypatch.setattr("crate.repair.LibraryRepair.preview", worker_only)
    monkeypatch.setattr("crate.config.load_config", worker_only)
    endpoint = f"/api/manage/artists/by-entity/{ARTIST_UID}/repair-plan"

    diagnostic = test_app.get(endpoint)

    assert diagnostic.status_code == 200
    body = diagnostic.json()
    assert body["artist"] == "Selected"
    assert body["total"] == 1
    assert body["executable"] == 0
    assert body["items"][0]["executable"] is False
    queued = test_app.post(endpoint)
    assert queued.status_code == 200
    job = queued.json()["task_id"]
    assert _params(job) == {
        "issue_ids": [issues[0]["id"]],
        "actor_user_id": 1,
        "artist": "Selected",
    }
    assert (
        _scalar("SELECT type FROM tasks WHERE id=:id", {"id": job})
        == "prepare_library_repairs"
    )
    worker_only.assert_not_called()
