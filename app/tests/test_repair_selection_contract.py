"""Admin repairs execute only the persisted, reviewed selection."""

from pathlib import Path
from unittest.mock import MagicMock
from copy import deepcopy
import json

import pytest
from sqlalchemy import text

from crate.artist_photo import observe_artist_photo
from crate.db.health import get_open_issues, upsert_health_issue
from crate.db.jobs.artist_photo import read_artist_photo
from crate.db.tx import transaction_scope
from crate.db.repositories.tasks import create_task, start_task, update_task
from crate import admin_repairs
from crate.db.repositories.admin_repair_plans import read_admin_repair_preparation
from crate.health_check import ARTIST_SCOPED_CHECKS, LibraryHealthCheck
from crate.repair import LibraryRepair
from crate.worker_handlers.management import _handle_repair

ARTIST_UID = "b0000000-0000-0000-0000-000000000001"
OTHER_UID = "b0000000-0000-0000-0000-000000000002"


@pytest.fixture
def persisted_photo_plan(pg_db, tmp_path, monkeypatch):
    config = {"library_path": str(tmp_path)}
    with transaction_scope() as session:
        session.execute(
            text("""
                INSERT INTO library_artists (name, entity_uid, folder_name, has_photo)
                VALUES ('Selected', CAST(:selected AS uuid), 'selected', 0),
                       ('Untouched', CAST(:other AS uuid), 'untouched', 0)
            """),
            {"selected": ARTIST_UID, "other": OTHER_UID},
        )
    issues = []
    for name, uid in [("Selected", ARTIST_UID), ("Untouched", OTHER_UID)]:
        folder = tmp_path / name.lower()
        folder.mkdir()
        (folder / "artist.jpg").write_bytes(b"photo")
        observation = observe_artist_photo(config, uid)
        issue_id = upsert_health_issue(
            "has_photo_desync",
            "low",
            f"Photo flag differs for {name}",
            {
                "artist": name,
                "artist_uid": uid,
                "folder_name": name.lower(),
                "db_has_photo": observation["db_has_photo"],
                "fs_has_photo": observation["fs_has_photo"],
            },
            auto_fixable=True,
        )
        row = next(row for row in get_open_issues() if row["id"] == issue_id)
        issues.append(row)
    monkeypatch.setattr("crate.config.load_config", lambda: config)
    plan = LibraryRepair(config).preview({"issues": issues})
    return config, issues, plan


@pytest.fixture
def prepared_admin_photo_plan(persisted_photo_plan, monkeypatch):
    config, issues, _ = persisted_photo_plan
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    params = {
        "issue_ids": [row["id"] for row in issues],
        "actor_user_id": 1,
        "artist": "Selected",
    }
    task_id = create_task("prepare_library_repairs", params)
    start_task(task_id)
    result = admin_repairs.prepare_admin_repairs(task_id, params, config)
    update_task(task_id, status="completed", result=result)
    return config, issues, read_admin_repair_preparation(task_id, 1)


def _persist_preview(plan):
    with transaction_scope() as session:
        payload = session.execute(
            text("SELECT payload FROM admin_repair_preparations WHERE task_id=:id"),
            {"id": plan["preparation_task_id"]},
        ).scalar_one()
        payload["preview"].update(
            {key: value for key, value in plan.items() if key in payload["preview"]}
        )
        session.execute(
            text(
                "UPDATE admin_repair_preparations SET payload=CAST(:payload AS jsonb) WHERE task_id=:id"
            ),
            {
                "id": plan["preparation_task_id"],
                "payload": json.dumps(payload, default=str),
            },
        )


def _body(issues, plan, selected=None):
    return {
        "issues": [{"id": issue["id"]} for issue in issues],
        "dry_run": False,
        "preparation_task_id": plan["preparation_task_id"],
        "plan_version": plan["plan_version"],
        "plan_item_ids": selected
        if selected is not None
        else [plan["items"][0]["plan_item_id"]],
    }


