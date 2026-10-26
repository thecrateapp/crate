"""Persisted photo evidence and plans cannot broaden or repeat a repair."""

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_repair_plans import preview_repair
from crate.db.repositories.tasks_updates import start_task

from tests.agent_command_fixtures import (
    UID,
    change,
    observed_plan,
    other_principal,
    scalar,
)

pytest_plugins = ["tests.agent_command_fixtures"]


def test_plan_is_database_only_and_exact_and_owner_bound(command_world, monkeypatch):
    job, plan = observed_plan(command_world)
    assert plan["before"] == {"has_photo": False}
    assert plan["after"] == {"has_photo": True}
    assert plan["artist_uid"] == UID
    assert scalar("SELECT COUNT(*) FROM tasks") == 1
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 0
    assert scalar("SELECT COUNT(*) FROM health_check_runs") == 0

    def forbidden(*_args, **_kwargs):
        pytest.fail("Preview cannot observe the filesystem")

    monkeypatch.setattr("crate.artist_photo.observe_artist_photo", forbidden)
    second = preview_repair(command_world["principal"], plan["issue_id"])
    assert second["plan_id"] != plan["plan_id"]
    other = other_principal()
    with pytest.raises(DiagnosticError) as error:
        requests.accept_apply(other, plan["plan_id"], plan["plan_version"], "foreign")
    assert error.value.code == "NOT_FOUND"
    with pytest.raises(DiagnosticError) as error:
        preview_repair(other, plan["issue_id"])
    assert error.value.code == "EVIDENCE_STALE"
    assert (
        requests.load_job_for_execution(job["job_id"])["result"]["execution"][
            "issue_id"
        ]
        == plan["issue_id"]
    )


