"""The AI triage evaluation (gate EG2): plan, queue, the ai_bulk task and its result.

Only the provider transport is fake: admission, budgets, validation and the
invocation ledger are the real ones, against PostgreSQL. Digests are synthetic.
"""

from __future__ import annotations

import io
import json
from typing import Any

import pytest
from sqlalchemy import text

from crate.ai import runtime
from crate.ai.contracts import AIConfigurationError
from crate.error_inbox.evaluation import (
    EVAL_TASK,
    evaluation_result,
    normalise_short_ids,
    plan_evaluation,
    queue_evaluation,
    run_evaluation,
)
from tests.error_inbox_fakes import configure_ai
from tests.test_error_triage import (
    TRIAGE,
    _event,
    _issue,
    _model,
    _output,
    _scope,
    _triage,
)

# Text that exists only in the event, the title, the culprit or the model's free
# text: none of it may reach a plan, a task result or the CLI's output.
PRIVATE = (
    "Title-only text",
    "culprit-only text",
    "never-sent",
    "track_id",
    "crate/worker_handlers",
    "Track loading fails",
    "parse() reads",
    "Guard the lookup",
)


@pytest.fixture(autouse=True)
def _no_dispatch(monkeypatch):
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )


@pytest.fixture
def inbox(pg_db, monkeypatch) -> dict[str, str]:
    configure_ai(monkeypatch, (TRIAGE,))
    return {
        "CRATE-API-1": _issue(1, _event()),
        # Same exception type and innermost frame: a candidate of issue 1.
        "CRATE-API-2": _issue(2, _event(value="'album_id'"), crate_score=30),
        # Same exception type, another frame: also a candidate.
        "CRATE-API-3": _issue(3, _event(functions=("handle", "store")), crate_score=90),
        # Another exception: no candidates at all.
        "CRATE-API-4": _issue(4, _event(exception="TimeoutError")),
        # Synced but its latest event was never downloaded.
        "CRATE-API-5": _issue(5),
    }


def _private_free(value: Any) -> None:
    encoded = json.dumps(value, default=str)
    for private in PRIVATE:
        assert private not in encoded


def _queued(short_ids: list[str], skipped: list[dict] | None = None) -> dict:
    from crate.db.queries.tasks import get_task

    plan = plan_evaluation(short_ids)
    queued = queue_evaluation(
        [item["short_id"] for item in plan["items"] if item["status"] == "ready"],
        expected_fingerprint=plan["fingerprint"],
        skipped=skipped,
    )
    task = get_task(queued["task_id"])
    assert task is not None
    return task


def _run(task: dict, **kwargs) -> dict:
    kwargs.setdefault("execute", runtime.execute_structured)
    return run_evaluation(task["id"], task["params"], **kwargs)


def _finish(task_id: str, result: dict) -> None:
    from crate.db.repositories.tasks import update_task

    update_task(task_id, status="completed", result=result)


def _triage_rows() -> int:
    with _scope() as session:
        return session.execute(text("SELECT count(*) FROM error_issue_triage")).scalar()


def test_short_ids_are_normalised_and_bounded():
    assert normalise_short_ids(
        ["crate-listen-1a", "CRATE-LISTEN-1A", "CRATE-API-7"]
    ) == [
        "CRATE-LISTEN-1A",
        "CRATE-API-7",
    ]
    for invalid in (
        "CRATE-API-1",
        ["CRATE API 1"],
        ["<script>-1"],
        [None],
        ["X" * 65 + "-1"],
        [f"CRATE-API-{n}" for n in range(101)],
    ):
        with pytest.raises(ValueError):
            normalise_short_ids(invalid)


def test_issue_ids_by_short_id_is_one_case_insensitive_lookup(inbox):
    from crate.db.queries.error_issues import issue_ids_by_short_id

    found = issue_ids_by_short_id(["crate-api-1", "CRATE-API-5", "CRATE-API-99"])

    assert found == {
        "CRATE-API-1": inbox["CRATE-API-1"],
        "CRATE-API-5": inbox["CRATE-API-5"],
    }
    assert issue_ids_by_short_id([]) == {}