def test_repair_preview_uses_persisted_issue_instead_of_client_details(
    test_app, persisted_photo_plan, monkeypatch
):
    _config, issues, _plan = persisted_photo_plan
    enqueue = MagicMock(return_value="prepare-job")
    monkeypatch.setattr("crate.api.management.create_task", enqueue)
    compile_on_request = MagicMock(
        side_effect=AssertionError("request compiled filesystem repair")
    )
    monkeypatch.setattr("crate.agent_repairs.compile_operation", compile_on_request)
    response = test_app.post(
        "/api/manage/repair-preview",
        json={
            "issues": [
                {
                    "id": issues[0]["id"],
                    "check": "has_photo_desync",
                    "details": {"artist": "Untouched", "artist_uid": OTHER_UID},
                }
            ]
        },
    )
    assert response.status_code == 200
    assert {
        key: response.json()[key]
        for key in ("task_id", "preparation_task_id", "status")
    } == {
        "task_id": "prepare-job",
        "preparation_task_id": "prepare-job",
        "status": "pending",
    }
    assert response.json()["items"] == []
    assert response.json()["document"] is None
    enqueue.assert_called_once_with(
        "prepare_library_repairs",
        {"issue_ids": [issues[0]["id"]], "actor_user_id": 1, "artist": ""},
    )
    compile_on_request.assert_not_called()


def test_repair_apply_queues_owned_preparation_and_exact_selection(
    test_app, prepared_admin_photo_plan, monkeypatch
):
    _config, issues, plan = prepared_admin_photo_plan
    enqueue = MagicMock(return_value="selected-job")
    monkeypatch.setattr("crate.db.repositories.admin_repair_plans.create_task", enqueue)
    body = _body(issues, plan)
    body["issues"][0]["details"] = {"artist": "Attacker supplied"}
    response = test_app.post("/api/manage/repair-issues", json=body)
    assert response.status_code == 200
    task_type, params = enqueue.call_args.args[:2]
    assert task_type == "repair"
    assert params == {
        "preparation_task_id": plan["preparation_task_id"],
        "actor_user_id": 1,
        "plan_version": plan["plan_version"],
        "plan_item_ids": [plan["items"][0]["plan_item_id"]],
        "confirm_risky": False,
    }


@pytest.mark.parametrize("version", [None, ""])
def test_repair_apply_requires_reviewed_plan_version(
    test_app, prepared_admin_photo_plan, monkeypatch, version
):
    _config, issues, plan = prepared_admin_photo_plan
    enqueue = MagicMock(return_value="must-not-run")
    monkeypatch.setattr("crate.db.repositories.admin_repair_plans.create_task", enqueue)
    body = _body(issues, plan)
    body["plan_version"] = version
    response = test_app.post("/api/manage/repair-issues", json=body)
    assert response.status_code == 422
    enqueue.assert_not_called()


@pytest.mark.parametrize("selection", ["empty", "unknown", "duplicate"])
def test_repair_apply_rejects_invalid_exact_selection(
    test_app, prepared_admin_photo_plan, monkeypatch, selection
):
    _config, issues, plan = prepared_admin_photo_plan
    selected = {
        "empty": [],
        "unknown": ["repair-plan:missing"],
        "duplicate": [plan["items"][0]["plan_item_id"]] * 2,
    }[selection]
    enqueue = MagicMock(return_value="must-not-run")
    monkeypatch.setattr("crate.db.repositories.admin_repair_plans.create_task", enqueue)
    response = test_app.post(
        "/api/manage/repair-issues", json=_body(issues, plan, selected)
    )
    assert response.status_code == (422 if selection == "duplicate" else 409)
    enqueue.assert_not_called()