def test_observation_redelivery_and_scoped_resolution(command_world):
    job, plan = observed_plan(command_world)
    before = requests.load_job_for_execution(job["job_id"])["result"]
    assert requests.record_photo_observation(job["job_id"], {}) == before
    assert scalar("SELECT COUNT(*) FROM agent_photo_observations") == 1
    assert scalar("SELECT COUNT(*) FROM health_issues") == 1
    change("UPDATE library_artists SET has_photo=1 WHERE entity_uid=:uid", {"uid": UID})
    next_job = requests.accept_health_check(command_world["principal"], UID, "recheck")
    start_task(next_job["job_id"])
    result = requests.record_photo_observation(
        next_job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert result["execution"]["issue_id"] is None
    assert (
        scalar(
            "SELECT status FROM health_issues WHERE id=:id", {"id": plan["issue_id"]}
        )
        == "fixed"
    )
    assert scalar("SELECT COUNT(*) FROM health_check_runs") == 0


@pytest.mark.parametrize(
    "mutation", ["expired_evidence", "renamed_artist", "changed_flag", "closed_issue"]
)
def test_preview_requires_recent_current_issue_evidence(command_world, mutation):
    _, plan = observed_plan(command_world)
    statements = {
        "expired_evidence": "UPDATE agent_photo_observations SET observed_at=NOW()-INTERVAL '16 minutes'",
        "renamed_artist": "UPDATE library_artists SET name='Renamed' WHERE entity_uid=:uid",
        "changed_flag": "UPDATE library_artists SET has_photo=1 WHERE entity_uid=:uid",
        "closed_issue": "UPDATE health_issues SET status='fixed'",
    }
    change(statements[mutation], {"uid": UID})
    with pytest.raises(DiagnosticError) as error:
        preview_repair(command_world["principal"], plan["issue_id"])
    assert error.value.code == "EVIDENCE_STALE"


@pytest.mark.parametrize("mutation", ["expired_plan", "wrong_version"])
def test_apply_rejects_expired_or_mismatched_plan(command_world, mutation):
    _, plan = observed_plan(command_world)
    if mutation == "expired_plan":
        change("UPDATE agent_repair_plans SET expires_at=NOW()-INTERVAL '1 second'")
    else:
        plan["plan_version"] = "f" * 64
    with pytest.raises(DiagnosticError) as error:
        requests.accept_apply(
            command_world["principal"], plan["plan_id"], plan["plan_version"], "apply"
        )
    assert error.value.code == "PLAN_STALE"
    assert scalar("SELECT COUNT(*) FROM tasks") == 1


def test_apply_effect_result_audit_events_and_verification_are_durable(command_world):
    _, plan = observed_plan(command_world)
    principal = command_world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "apply"
    )
    assert (
        requests.accept_apply(
            principal, plan["plan_id"], plan["plan_version"], "new-key"
        )["job_id"]
        == job["job_id"]
    )
    start_task(job["job_id"])
    observed = observe_artist_photo(command_world["config"], UID)
    result = requests.complete_photo_repair(job["job_id"], observed)
    assert result["execution"]["status"] == "applied"
    assert result["verification"]["status"] == "pending"
    assert (
        scalar(
            "SELECT status FROM health_issues WHERE id=:id", {"id": plan["issue_id"]}
        )
        == "open"
    )
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 1
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Other'") == 0
    assert requests.complete_photo_repair(job["job_id"], {}) == result
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.repair.applied'")
        == 1
    )
    assert (
        scalar(
            "SELECT COUNT(*) FROM domain_event_outbox WHERE event_type='ui.invalidate'"
        )
        == 2
    )
    assert requests.fail_job(job["job_id"], "FILESYSTEM_UNAVAILABLE", "gone") == result
    verified = requests.record_photo_verification(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert verified["verification"]["status"] == "verified"
    assert (
        scalar(
            "SELECT status FROM health_issues WHERE id=:id", {"id": plan["issue_id"]}
        )
        == "fixed"
    )
    assert (
        scalar(
            "SELECT state FROM agent_repair_plans WHERE id=:id", {"id": plan["plan_id"]}
        )
        == "applied"
    )
    assert (
        requests.accept_apply(
            principal, plan["plan_id"], plan["plan_version"], "apply"
        )["result"]
        == verified
    )
    assert requests.record_photo_verification(job["job_id"], {}) == verified


@pytest.mark.parametrize(
    "mutation", ["photo", "rename", "deleted", "expired_after_queue"]
)
def test_worker_revalidates_plan_without_mutation(command_world, mutation):
    _, plan = observed_plan(command_world)
    job = requests.accept_apply(
        command_world["principal"], plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])
    observed = observe_artist_photo(command_world["config"], UID)
    if mutation == "photo":
        (command_world["folder"] / "artist.jpg").write_bytes(b"replaced photo")
        observed = observe_artist_photo(command_world["config"], UID)
    elif mutation == "rename":
        change(
            "UPDATE library_artists SET name='Renamed' WHERE entity_uid=:uid",
            {"uid": UID},
        )
    elif mutation == "deleted":
        change("DELETE FROM library_artists WHERE entity_uid=:uid", {"uid": UID})
    else:
        change("UPDATE agent_repair_plans SET expires_at=NOW()-INTERVAL '1 second'")
    with pytest.raises(DiagnosticError) as error:
        requests.complete_photo_repair(job["job_id"], observed)
    assert error.value.code == (
        "ARTIST_NOT_FOUND" if mutation == "deleted" else "PLAN_STALE"
    )
    result = requests.fail_job(job["job_id"], error.value.code, str(error.value))
    if mutation != "deleted":
        assert result["execution"]["status"] == "conflict"
        assert (
            scalar(
                "SELECT has_photo FROM library_artists WHERE entity_uid=:uid",
                {"uid": UID},
            )
            == 0
        )
    assert (
        scalar("SELECT COUNT(*) FROM audit_log WHERE action='agent.repair.applied'")
        == 0
    )