def test_plan_reports_ready_and_skipped_issues_without_event_text(inbox):
    plan = plan_evaluation(
        ["CRATE-API-1", "crate-api-4", "CRATE-API-5", "CRATE-API-99"]
    )

    assert plan["available"] and plan["status"] == "configured"
    assert (plan["provider"], plan["model_id"]) == ("gemini", "gemini-2.5-flash")
    assert plan["limits"]["max_input_tokens"] == 65536
    assert plan["fingerprint"]
    assert [(i["short_id"], i["status"], i.get("reason")) for i in plan["items"]] == [
        ("CRATE-API-1", "ready", None),
        ("CRATE-API-4", "ready", None),
        ("CRATE-API-5", "skipped", "no_digest"),
        ("CRATE-API-99", "skipped", "not_in_inbox"),
    ]
    assert plan["calls"] == 2
    first = plan["items"][0]
    assert first["frames"] == 3 and first["candidates"] == 2
    assert first["estimated_input_tokens"] > 1024
    assert plan["items"][1]["candidates"] == 0
    _private_free(plan)


def test_plan_skips_requests_over_the_input_limit(pg_db, monkeypatch):
    configure_ai(monkeypatch, (TRIAGE,), max_input_tokens=4096)
    _issue(1, _event())

    plan = plan_evaluation(["CRATE-API-1"])

    [item] = plan["items"]
    assert (item["status"], item["reason"]) == ("skipped", "over_input_limit")
    assert item["estimated_input_tokens"] > 4096
    assert plan["calls"] == 0


def test_plan_without_a_binding_is_unavailable(pg_db, monkeypatch):
    configure_ai(monkeypatch, actions=())
    _issue(1, _event())

    plan = plan_evaluation(["CRATE-API-1"])

    assert not plan["available"] and plan["error_code"] == "AI_ACTION_DISABLED"
    assert plan["provider"] is None and plan["items"][0]["status"] == "ready"


def test_queue_pins_the_planned_binding_and_runs_one_at_a_time(inbox, monkeypatch):
    plan = plan_evaluation(["CRATE-API-1"])
    with pytest.raises(AIConfigurationError) as stale:
        queue_evaluation(["CRATE-API-1"], expected_fingerprint="another-binding")
    assert stale.value.code == "AI_CONTEXT_STALE"
    with pytest.raises(ValueError):
        queue_evaluation([], expected_fingerprint=plan["fingerprint"])

    queued = queue_evaluation(
        ["CRATE-API-1"],
        expected_fingerprint=plan["fingerprint"],
        skipped=[{"short_id": "CRATE-API-5", "reason": "no_digest"}],
    )
    again = queue_evaluation(["CRATE-API-1"], expected_fingerprint=plan["fingerprint"])

    from crate.db.queries.tasks import get_task

    task = get_task(queued["task_id"])
    assert task["type"] == EVAL_TASK and task["pool"] == "ai_bulk"
    assert task["origin"] == "admin" and task["max_retries"] == 0
    params = task["params"]
    assert params["short_ids"] == ["CRATE-API-1"]
    assert params["skipped"] == [{"short_id": "CRATE-API-5", "reason": "no_digest"}]
    assert params["ai_acceptance"]["action_id"] == TRIAGE
    assert params["ai_acceptance"]["fingerprint"] == plan["fingerprint"]
    assert again == {"task_id": queued["task_id"], "deduplicated": True}


def test_queue_rejects_unknown_skip_reasons(inbox):
    plan = plan_evaluation(["CRATE-API-1"])
    with pytest.raises(ValueError):
        queue_evaluation(
            ["CRATE-API-1"],
            expected_fingerprint=plan["fingerprint"],
            skipped=[{"short_id": "CRATE-API-5", "reason": "free text"}],
        )