@pytest.mark.parametrize("restriction", ["risky", "single_item"])
def test_unselected_item_does_not_require_confirmation_or_block_batch(
    test_app, prepared_admin_photo_plan, monkeypatch, restriction
):
    _config, issues, original_plan = prepared_admin_photo_plan
    plan = deepcopy(original_plan)
    plan["items"][1][
        "requires_confirmation" if restriction == "risky" else "supports_batch"
    ] = restriction == "risky"
    _persist_preview(plan)
    enqueue = MagicMock(return_value="safe-selection")
    monkeypatch.setattr("crate.db.repositories.admin_repair_plans.create_task", enqueue)
    response = test_app.post("/api/manage/repair-issues", json=_body(issues, plan))
    assert response.status_code == 200
    assert enqueue.call_args.args[1]["plan_item_ids"] == [
        plan["items"][0]["plan_item_id"]
    ]


@pytest.mark.parametrize("restriction", ["risky", "single_item"])
def test_selected_item_retains_risk_and_batch_guards(
    test_app, prepared_admin_photo_plan, monkeypatch, restriction
):
    _config, issues, original_plan = prepared_admin_photo_plan
    plan = deepcopy(original_plan)
    plan["items"][1][
        "requires_confirmation" if restriction == "risky" else "supports_batch"
    ] = restriction == "risky"
    _persist_preview(plan)
    enqueue = MagicMock(return_value="must-not-run")
    monkeypatch.setattr("crate.db.repositories.admin_repair_plans.create_task", enqueue)
    selected = [item["plan_item_id"] for item in plan["items"]]
    response = test_app.post(
        "/api/manage/repair-issues", json=_body(issues, plan, selected)
    )
    assert response.status_code == 409
    enqueue.assert_not_called()


def test_selected_risky_item_can_run_with_explicit_confirmation(
    test_app, prepared_admin_photo_plan, monkeypatch
):
    _config, issues, original_plan = prepared_admin_photo_plan
    plan = deepcopy(original_plan)
    plan["items"][1]["requires_confirmation"] = True
    _persist_preview(plan)
    enqueue = MagicMock(return_value="confirmed-risk")
    monkeypatch.setattr("crate.db.repositories.admin_repair_plans.create_task", enqueue)
    body = _body(issues, plan, [plan["items"][1]["plan_item_id"]])
    body["confirm_risky"] = True
    response = test_app.post("/api/manage/repair-issues", json=body)
    assert response.status_code == 200
    assert enqueue.call_args.args[1]["confirm_risky"] is True


@pytest.mark.parametrize("source", ["unknown", "duplicate", "missing_id"])
def test_repair_preview_rejects_unaddressable_persisted_sources(
    test_app, persisted_photo_plan, source
):
    _config, issues, _plan = persisted_photo_plan
    sources = {
        "unknown": [{"id": 2147483647}],
        "duplicate": [{"id": issues[0]["id"]}] * 2,
        "missing_id": [{"check": "has_photo_desync", "details": {"artist": "X"}}],
    }[source]
    response = test_app.post("/api/manage/repair-preview", json={"issues": sources})
    assert response.status_code in {409, 422}


def test_repair_worker_executes_only_selected_item_from_complete_plan(
    persisted_photo_plan, monkeypatch
):
    config, issues, plan = persisted_photo_plan
    _silence_worker_outputs(monkeypatch)
    mark_processing = MagicMock()
    monkeypatch.setattr(
        "crate.worker_handlers.management._mark_processing", mark_processing
    )
    revalidated_artists = []
    revalidate = LibraryHealthCheck.run_selected_for_artists

    def capture_revalidation(self, checks, artists, **kwargs):
        revalidated_artists.append(artists)
        return revalidate(self, checks, artists, **kwargs)

    monkeypatch.setattr(
        LibraryHealthCheck, "run_selected_for_artists", capture_revalidation
    )
    result = _handle_repair(
        "selected-job",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": issues,
            "plan_version": plan["plan_version"],
            "plan_item_ids": [plan["items"][0]["plan_item_id"]],
            "confirm_risky": False,
        },
        config,
    )
    assert result["summary"]["applied"] == 1
    assert result["resolved_ids"] == [issues[0]["id"]]
    assert read_artist_photo(ARTIST_UID)["has_photo"] == 1
    assert read_artist_photo(OTHER_UID)["has_photo"] == 0
    assert (Path(config["library_path"]) / "untouched" / "artist.jpg").is_file()
    assert revalidated_artists == [["Selected"]]
    mark_processing.assert_called_once_with("Selected")


