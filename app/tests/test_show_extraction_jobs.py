"""Private staging/extraction uses common accepted jobs and current human authority."""

from pathlib import Path
import pytest
from sqlalchemy import text
from crate.agent_diagnostics import DiagnosticError
from crate.db.tx import read_scope
from crate.db.repositories.show_extraction_jobs import (
    stage_show_image,
    accept_show_extraction,
)
from crate.db.repositories.show_imports import read_show_job
from crate.db.repositories.tasks_updates import start_task
from crate.worker_handlers.show_imports import handle_show_extraction
from tests.test_show_import_plans import show_world as show_world  # noqa: PLC0414


def test_owned_ocr_job_replays_without_library_or_shared_payload_leaks(show_world):
    actor = show_world["principal"]
    upload = stage_show_image(
        actor, (Path(__file__).parent / "fixtures/shows/tour.png").read_bytes()
    )
    source = {"mode": "ocr", "upload_ids": [upload["upload_id"]]}
    accepted = accept_show_extraction(actor, source, "ocr-1")
    assert (
        accept_show_extraction(actor, source, "ocr-1")["job_id"] == accepted["job_id"]
    )
    with pytest.raises(DiagnosticError, match="Idempotency"):
        accept_show_extraction(actor, {"mode": "parse", "raw_text": "changed"}, "ocr-1")
    start_task(accepted["job_id"])
    public = handle_show_extraction(accepted["job_id"], {}, {})
    assert public["execution"]["status"] == "extracted"
    assert "raw_text" not in str(public)
    result = read_show_job(actor, accepted["job_id"])["result"]["draft"]
    assert len(result["candidates"]) == 3
    with read_scope() as db:
        assert db.execute(text("SELECT count(*) FROM shows")).scalar() == 0
        assert "2027-03-02" not in str(
            db.execute(
                text("SELECT result_json FROM tasks WHERE id=:id"),
                {"id": accepted["job_id"]},
            ).scalar()
        )


def test_staging_and_worker_reject_other_users_and_revoked_roles(show_world):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.auth_user_roles import set_user_roles
    from crate.db.repositories.show_imports import get_show_editor_principal

    actor = show_world["principal"]
    upload = stage_show_image(
        actor, (Path(__file__).parent / "fixtures/shows/flyer.png").read_bytes()
    )
    other = create_user("other-extractor@example.test", role="curator")
    with pytest.raises(DiagnosticError):
        accept_show_extraction(
            get_show_editor_principal(other["id"]),
            {"mode": "ocr", "upload_ids": [upload["upload_id"]]},
            "foreign",
        )
    accepted = accept_show_extraction(
        actor, {"mode": "parse", "raw_text": "2027-03-02"}, "parse"
    )
    set_user_roles(show_world["user"]["id"], ["listener"])
    start_task(accepted["job_id"])
    result = handle_show_extraction(accepted["job_id"], {}, {})
    assert result["execution"]["error_code"] == "FORBIDDEN"


def test_extraction_audit_contains_only_bounded_outcome(show_world):
    actor = show_world["principal"]
    accepted = accept_show_extraction(
        actor, {"mode": "parse", "raw_text": "PRIVATE-FLYER-SECRET 2027-03-02"}, "audit"
    )
    start_task(accepted["job_id"])
    handle_show_extraction(accepted["job_id"], {}, {})
    with read_scope() as db:
        audit = str(db.execute(text("SELECT details_json FROM audit_log")).all())
    assert "PRIVATE-FLYER-SECRET" not in audit


def test_split_tour_draft_retains_saved_and_pending_item_outcomes(show_world):
    from tests.test_show_import_plans import prepare, apply

    actor = show_world["principal"]
    accepted = accept_show_extraction(
        actor,
        {"mode": "parse", "raw_text": "2027-03-02\n2027-03-04\n2027-03-06"},
        "tour",
    )
    start_task(accepted["job_id"])
    handle_show_extraction(accepted["job_id"], {}, {})
    extracted = read_show_job(actor, accepted["job_id"])["result"]
    draft_id = extracted["execution"]["draft_id"]
    rows = [
        {
            **row,
            "source_draft_id": draft_id,
            "artist_name": "External Band",
            "venue": "Sala Norte",
            "city": "Madrid",
        }
        for row in extracted["draft"]["candidates"]
    ]
    _, plan = prepare(show_world, key="first", candidates=rows[:2])
    _, result = apply(show_world, plan, key="save-first")
    assert result["verification"]["status"] == "passed"
    from crate.db.repositories.show_extraction_jobs import read_show_drafts

    saved = read_show_drafts(actor, draft_id)["result"]
    assert len(saved["candidates"]) == 3
    assert len(saved["publication"]) == 2
    _, plan = prepare(show_world, key="second", candidates=rows[2:])
    apply(show_world, plan, key="save-second")
    assert len(read_show_drafts(actor, draft_id)["result"]["publication"]) == 3


def test_owned_cancel_request_is_not_acknowledged_until_worker_returns(show_world):
    from crate.db.repositories.show_extraction_jobs import cancel_show_job
    from crate.db.repositories.task_control import acknowledge_cancellation

    actor = show_world["principal"]
    job = accept_show_extraction(
        actor, {"mode": "parse", "raw_text": "2027-03-02"}, "cancel"
    )
    start_task(job["job_id"])
    cancel_show_job(actor, job["job_id"])
    with read_scope() as db:
        assert (
            db.execute(
                text("SELECT cancellation_acknowledged_at FROM tasks WHERE id=:id"),
                {"id": job["job_id"]},
            ).scalar()
            is None
        )
    result = handle_show_extraction(job["job_id"], {}, {})
    assert result["status"] == "cancelled"
    acknowledge_cancellation(job["job_id"], result)
    with read_scope() as db:
        assert (
            db.execute(
                text("SELECT status FROM tasks WHERE id=:id"), {"id": job["job_id"]}
            ).scalar()
            == "cancelled"
        )