def test_evaluation_keeps_closed_answers_and_saves_no_triage(inbox, monkeypatch):
    calls = _model(
        monkeypatch,
        _output(duplicate_of="CRATE-API-2"),
        _output(classification="noise", severity="low", confidence=0.4),
        # Outside the closed enum: the runtime rejects it.
        _output(classification="catastrophic"),
        # CRATE-API-4 has no candidates, so naming one is invalid.
        _output(duplicate_of="CRATE-API-1"),
    )
    task = _queued(["CRATE-API-1", "CRATE-API-2", "CRATE-API-3", "CRATE-API-4"])

    result = _run(task)

    assert result["status"] == "completed" and not result["cancelled"]
    assert result["counts"] == {
        "ok": 2,
        "invalid_output": 2,
        "failed": 0,
        "skipped": 0,
        "not_run": 0,
    }
    first, second, third, fourth = result["items"]
    assert first["prediction"] == {
        "classification": "bug",
        "severity": "high",
        "duplicate_of": "CRATE-API-2",
        "confidence": 0.8,
    }
    assert first["candidate_ids"] == ["CRATE-API-2", "CRATE-API-3"]
    assert first["invocation_id"]
    assert second["prediction"]["classification"] == "noise"
    assert (third["status"], third["error_code"]) == (
        "invalid_output",
        "AI_RESPONSE_INVALID",
    )
    assert (fourth["status"], fourth["candidate_ids"]) == ("invalid_output", [])
    assert result["model"]["provider"] == "gemini"
    assert result["model"]["model_id"] == "gemini-2.5-flash"
    assert result["critical_confidence"] == 0.6
    assert len(calls) == 4
    assert _triage_rows() == 0
    _private_free(result)


def test_result_carries_usage_per_short_id(inbox, monkeypatch):
    _model(monkeypatch, _output(), _output(classification="catastrophic"))
    task = _queued(["CRATE-API-1", "CRATE-API-4"])
    pending = evaluation_result(task["id"])
    assert (pending["status"], pending["finished"]) == ("pending", False)
    assert pending["result"] is None and pending["invocations"] == []

    result = _run(task)
    _finish(
        task["id"], {**result, "error": "never shown", "summary": "Track loading fails"}
    )
    record = evaluation_result(task["id"])

    assert record["finished"] and record["status"] == "completed"
    assert record["result"]["counts"]["ok"] == 1
    assert "error" not in record["result"] and "summary" not in record["result"]
    usage = {row["short_id"]: row for row in record["invocations"]}
    assert set(usage) == {"CRATE-API-1", "CRATE-API-4"}
    assert usage["CRATE-API-1"]["status"] == "succeeded"
    assert (
        usage["CRATE-API-1"]["input_tokens"],
        usage["CRATE-API-1"]["output_tokens"],
    ) == (
        900,
        120,
    )
    assert usage["CRATE-API-4"]["error_code"] == "AI_RESPONSE_INVALID"
    _private_free(record)
    with pytest.raises(ValueError):
        evaluation_result("not-a-task")


def test_invocations_filter_by_job(inbox, monkeypatch):
    from crate.db.repositories.ai_usage import list_invocations

    _model(monkeypatch, _output(), _output())
    _triage(inbox["CRATE-API-2"])
    task = _queued(["CRATE-API-1"])
    _run(task)

    everything = list_invocations({})["items"]
    mine = list_invocations({"job_id": task["id"]})["items"]

    assert len(everything) == 2
    assert [row["idempotency_key"] for row in mine] == [
        f"action:None:eval:{task['id']}:CRATE-API-1"
    ]


def test_evaluation_sends_exactly_what_triage_sends(inbox, monkeypatch):
    calls = _model(monkeypatch, _output(), _output())

    _run(_queued(["CRATE-API-1"]))
    _triage(inbox["CRATE-API-1"])

    evaluated, triaged = calls
    for key in ("action_id", "prompt", "system", "response_schema"):
        assert evaluated[key] == triaged[key]