def test_audit_failure_rolls_back_library_change_and_plan_result(
    command_world, monkeypatch
):
    _, plan = observed_plan(command_world)
    job = requests.accept_apply(
        command_world["principal"], plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])

    def failed(*_args, **_kwargs):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(requests, "_audit", failed)
    with pytest.raises(RuntimeError):
        requests.complete_photo_repair(
            job["job_id"], observe_artist_photo(command_world["config"], UID)
        )
    assert scalar("SELECT has_photo FROM library_artists WHERE name='Echo'") == 0
    assert (
        scalar("SELECT result FROM agent_jobs WHERE task_id=:id", {"id": job["job_id"]})
        is None
    )
    assert (
        scalar(
            "SELECT state FROM agent_repair_plans WHERE id=:id", {"id": plan["plan_id"]}
        )
        == "queued"
    )


def test_post_verification_conflict_preserves_applied_and_does_not_resolve_issue(
    command_world,
):
    _, plan = observed_plan(command_world)
    job = requests.accept_apply(
        command_world["principal"], plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])
    requests.complete_photo_repair(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    waiting = requests.record_photo_verification(
        job["job_id"], None, error_code="FILESYSTEM_UNAVAILABLE"
    )
    assert waiting["execution"]["status"] == "applied"
    assert waiting["verification"]["status"] == "pending"
    (command_world["folder"] / "artist.jpg").unlink()
    result = requests.record_photo_verification(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert result["execution"]["status"] == "applied"
    assert result["verification"]["status"] == "conflict"
    assert (
        scalar(
            "SELECT status FROM health_issues WHERE id=:id", {"id": plan["issue_id"]}
        )
        == "open"
    )


def test_idempotent_same_target_repair_already_satisfied(command_world):
    _, plan = observed_plan(command_world)
    job = requests.accept_apply(
        command_world["principal"], plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])
    change("UPDATE library_artists SET has_photo=1 WHERE entity_uid=:uid", {"uid": UID})
    result = requests.complete_photo_repair(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert result["execution"]["status"] == "already_satisfied"


def test_plan_expiry_never_extends_evidence_lifetime(command_world):
    from datetime import datetime, timedelta

    _, plan = observed_plan(command_world)
    change(
        "UPDATE agent_photo_observations SET observed_at=NOW()-INTERVAL '14 minutes'"
    )
    recent = preview_repair(command_world["principal"], plan["issue_id"])
    assert datetime.fromisoformat(recent["expires_at"]) - datetime.fromisoformat(
        recent["observed_at"]
    ) == timedelta(minutes=15)
    assert datetime.fromisoformat(recent["expires_at"]) - datetime.fromisoformat(
        recent["created_at"]
    ) <= timedelta(minutes=1)


def test_applied_effect_retains_target_reservation_until_verification(command_world):
    _, plan = observed_plan(command_world)
    principal = command_world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])
    requests.complete_photo_repair(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]})
        == "running"
    )
    with pytest.raises(DiagnosticError) as error:
        requests.accept_health_check(other_principal(), UID, "other")
    assert error.value.code == "TARGET_BUSY"
    requests.record_photo_verification(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert (
        scalar("SELECT status FROM tasks WHERE id=:id", {"id": job["job_id"]})
        == "completed"
    )


def test_revocation_after_applied_still_records_verification_without_new_effect(
    command_world,
):
    from crate.db.repositories.agent_credentials import revoke_credential

    _, plan = observed_plan(command_world)
    principal = command_world["principal"]
    job = requests.accept_apply(
        principal, plan["plan_id"], plan["plan_version"], "apply"
    )
    start_task(job["job_id"])
    requests.complete_photo_repair(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    revoke_credential(principal.credential_id)
    result = requests.record_photo_verification(
        job["job_id"], observe_artist_photo(command_world["config"], UID)
    )
    assert result["verification"]["status"] == "verified"
    assert (
        scalar(
            "SELECT status FROM health_issues WHERE id=:id", {"id": plan["issue_id"]}
        )
        == "open"
    )


@pytest.mark.parametrize("issue_id", [False, 0, -1, "123"])
def test_preview_rejects_invalid_issue_id(command_world, issue_id):
    with pytest.raises(DiagnosticError) as error:
        preview_repair(command_world["principal"], issue_id)
    assert error.value.code == "INVALID_ARGUMENT"
