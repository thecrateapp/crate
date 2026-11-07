"""The AI triage evaluation (gate EG2): plan, queue, the ai_bulk task and its result.

Only the provider transport is fake: admission, budgets, validation and the
invocation ledger are the real ones, against PostgreSQL. Digests are synthetic.
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

import httpx
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
from tests.error_inbox_fakes import (
    SHORT_IDS_PATH,
    FakeSentry,
    configure,
    configure_ai,
    raw_issue,
)
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
        progress("fetch", 0, 1, "CRATE-API-9")
        progress("evaluate", 0, 2, "CRATE-API-1")
        progress("evaluate", 2, 2, "")
        return {"status": "completed"}

    monkeypatch.setattr(error_inbox, "run_evaluation", run)
    monkeypatch.setattr(error_inbox, "is_cancelled", lambda task_id: False)
    monkeypatch.setattr(
        error_inbox,
        "emit_progress",
        lambda task_id, value, force=False: progress.append(
            (value.phase, value.phase_index, value.done, value.total, value.item)
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
    assert progress == [
        ("fetch_references", 0, 0, 1, "CRATE-API-9"),
        ("evaluate_triage", 1, 0, 2, "CRATE-API-1"),
        ("evaluate_triage", 1, 2, 2, ""),
    ]


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


# -- reference issues the inbox does not hold: read from Sentry, kept in memory ----

# Event text only Sentry holds: it may reach the model's prompt, nothing else.
SENTINEL = "SENTINEL-7f3a-fetched-event-text"


def _sentry_event(**options) -> dict[str, Any]:
    event = _event(**options)
    event["entries"].append(
        {
            "type": "breadcrumbs",
            "data": {"values": [{"category": "query", "message": f"{SENTINEL} b"}]},
        }
    )
    frames = event["entries"][0]["data"]["values"][0]["stacktrace"]["frames"]
    frames[-1]["context"] = [[12, f"raise KeyError('{SENTINEL}')"]]
    return event


def _sentry_issue(issue_id: int, **overrides) -> dict[str, Any]:
    return raw_issue(
        issue_id,
        title=f"{SENTINEL} title",
        culprit=f"{SENTINEL} culprit",
        permalink=f"https://ninja-development.sentry.io/issues/{issue_id}/?q={SENTINEL}",
        status="resolved",
        substatus=None,
        **overrides,
    )


@pytest.fixture
def sentry(inbox) -> FakeSentry:
    """Sentry holding six reference issues the inbox does not hold."""
    configure()
    fake = FakeSentry()
    # The same group as CRATE-API-1 (exception type and innermost frame).
    fake.issues["21"] = _sentry_issue(21)
    fake.events["21"] = _sentry_event(value=f"'{SENTINEL}'")
    # The same group as CRATE-API-4.
    fake.issues["22"] = _sentry_issue(22)
    fake.events["22"] = _sentry_event(exception="TimeoutError")
    # Merged into CRATE-API-21: Sentry answers its short id with that issue.
    fake.merged["CRATE-API-23"] = "21"
    # CRATE-API-24 was deleted. CRATE-API-25's events are gone.
    fake.issues["25"] = _sentry_issue(25)
    # CRATE-API-26's latest event cannot be read.
    fake.issues["26"] = _sentry_issue(26)
    fake.events["26"] = _sentry_event()
    fake.fail = lambda request: (
        httpx.Response(502)
        if request.url.path.endswith("/issues/26/events/latest/")
        else None
    )
    return fake


REFERENCES = [f"CRATE-API-{n}" for n in range(21, 27)]


def _rows_holding(value: str) -> int:
    with _scope() as session:
        return session.execute(
            text(
                "SELECT (SELECT count(*) FROM error_issues WHERE digest::text LIKE :v"
                " OR title LIKE :v OR culprit LIKE :v)"
                " + (SELECT count(*) FROM error_issue_triage)"
                " + (SELECT count(*) FROM tasks WHERE params_json::text LIKE :v"
                " OR coalesce(result_json::text, '') LIKE :v)"
            ),
            {"v": f"%{value}%"},
        ).scalar()


def test_reference_issues_outside_the_inbox_are_built_in_memory(
    sentry, monkeypatch, caplog
):
    calls = _model(
        monkeypatch,
        # CRATE-API-1 names an issue only Sentry holds: the candidates are a union.
        _output(duplicate_of="CRATE-API-21"),
        _output(duplicate_of="CRATE-API-1", classification="client_environment"),
        _output(classification="noise", severity="low"),
    )
    task = _queued(["CRATE-API-1", *REFERENCES])
    assert task["params"]["short_ids"] == ["CRATE-API-1", *REFERENCES]

    result = _run(task, sentry_factory=sentry.factory, sleep=lambda seconds: None)

    items = {item["short_id"]: item for item in result["items"]}
    assert [(i["short_id"], i["status"]) for i in result["items"]] == [
        ("CRATE-API-1", "ok"),
        ("CRATE-API-21", "ok"),
        ("CRATE-API-22", "ok"),
        ("CRATE-API-23", "skipped"),
        ("CRATE-API-24", "skipped"),
        ("CRATE-API-25", "skipped"),
        ("CRATE-API-26", "skipped"),
    ]
    assert items["CRATE-API-1"]["source"] == "inbox"
    # Same group first, open issues before resolved ones, then the same exception.
    assert items["CRATE-API-1"]["candidate_ids"] == [
        "CRATE-API-2",
        "CRATE-API-21",
        "CRATE-API-3",
    ]
    assert items["CRATE-API-1"]["prediction"]["duplicate_of"] == "CRATE-API-21"
    fetched = items["CRATE-API-21"]
    assert fetched["source"] == "sentry" and fetched["frames"] == 3
    assert fetched["candidate_ids"] == ["CRATE-API-1", "CRATE-API-2", "CRATE-API-3"]
    assert fetched["prediction"]["classification"] == "client_environment"
    assert items["CRATE-API-22"]["candidate_ids"] == ["CRATE-API-4"]
    assert {
        short_id: (items[short_id]["reason"], items[short_id].get("error_code"))
        for short_id in REFERENCES[2:]
    } == {
        "CRATE-API-23": ("merged", None),
        "CRATE-API-24": ("not_found", None),
        "CRATE-API-25": ("no_event", None),
        "CRATE-API-26": ("fetch_failed", "SENTRY_SERVER"),
    }
    assert result["counts"]["ok"] == 3 and result["counts"]["skipped"] == 4
    assert result["fetch"] == {
        "wanted": 6,
        "built": 2,
        "skipped": 4,
        "requests": 14,
        "budget_exhausted": False,
    }
    # Organization-scoped reads on the configured host; the short id is resolved.
    assert sentry.resolved_short_ids() == REFERENCES
    assert sentry.paths()[:3] == [
        f"{SHORT_IDS_PATH}CRATE-API-21/",
        "/api/0/organizations/ninja-development/issues/21/",
        "/api/0/organizations/ninja-development/issues/21/events/latest/",
    ]

    # The fetched event reached the model's prompt, and only the prompt.
    assert len(calls) == 3
    prompt = calls[1]["prompt"]
    assert SENTINEL in prompt
    assert f"{SENTINEL} title" not in prompt and f"{SENTINEL} culprit" not in prompt
    assert "sentry.io/issues" not in prompt
    record = _finished(task, result)
    for value in (result, record):
        assert SENTINEL not in json.dumps(value, default=str)
        _private_free(value)
    assert SENTINEL not in caplog.text
    assert _rows_holding(SENTINEL) == 0
    with _scope() as session:
        assert session.execute(text("SELECT count(*) FROM error_issues")).scalar() == 5


def _finished(task: dict, result: dict) -> dict:
    _finish(task["id"], result)
    return evaluation_result(task["id"])


def test_fetched_issue_is_triaged_exactly_as_the_sync_would_store_it(
    sentry, monkeypatch
):
    """The in-memory input equals the inbox row the sync builds for that issue."""
    from crate.db.queries.error_issues import get_triage_input
    from crate.error_inbox.references import reference_input
    from crate.error_inbox.sentry_client import normalize_issue
    from crate.worker_handlers.error_inbox import sync_issues

    issue = normalize_issue(sentry.issues["21"])
    built = reference_input(issue, sentry.events["21"])

    # Let the sync store the same issue as a resolved one it no longer lists.
    sentry.issues["21"] = {**sentry.issues["21"], "status": "unresolved"}
    sentry.full = [sentry.issues["21"]]
    sentry.fail = None
    assert sync_issues(client_factory=sentry.factory)["status"] == "ok"
    from crate.db.queries.error_issues import issue_ids_by_short_id

    stored = get_triage_input(issue_ids_by_short_id(["CRATE-API-21"])["CRATE-API-21"])
    assert stored is not None
    for key in ("digest", "digest_hash", "group_key", "service", "level"):
        assert built[key] == stored[key], key
    assert "title" not in built and "culprit" not in built and "permalink" not in built
    assert built["id"] is None and built["candidates"] == []


def test_a_rejected_token_stops_the_reads_and_the_rest_is_still_evaluated(
    sentry, monkeypatch
):
    calls = _model(monkeypatch, _output())
    sentry.fail = lambda request: httpx.Response(401)
    task = _queued(["CRATE-API-1", *REFERENCES])

    result = _run(task, sentry_factory=sentry.factory, sleep=lambda seconds: None)

    assert [(i["short_id"], i["status"]) for i in result["items"]][:2] == [
        ("CRATE-API-1", "ok"),
        ("CRATE-API-21", "skipped"),
    ]
    assert {(i.get("reason"), i.get("error_code")) for i in result["items"][1:]} == {
        ("fetch_failed", "SENTRY_AUTH")
    }
    # One request: the token is not tried again for every issue.
    assert len(sentry.requests) == 1
    assert len(calls) == 1


def test_rate_limits_are_waited_out_and_the_budget_bounds_the_reads(
    sentry, monkeypatch
):
    from crate.error_inbox import references

    _model(monkeypatch, _output(), _output())
    limited = {"left": 1}

    def throttle(request: httpx.Request):
        if limited["left"] and request.url.path.endswith("/CRATE-API-21/"):
            limited["left"] -= 1
            return httpx.Response(429, headers={"Retry-After": "7"})
        return None

    sentry.fail = throttle
    now = {"t": 0.0}
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now["t"] += seconds

    def clock() -> float:
        # Each read takes 100 s here, so the budget ends after two issues.
        now["t"] += 100.0
        return now["t"]

    fetched = references.fetch_references(
        REFERENCES, client_factory=sentry.factory, clock=clock, sleep=sleep
    )

    assert 7.0 in slept
    assert set(fetched.issues) == {"CRATE-API-21"}
    assert fetched.budget_exhausted is True
    assert {fetched.skipped[s]["reason"] for s in REFERENCES[2:]} == {"fetch_budget"}
    # The 429 and its retry, then nothing once the budget is spent.
    assert sentry.resolved_short_ids() == ["CRATE-API-21", "CRATE-API-21"]


def test_a_429_that_persists_skips_that_issue_only(sentry):
    from crate.error_inbox import references

    sentry.fail = lambda request: (
        httpx.Response(429, headers={"Retry-After": "2"})
        if request.url.path.endswith("/CRATE-API-21/")
        else None
    )

    fetched = references.fetch_references(
        REFERENCES[:2], client_factory=sentry.factory, sleep=lambda seconds: None
    )

    assert fetched.skipped["CRATE-API-21"] == {
        "reason": "fetch_failed",
        "error_code": "SENTRY_RATE_LIMITED",
    }
    assert set(fetched.issues) == {"CRATE-API-22"}
    assert sentry.resolved_short_ids().count("CRATE-API-21") == 2


def test_cancelling_during_the_reads_runs_nothing(sentry, monkeypatch):
    calls = _model(monkeypatch, _output())
    task = _queued(["CRATE-API-1", *REFERENCES])
    checks = iter([False, True])

    result = _run(
        task,
        sentry_factory=sentry.factory,
        cancelled=lambda: next(checks, True),
        sleep=lambda seconds: None,
    )

    assert result["cancelled"] is True
    assert {item["status"] for item in result["items"]} == {"not_run"}
    assert calls == []
    assert sentry.resolved_short_ids() == ["CRATE-API-21"]


def test_plan_counts_what_the_task_will_fetch_without_calling_sentry(
    sentry, monkeypatch
):
    from crate.error_inbox import references
    from crate.error_inbox.evaluation import request_bounds

    monkeypatch.setattr(
        references, "SentryClient", lambda *args, **kwargs: pytest.fail("Sentry")
    )

    plan = plan_evaluation(["CRATE-API-1", "CRATE-API-5", *REFERENCES])

    largest, per_candidate = request_bounds()
    sentry_items = [i for i in plan["items"] if i.get("source") == "sentry"]
    assert [i["short_id"] for i in sentry_items] == REFERENCES
    assert {i["estimated_input_tokens"] for i in sentry_items} == {largest}
    assert plan["sources"] == {"inbox": 1, "sentry": 6}
    assert plan["calls"] == 7
    assert plan["sentry"] == {
        "available": True,
        "error_code": None,
        "requests": 18,
        "budget_seconds": 600.0,
    }
    [inbox_item] = [i for i in plan["items"] if i.get("source") == "inbox"]
    # Room for the candidates fetched issues may add, up to ten.
    room = (10 - inbox_item["candidates"]) * per_candidate
    assert plan["input_bound"] == 6 * largest + (
        inbox_item["estimated_input_tokens"] + room
    )
    assert plan["action_limits"] == {"max_output_tokens": 8192, "timeout_seconds": 90}
    assert sentry.requests == []
    _private_free(plan)


def test_plan_without_sentry_skips_issues_outside_the_inbox(inbox):
    plan = plan_evaluation(["CRATE-API-1", "CRATE-API-21"])

    assert plan["items"][1] == {
        "short_id": "CRATE-API-21",
        "status": "skipped",
        "reason": "not_in_inbox",
    }
    assert plan["sources"] == {"inbox": 1, "sentry": 0}
    assert plan["sentry"]["available"] is False
    assert plan["sentry"]["error_code"] == "ERROR_TRACKING_NOT_CONFIGURED"
    assert plan["input_bound"] == plan["items"][0]["estimated_input_tokens"]


def test_the_largest_request_bounds_a_real_one(inbox):
    from crate.error_inbox.evaluation import request_bounds

    largest, per_candidate = request_bounds()
    plan = plan_evaluation(["CRATE-API-1"])

    assert 24 * 1024 < largest < 65536
    assert 0 < per_candidate < 2048
    assert plan["items"][0]["estimated_input_tokens"] < largest


def test_a_fetched_request_over_the_input_limit_is_skipped(pg_db, monkeypatch):
    configure_ai(monkeypatch, (TRIAGE,), max_input_tokens=4096)
    configure()
    fake = FakeSentry()
    fake.issues["21"] = _sentry_issue(21)
    fake.events["21"] = _sentry_event()
    calls = _model(monkeypatch, _output())
    task = _queued(["CRATE-API-21"])

    result = _run(task, sentry_factory=fake.factory, sleep=lambda seconds: None)

    [item] = result["items"]
    assert (item["status"], item["reason"]) == ("skipped", "over_input_limit")
    assert item["estimated_input_tokens"] > 4096
    assert calls == []


def test_candidates_merge_in_the_inbox_order():
    from crate.error_inbox.references import with_references

    def inbox(short_id, *, same_group, status, score, seen, row):
        return {
            "id": f"00000000-0000-4000-8000-{row:012d}",
            "short_id": short_id,
            "same_group": same_group,
            "status": status,
            "crate_score": score,
            "last_seen": seen,
        }

    digest = {"exceptions": [{"type": "KeyError"}], "frames": [{"function": "f"}]}
    target = {"short_id": "CRATE-API-1", "group_key": "g", "digest": digest}
    listed = [
        inbox(
            "CRATE-API-2",
            same_group=True,
            status="unresolved",
            score=30,
            seen="2026-11-04T11:00:00+00:00",
            row=2,
        ),
        inbox(
            "CRATE-API-3",
            same_group=False,
            status="unresolved",
            score=90,
            seen="2026-11-04T11:00:00+00:00",
            row=3,
        ),
    ]

    def reference(short_id, *, group, kind="KeyError", status="resolved", score=50):
        return {
            "short_id": short_id,
            "group_key": group,
            "status": status,
            "crate_score": score,
            "last_seen": datetime(2026, 11, 5, tzinfo=timezone.utc),
            "digest": {"exceptions": [{"type": kind}], "frames": [{"function": "g"}]},
        }

    references = {
        "CRATE-API-1": reference("CRATE-API-1", group="g"),  # the target itself
        "CRATE-API-21": reference("CRATE-API-21", group="g", status="unresolved"),
        "CRATE-API-22": reference("CRATE-API-22", group="other"),  # same type
        "CRATE-API-23": reference("CRATE-API-23", group="x", kind="TimeoutError"),
    }

    merged = with_references(target, listed, references)

    assert [c["short_id"] for c in merged] == [
        # Same group, open: the higher score first.
        "CRATE-API-21",
        "CRATE-API-2",
        # Same exception type: open first.
        "CRATE-API-3",
        "CRATE-API-22",
    ]
    added = merged[0]
    assert added["id"] is None and added["same_group"] is True
    assert added["exception"] == {"type": "KeyError"}
    assert added["top_frame"] == {"function": "g"}
    assert with_references(target, listed, {}) == listed
    many = {
        f"CRATE-API-{n}": reference(f"CRATE-API-{n}", group="g") for n in range(30, 45)
    }
    assert len(with_references(target, listed, many)) == 10


def test_a_broken_sentry_connection_still_evaluates_the_inbox(sentry, monkeypatch):
    from crate.error_inbox import references

    calls = _model(monkeypatch, _output())

    def broken():
        raise RuntimeError(f"{SENTINEL} in a message")

    task = _queued(["CRATE-API-1", "CRATE-API-21"])
    monkeypatch.setattr(references, "load_config", broken)

    result = _run(task, sentry_factory=sentry.factory)

    assert [(i["short_id"], i["status"]) for i in result["items"]] == [
        ("CRATE-API-1", "ok"),
        ("CRATE-API-21", "skipped"),
    ]
    assert result["items"][1]["error_code"] == "EVAL_FETCH_FAILED"
    assert len(calls) == 1
    assert SENTINEL not in json.dumps(result)


def test_candidate_times_rank_to_the_microsecond():
    from crate.error_inbox.references import with_references

    digest = {"exceptions": [{"type": "KeyError"}], "frames": []}
    target = {"short_id": "CRATE-API-1", "group_key": "g", "digest": digest}
    later = {
        "id": "00000000-0000-4000-8000-000000000009",
        "short_id": "CRATE-API-9",
        "same_group": True,
        "status": "resolved",
        "crate_score": 5,
        "last_seen": "2026-11-05T10:00:00.000001+00:00",
    }
    earlier = {
        "short_id": "CRATE-API-21",
        "group_key": "g",
        "status": "resolved",
        "crate_score": 5,
        "last_seen": datetime(2026, 11, 5, 10, tzinfo=timezone.utc),
        "digest": digest,
    }

    merged = with_references(target, [later], {"CRATE-API-21": earlier})

    # One microsecond later still ranks first, whatever the ids.
    assert [c["short_id"] for c in merged] == ["CRATE-API-9", "CRATE-API-21"]