def test_repair_worker_rechecks_full_plan_version_before_first_effect(
    persisted_photo_plan, monkeypatch
):
    config, issues, plan = persisted_photo_plan
    _silence_worker_outputs(monkeypatch)
    mark_processing = MagicMock()
    monkeypatch.setattr(
        "crate.worker_handlers.management._mark_processing", mark_processing
    )
    (Path(config["library_path"]) / "untouched" / "artist.jpg").unlink()
    result = _handle_repair(
        "stale-job",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": issues,
            "plan_version": plan["plan_version"],
            "plan_item_ids": [plan["items"][0]["plan_item_id"]],
        },
        config,
    )
    assert result.get("status") == "conflict" or result.get("error")
    assert read_artist_photo(ARTIST_UID)["has_photo"] == 0
    assert read_artist_photo(OTHER_UID)["has_photo"] == 0
    mark_processing.assert_not_called()


def test_repair_worker_reloads_canonical_issues_before_effect(
    persisted_photo_plan, monkeypatch
):
    config, issues, plan = persisted_photo_plan
    _silence_worker_outputs(monkeypatch)
    forged = deepcopy(issues)
    forged[0]["details"] = deepcopy(issues[1]["details_json"])
    result = _handle_repair(
        "canonical-job",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": forged,
            "plan_version": plan["plan_version"],
            "plan_item_ids": [plan["items"][0]["plan_item_id"]],
        },
        config,
    )
    assert result["summary"]["applied"] == 1
    assert read_artist_photo(ARTIST_UID)["has_photo"] == 1
    assert read_artist_photo(OTHER_UID)["has_photo"] == 0


def test_repair_worker_rejects_no_longer_open_source_before_effect(
    persisted_photo_plan, monkeypatch
):
    from crate.db.health import resolve_issue

    config, issues, plan = persisted_photo_plan
    _silence_worker_outputs(monkeypatch)
    resolve_issue(issues[0]["id"])
    result = _handle_repair(
        "resolved-source-job",
        {
            "dry_run": False,
            "auto_only": False,
            "issues": issues,
            "plan_version": plan["plan_version"],
            "plan_item_ids": [plan["items"][0]["plan_item_id"]],
        },
        config,
    )
    assert result.get("status") == "conflict" or result.get("error")
    assert read_artist_photo(ARTIST_UID)["has_photo"] == 0
    assert read_artist_photo(OTHER_UID)["has_photo"] == 0


def test_repair_engine_preserves_full_plan_version_when_applying_subset(
    persisted_photo_plan,
):
    config, issues, plan = persisted_photo_plan
    result = LibraryRepair(config).repair(
        {"issues": issues},
        dry_run=False,
        auto_only=False,
        expected_plan_version=plan["plan_version"],
        plan_item_ids=[plan["items"][0]["plan_item_id"]],
        confirm_risky=False,
    )
    assert result["summary"]["applied"] == 1
    assert result["resolved_ids"] == [issues[0]["id"]]
    assert read_artist_photo(ARTIST_UID)["has_photo"] == 1
    assert read_artist_photo(OTHER_UID)["has_photo"] == 0


def test_repair_engine_empty_selection_cannot_apply_whole_report(persisted_photo_plan):
    from crate.repair_selection import RepairSelectionError

    config, issues, plan = persisted_photo_plan
    with pytest.raises(RepairSelectionError):
        LibraryRepair(config).repair(
            {"issues": issues},
            dry_run=False,
            auto_only=False,
            expected_plan_version=plan["plan_version"],
            plan_item_ids=[],
        )
    assert read_artist_photo(ARTIST_UID)["has_photo"] == 0
    assert read_artist_photo(OTHER_UID)["has_photo"] == 0