def test_existing_triage_does_not_stop_an_evaluation(inbox, monkeypatch):
    calls = _model(monkeypatch, _output(), _output(severity="low"))
    assert _triage(inbox["CRATE-API-1"]).status == "saved"

    result = _run(_queued(["CRATE-API-1"]))

    assert result["items"][0]["prediction"]["severity"] == "low"
    assert len(calls) == 2
    assert _triage_rows() == 1


def test_skipped_cancelled_and_failed_issues_are_recorded(inbox, monkeypatch):
    from crate.ai.transport import NativeResponse

    answers = iter([RuntimeError("provider down"), json.dumps(_output())])

    def generate(context, **kwargs):
        answer = next(answers)
        if isinstance(answer, Exception):
            raise answer
        return NativeResponse(answer, {"input_tokens": 1, "output_tokens": 1}, "m", 1)

    monkeypatch.setattr(runtime.transport, "generate", generate)
    task = _queued(
        ["CRATE-API-1", "CRATE-API-2", "CRATE-API-3", "CRATE-API-4"],
        skipped=[{"short_id": "CRATE-API-5", "reason": "no_digest"}],
    )
    # Purged between the plan and the run.
    with _scope() as session:
        session.execute(
            text("DELETE FROM error_issues WHERE id = CAST(:id AS uuid)"),
            {"id": inbox["CRATE-API-3"]},
        )
    checks = iter([False, False, False, True])

    result = _run(task, cancelled=lambda: next(checks))

    assert [(i["short_id"], i["status"]) for i in result["items"]] == [
        ("CRATE-API-1", "failed"),
        ("CRATE-API-2", "ok"),
        ("CRATE-API-3", "skipped"),
        ("CRATE-API-4", "not_run"),
    ]
    assert result["items"][0]["error_code"] == "AI_PROVIDER_FAILED"
    assert result["items"][2]["reason"] == "not_in_inbox"
    assert result["items"][3]["reason"] == "cancelled"
    assert result["cancelled"] is True
    assert result["skipped"] == [{"short_id": "CRATE-API-5", "reason": "no_digest"}]


def test_a_redelivered_task_never_pays_twice(inbox, monkeypatch):
    calls = _model(monkeypatch, _output())
    task = _queued(["CRATE-API-1"])

    first = _run(task)
    second = _run(task)

    assert first["items"][0]["status"] == "ok"
    assert (second["items"][0]["status"], second["items"][0]["error_code"]) == (
        "failed",
        "AI_EXECUTION_ALREADY_ACCEPTED",
    )
    assert len(calls) == 1


def test_stale_or_invalid_requests_fail_closed_without_a_call(inbox, monkeypatch):
    calls = _model(monkeypatch, _output())
    task = _queued(["CRATE-API-1"])
    stale = {
        **task["params"],
        "ai_acceptance": {**task["params"]["ai_acceptance"], "fingerprint": "x"},
    }

    assert _run({**task, "params": stale})["error_code"] == "AI_CONTEXT_STALE"
    for params in (
        {**task["params"], "short_ids": []},
        {**task["params"], "short_ids": ["not a short id"]},
        {**task["params"], "ai_acceptance": None},
        {**task["params"], "actor_user_id": True},
        {**task["params"], "skipped": [{"short_id": "CRATE-API-5", "reason": "x"}]},
    ):
        failed = _run({**task, "params": params})
        assert failed["status"] == "failed"
        assert failed["error_code"] == "ERROR_TRIAGE_EVAL_INVALID_REQUEST"
    assert calls == []