def test_private_staging_expiration_preserves_ledger_without_retaining_source_text(
    show_world,
):
    from crate.db.repositories.show_extraction_jobs import (
        cleanup_expired_show_sources,
        read_show_drafts,
    )
    from crate.db.tx import transaction_scope

    actor = show_world["principal"]
    content = (Path(__file__).parent / "fixtures/shows/flyer.png").read_bytes()
    first = stage_show_image(actor, content)
    second = stage_show_image(actor, content)
    assert first["upload_id"] == second["upload_id"]
    job = accept_show_extraction(
        actor, {"mode": "parse", "raw_text": "PRIVATE-SOURCE 2027-03-02"}, "expires"
    )
    start_task(job["job_id"])
    handle_show_extraction(job["job_id"], {}, {})
    with transaction_scope() as db:
        db.execute(
            text(
                "UPDATE show_extraction_drafts SET expires_at=NOW()-INTERVAL '1 second'"
            )
        )
        db.execute(
            text("UPDATE show_image_uploads SET expires_at=NOW()-INTERVAL '1 second'")
        )
    with pytest.raises(DiagnosticError):
        read_show_job(actor, job["job_id"])
    cleanup_expired_show_sources()
    assert read_show_drafts(actor)["items"] == []
    with read_scope() as db:
        assert db.execute(text("SELECT count(*) FROM show_image_uploads")).scalar() == 0
        assert "PRIVATE-SOURCE" not in str(
            db.execute(
                text("SELECT result FROM agent_jobs WHERE task_id=:id"),
                {"id": job["job_id"]},
            ).scalar()
        )
    assert (
        accept_show_extraction(
            actor, {"mode": "parse", "raw_text": "PRIVATE-SOURCE 2027-03-02"}, "expires"
        )["job_id"]
        == job["job_id"]
    )


def test_configured_model_change_never_sends_the_source_to_another_provider(
    show_world, monkeypatch
):
    from crate.show_extraction import show_llm_configuration
    from unittest.mock import Mock

    config = {
        "model": "gemini/old",
        "provider": "gemini",
        "ollama_url": "http://unused",
    }
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-key")
    monkeypatch.setattr("crate.llm.provider.get_config", lambda: dict(config))
    call = Mock(
        side_effect=AssertionError("A changed model must not receive the image")
    )
    monkeypatch.setattr("crate.llm.provider.ask_image_structured", call)
    state = show_llm_configuration()
    actor = show_world["principal"]
    upload = stage_show_image(
        actor, (Path(__file__).parent / "fixtures/shows/flyer.png").read_bytes()
    )
    job = accept_show_extraction(
        actor,
        {
            "mode": "vision",
            "upload_ids": [upload["upload_id"]],
            "expected_model": state["model"],
            "expected_configuration": state["configuration_fingerprint"],
        },
        "bound-model",
    )
    config["model"] = "gemini/new"
    start_task(job["job_id"])
    handle_show_extraction(job["job_id"], {}, {})
    result = read_show_job(actor, job["job_id"])["result"]
    assert result["execution"]["error_code"] == "CONFIGURATION_CHANGED"
    assert result["draft"]["candidates"]
    call.assert_not_called()


@pytest.mark.parametrize("change", ["key", "native_options"])
def test_accepted_show_identity_rejects_credential_and_option_changes(
    show_world, monkeypatch, change
):
    from crate.show_extraction import show_llm_configuration
    from crate.ai import configuration
    from unittest.mock import Mock

    config = {
        "model": "gemini/gemini-3.8-flash",
        "provider": "gemini",
        "ollama_url": "http://unused",
    }
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-accepted-key")
    monkeypatch.setattr("crate.llm.provider.get_config", lambda: dict(config))
    state = show_llm_configuration("text_llm")
    source = {
        "mode": "text_llm",
        "raw_text": "PRIVATE-POSTER 2027-03-02 Madrid",
        "expected_model": state["model"],
        "expected_configuration": state["configuration_fingerprint"],
    }
    accepted = accept_show_extraction(
        show_world["principal"], source, "pinned-identity"
    )
    with read_scope() as db:
        params = db.execute(
            text("SELECT params_json FROM tasks WHERE id=:id"),
            {"id": accepted["job_id"]},
        ).scalar_one()
        assert "PRIVATE-POSTER" not in str(params)
        assert "test-only-accepted-key" not in str(params)
        payload = db.execute(
            text("SELECT payload FROM agent_jobs WHERE task_id=:id"),
            {"id": accepted["job_id"]},
        ).scalar_one()
        assert set(payload["ai_acceptance"]) == {"action_id", "fingerprint"}
    provider = Mock(side_effect=AssertionError("revoked source must not be sent"))
    monkeypatch.setattr("crate.llm.provider.ask_structured", provider)
    if change == "key":
        monkeypatch.setenv("GEMINI_API_KEY", "test-only-rotated-key")
    else:
        original = configuration._legacy

        def changed(*a, **k):
            ctx = original(*a, **k)
            ctx["legacy_options"]["max_tokens"] = 8000
            return ctx

        monkeypatch.setattr(configuration, "_legacy", changed)
    start_task(accepted["job_id"])
    public = handle_show_extraction(accepted["job_id"], {}, {})
    assert "PRIVATE-POSTER" not in str(public)
    full = read_show_job(show_world["principal"], accepted["job_id"])["result"]
    assert full["execution"]["error_code"] == "CONFIGURATION_CHANGED"
    assert full["draft"]["candidates"]
    provider.assert_not_called()