@pytest.mark.parametrize("dry_run", [True, False])
def test_explicit_empty_worker_issues_never_expand_to_global_scope(
    monkeypatch, tmp_path, dry_run
):
    global_read = MagicMock(side_effect=AssertionError("Global scope is forbidden"))
    monkeypatch.setattr("crate.worker_handlers.management.get_open_issues", global_read)
    _silence_worker_outputs(monkeypatch)
    result = _handle_repair(
        "empty-job",
        {"issues": [], "dry_run": dry_run, "auto_only": False},
        {"library_path": str(tmp_path)},
    )
    global_read.assert_not_called()
    assert result.get("actions", []) == []


def _silence_worker_outputs(monkeypatch):
    for target in [
        "crate.worker_handlers.management.emit_task_event",
        "crate.worker_handlers.management.emit_progress",
        "crate.worker_handlers.management._mark_processing",
        "crate.worker_handlers.management._unmark_processing",
        "crate.db.admin_health_surface.publish_health_surface_signal",
        "crate.db.domain_events.append_domain_event",
    ]:
        monkeypatch.setattr(target, lambda *_args, **_kwargs: None)


@pytest.mark.parametrize(
    "requested",
    [["zombie_artists"], ["not_a_check"], ["has_photo_desync", "missing_files"]],
)
def test_artist_scoped_health_rejects_unsupported_checks_before_reads_or_resolution(
    tmp_path, monkeypatch, requested
):
    assert set(requested) - set(ARTIST_SCOPED_CHECKS)
    resolve = MagicMock()
    read_artist = MagicMock(side_effect=AssertionError("Must validate first"))
    persist = MagicMock()
    monkeypatch.setattr("crate.health_check.resolve_stale_artist_issues", resolve)
    monkeypatch.setattr("crate.health_check.get_library_artist", read_artist)
    monkeypatch.setattr(LibraryHealthCheck, "_persist_targeted_issues", persist)
    checker = LibraryHealthCheck({"library_path": str(tmp_path)})
    with pytest.raises(ValueError, match="(?i)(artist|scope|unsupported)"):
        checker.run_selected_for_artists(requested, ["Selected"])
    resolve.assert_not_called()
    read_artist.assert_not_called()
    persist.assert_not_called()


@pytest.mark.parametrize(
    "case,code",
    [
        ("empty", "EMPTY_SELECTION"),
        ("duplicate", "INVALID_SELECTION"),
        ("unknown", "PLAN_STALE"),
        ("changed_version", "PLAN_STALE"),
        ("manual", "NOT_EXECUTABLE"),
        ("risky", "CONFIRMATION_REQUIRED"),
        ("batch", "BATCH_NOT_SUPPORTED"),
    ],
)
def test_shared_repair_selection_reports_review_conflicts(case, code):
    from crate.repair_selection import RepairSelectionError, select_repair_items

    preview = {
        "plan_version": "repair-preview:full-version",
        "items": [
            {"plan_item_id": "one", "executable": True},
            {"plan_item_id": "two", "executable": True},
        ],
    }
    selected = ["one"]
    version = preview["plan_version"]
    if case == "empty":
        selected = []
    elif case == "duplicate":
        selected = ["one", "one"]
    elif case == "unknown":
        selected = ["unknown"]
    elif case == "changed_version":
        version = "repair-preview:old"
    elif case == "manual":
        preview["items"][0]["executable"] = False
    elif case == "risky":
        preview["items"][0]["requires_confirmation"] = True
    elif case == "batch":
        preview["items"][1]["supports_batch"] = False
        selected = ["one", "two"]
    with pytest.raises(RepairSelectionError) as error:
        select_repair_items(preview, selected, expected_version=version)
    assert error.value.code == code