def test_one_broken_issue_does_not_discard_paid_answers(inbox, monkeypatch):
    from crate.error_inbox import evaluation

    _model(monkeypatch, _output())
    real = evaluation.get_triage_input

    def flaky(issue_id):
        if issue_id == inbox["CRATE-API-1"]:
            raise RuntimeError("database hiccup")
        return real(issue_id)

    task = _queued(["CRATE-API-1", "CRATE-API-2"])
    monkeypatch.setattr(evaluation, "get_triage_input", flaky)
    result = _run(task)

    assert [(i["status"], i.get("error_code")) for i in result["items"]] == [
        ("failed", "EVAL_ITEM_FAILED"),
        ("ok", None),
    ]


def test_handler_names_the_executor_on_the_bulk_lane(monkeypatch):
    from crate.actors import TASK_POOL_CONFIG
    from crate.worker import TASK_HANDLERS
    from crate.worker_handlers import error_inbox

    assert TASK_POOL_CONFIG[EVAL_TASK] == ("ai_bulk", 3, 10800, 0)
    assert TASK_HANDLERS[EVAL_TASK] is error_inbox._handle_evaluate_error_triage
    seen: dict[str, Any] = {}
    progress: list[tuple[int, int, str]] = []

    def run(task_id, params, *, execute, cancelled, progress):
        seen.update(task_id=task_id, execute=execute, cancelled=cancelled())
        progress(0, 2, "CRATE-API-1")
        progress(2, 2, "")
        return {"status": "completed"}

    monkeypatch.setattr(error_inbox, "run_evaluation", run)
    monkeypatch.setattr(error_inbox, "is_cancelled", lambda task_id: False)
    monkeypatch.setattr(
        error_inbox,
        "emit_progress",
        lambda task_id, value, force=False: progress.append(
            (value.done, value.total, value.item)
        ),
    )

    assert error_inbox._handle_evaluate_error_triage("t-1", {}, {}) == {
        "status": "completed"
    }
    assert seen == {
        "task_id": "t-1",
        "execute": runtime.execute_structured,
        "cancelled": False,
    }
    assert progress == [(0, 2, "CRATE-API-1"), (2, 2, "")]


def _cli(command: str, payload: Any) -> tuple[int, dict]:
    from crate.error_inbox.evaluation_cli import main

    out = io.StringIO()
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    status = main([command], stdin=io.StringIO(raw), stdout=out)
    return status, json.loads(out.getvalue())


def test_cli_plans_queues_and_collects_as_json(inbox, monkeypatch):
    _model(monkeypatch, _output())

    status, plan = _cli("plan", {"short_ids": ["CRATE-API-1", "CRATE-API-5"]})
    assert status == 0 and plan["calls"] == 1
    status, queued = _cli(
        "queue",
        {
            "short_ids": ["CRATE-API-1"],
            "expected_fingerprint": plan["fingerprint"],
            "skipped": [{"short_id": "CRATE-API-5", "reason": "no_digest"}],
        },
    )
    assert status == 0 and queued["deduplicated"] is False

    from crate.db.queries.tasks import get_task

    task = get_task(queued["task_id"])
    _finish(task["id"], _run(task))
    status, record = _cli("result", {"task_id": queued["task_id"]})

    assert status == 0 and record["finished"]
    assert record["result"]["items"][0]["prediction"]["classification"] == "bug"
    assert isinstance(record["created_at"], str)
    _private_free([plan, queued, record])


@pytest.mark.parametrize(
    "command,payload,code",
    [
        ("plan", {"short_ids": ["CRATE API 1"]}, "ERROR_TRIAGE_EVAL_INVALID"),
        ("plan", "[1, 2]", "ERROR_TRIAGE_EVAL_INVALID"),
        ("plan", "not json", "ERROR_TRIAGE_EVAL_INVALID"),
        (
            "queue",
            {"short_ids": ["CRATE-API-1"], "expected_fingerprint": "stale"},
            "AI_CONTEXT_STALE",
        ),
        ("result", {"task_id": "missing"}, "ERROR_TRIAGE_EVAL_INVALID"),
    ],
)
def test_cli_failures_are_closed_json(inbox, command, payload, code):
    status, output = _cli(command, payload)

    assert status == 2
    assert output["error"]["code"] == code
