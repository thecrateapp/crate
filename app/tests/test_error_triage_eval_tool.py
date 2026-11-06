"""tools/error-inbox-eval/run_eval.py: metrics, report and the refusals around a run.

The tool is standard-library only and talks to Crate through a command prefix; here
that command is a fake that answers like `crate.error_inbox.evaluation_cli`. Labels
and answers are synthetic, except the check that the real reference set loads.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "tools/error-inbox-eval/run_eval.py"


def _load():
    spec = importlib.util.spec_from_file_location("error_inbox_run_eval", TOOL)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


run_eval = _load()

LEAK = "LEAKED-EVENT-TEXT /music/secret/album.flac"


def _label(group, classification, severity, duplicate_of=None):
    return {
        "group": group,
        "classification": classification,
        "severity": severity,
        "duplicate_of": duplicate_of,
    }


LABELS = {
    "CRATE-API-1": _label("G1", "bug", "high"),
    "CRATE-API-2": _label("G1", "bug", "high", "CRATE-API-1"),
    "CRATE-API-3": _label("G2", "client_environment", "low"),
    "CRATE-API-4": _label("G2", "client_environment", "low", "CRATE-API-3"),
    "CRATE-API-5": _label("G3", "infrastructure", "critical"),
    "CRATE-API-6": _label("G4", "noise", "low"),
    "CRATE-API-7": _label("G5", "bug", "medium"),
    "CRATE-API-8": _label("G6", "external_dependency", "medium"),
    "CRATE-API-9": _label("G7", "bug", "high"),
    "CRATE-API-10": _label("G8", "noise", "low"),
}


def _ok(
    short_id, classification, severity, duplicate_of=None, confidence=0.9, candidates=()
):
    return {
        "short_id": short_id,
        "status": "ok",
        "candidate_ids": list(candidates),
        "frames": 3,
        # Free text a server must never send; the tool must drop it anyway.
        "summary": LEAK,
        "title": LEAK,
        "prediction": {
            "classification": classification,
            "severity": severity,
            "duplicate_of": duplicate_of,
            "confidence": confidence,
            "hypothesis": LEAK,
        },
    }


def _result(**overrides) -> dict[str, Any]:
    result = {
        "status": "completed",
        "action_id": "ops.error.triage",
        "model": {
            "provider": "gemini",
            "model_id": "gemini-2.5-flash",
            "profile_id": "profile-1",
            "profile_version": 2,
            "limits": {"max_input_tokens": 65536, "max_output_tokens": 2048},
        },
        "critical_confidence": 0.6,
        "items": [
            # A unique issue tied to another group: a false duplicate.
            _ok(
                "CRATE-API-1", "bug", "high", "CRATE-API-3", candidates=["CRATE-API-3"]
            ),
            _ok(
                "CRATE-API-2",
                "bug",
                "medium",
                "CRATE-API-1",
                candidates=["CRATE-API-1"],
            ),
            # Names a member of its own group: not a false duplicate.
            _ok(
                "CRATE-API-3", "noise", "low", "CRATE-API-4", candidates=["CRATE-API-4"]
            ),
            # Labelled duplicate, answered none, and its group was never offered.
            _ok(
                "CRATE-API-4", "client_environment", "low", candidates=["CRATE-API-99"]
            ),
            # The worst error: a critical issue taken for noise.
            _ok("CRATE-API-5", "noise", "low", confidence=0.7),
            # A confident critical answer on a low issue: a false alarm.
            _ok("CRATE-API-6", "bug", "critical", confidence=0.65),
            {
                "short_id": "CRATE-API-7",
                "status": "invalid_output",
                "error_code": "AI_RESPONSE_INVALID",
                "candidate_ids": [],
            },
            {
                "short_id": "CRATE-API-8",
                "status": "failed",
                "error_code": "AI_PROVIDER_TIMEOUT",
                "candidate_ids": [],
            },
        ],
        "skipped": [{"short_id": "CRATE-API-9", "reason": "no_digest"}],
        "counts": {},
        "cancelled": False,
    }
    result.update(overrides)
    return result


def _invocations() -> list[dict[str, Any]]:
    rows = []
    for index in range(1, 9):
        known = index != 8
        rows.append(
            {
                "short_id": f"CRATE-API-{index}",
                "status": "succeeded" if known else "timeout",
                "model_id": "gemini-2.5-flash",
                "reported_model": "gemini-2.5-flash" if known else None,
                "usage_known": known,
                "input_tokens": 1000 if known else None,
                "cached_input_tokens": 100 if known else None,
                "output_tokens": 200 if known else None,
                "thought_tokens": 50 if known else None,
                "charged_tokens": 1250 if known else 67584,
                "duration_ms": 900,
            }
        )
    return rows


def _record(task_id="task-1", **overrides) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "status": "completed",
        "finished": True,
        "progress": None,
        "created_at": "2026-11-07T10:00:00+00:00",
        "started_at": "2026-11-07T10:00:05+00:00",
        "updated_at": "2026-11-07T10:09:00+00:00",
        "result": _result(**overrides),
        "invocations": _invocations(),
    }


PRICES = {"gemini-2.5-flash": (1.0, 2.0)}


def test_metrics_count_agreement_worst_errors_and_duplicates():
    run = run_eval.score_run(LABELS, _record(), PRICES)

    assert run["counts"] == {
        "reference": 10,
        "ok": 6,
        "invalid_output": 1,
        "failed": 1,
        "skipped": 2,
        "not_run": 0,
    }
    classification = run["classification"]
    assert (classification["attempted"], classification["answered"]) == (8, 6)
    assert classification["agreed"] == 3
    assert classification["rate"] == 0.375 and classification["rate_answered"] == 0.5
    assert classification["confusion"]["infrastructure"]["noise"] == 1
    assert classification["by_reference"]["bug"] == {"attempted": 3, "agreed": 2}
    severity = run["severity"]
    assert (severity["agreed"], severity["rate"]) == (3, 0.375)
    assert severity["confusion"]["low"]["critical"] == 1

    assert run["critical_as_noise"] == {
        "reference_total": 1,
        "attempted": 1,
        "count": 1,
        "short_ids": ["CRATE-API-5"],
    }
    # CRATE-API-9 is high too, but it was never sent.
    assert run["high_as_noise"] == {
        "reference_total": 3,
        "attempted": 2,
        "count": 0,
        "short_ids": [],
    }
    assert run["false_critical"] == {
        "confidence_threshold": 0.6,
        "count": 1,
        "short_ids": ["CRATE-API-6"],
    }
    duplicates = run["duplicates"]
    assert {
        key: duplicates[key]
        for key in (
            "labelled",
            "agreed",
            "exact",
            "missed",
            "other_group",
            "unreachable",
            "rate",
            "unique_answered",
            "false_duplicates",
        )
    } == {
        "labelled": 2,
        "agreed": 1,
        "exact": 1,
        "missed": 1,
        "other_group": 0,
        "unreachable": 1,
        "rate": 0.5,
        "unique_answered": 4,
        "false_duplicates": 1,
    }
    assert duplicates["short_ids"]["false_duplicates"] == ["CRATE-API-1"]
    assert duplicates["short_ids"]["unreachable"] == ["CRATE-API-4"]
    assert run["eg2"] == {
        "classification_threshold": 0.8,
        "classification_met": False,
        "critical_as_noise_met": False,
        "reference_has_critical": True,
    }


def test_skipped_issues_keep_their_reason():
    run = run_eval.score_run(
        LABELS,
        _record(
            items=[
                *_result()["items"][:-1],
                {"short_id": "CRATE-API-8", "status": "not_run", "reason": "cancelled"},
            ],
            cancelled=True,
        ),
    )

    assert run["skipped"] == [
        {"short_id": "CRATE-API-8", "reason": "cancelled"},
        {"short_id": "CRATE-API-9", "reason": "no_digest"},
        {"short_id": "CRATE-API-10", "reason": "not_queued"},
    ]
    assert run["counts"]["not_run"] == 1 and run["cancelled"] is True
    # A cancelled issue was never sent, so it is not a disagreement.
    assert run["classification"]["attempted"] == 7


def test_invalid_outputs_include_malformed_answers():
    items = _result()["items"]
    items[0] = {**items[0], "prediction": {"classification": "bug"}}
    items[1] = {**items[1], "prediction": {**items[1]["prediction"], "confidence": 7}}
    run = run_eval.score_run(LABELS, _record(items=items))

    assert run["invalid_outputs"] == {
        "count": 3,
        "short_ids": ["CRATE-API-1", "CRATE-API-2", "CRATE-API-7"],
    }
    assert run["failures"] == {
        "count": 1,
        "by_code": {"AI_PROVIDER_TIMEOUT": 1},
        "short_ids": ["CRATE-API-8"],
    }


def test_tokens_and_cost_per_model():
    run = run_eval.score_run(LABELS, _record(), PRICES)

    [(name, usage)] = run["usage"].items()
    assert name == "gemini-2.5-flash"
    assert {
        key: usage[key]
        for key in (
            "calls",
            "usage_known",
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "thought_tokens",
            "mean_input_tokens",
        )
    } == {
        "calls": 8,
        "usage_known": 7,
        "input_tokens": 7000,
        "cached_input_tokens": 700,
        "output_tokens": 1400,
        "thought_tokens": 350,
        "mean_input_tokens": 1000,
    }
    # 7,000 input at $1/M plus 1,750 output and thought at $2/M.
    assert usage["cost_usd"] == pytest.approx(0.0105)
    assert run_eval.score_run(LABELS, _record())["usage"][name]["cost_usd"] is None


def test_report_has_no_event_text(tmp_path):
    run = run_eval.score_run(LABELS, _record(), PRICES)
    md, js = run_eval.write_outputs(
        tmp_path / "error-triage-eval-2026-11-07.md",
        [run],
        {"path": "labels.json", "version": 1, "labels": len(LABELS)},
        date="2026-11-07",
    )

    report, data = md.read_text(), js.read_text()
    for text in (report, data):
        assert "LEAKED" not in text and "/music/" not in text
        assert '"summary"' not in text and '"hypothesis"' not in text
    assert report.startswith("# AI error triage evaluation: 2026-11-07")
    assert "## gemini / gemini-2.5-flash" in report
    assert "Critical issues taken for noise: 1 of 1 sent (CRATE-API-5)" in report
    assert "| CRATE-API-6 | G4 | noise / low | bug / critical | 0.65 |" in report
    assert json.loads(data)["runs"][0]["task_id"] == "task-1"


def test_report_says_when_the_reference_has_no_critical_label(tmp_path):
    labels = {**LABELS, "CRATE-API-5": _label("G3", "infrastructure", "high")}
    run = run_eval.score_run(labels, _record(), PRICES)
    report = run_eval.render_report(
        {
            "date": "2026-11-07",
            "reference": {"path": "labels.json", "version": 1, "labels": 10},
            "runs": [run],
        }
    )

    assert run["critical_as_noise"]["count"] == 0
    assert run["high_as_noise"]["short_ids"] == ["CRATE-API-5"]
    assert "The reference set has no critical label" in report
    assert "(none labelled critical)" in report


def test_reports_merge_runs_by_task(tmp_path):
    path = tmp_path / "report.md"
    meta = {"path": "labels.json", "version": 1, "labels": 10}
    first = run_eval.score_run(LABELS, _record("task-1"))
    second = run_eval.score_run(
        LABELS,
        _record("task-2", model={**_result()["model"], "model_id": "gemini-2.5-pro"}),
    )

    run_eval.write_outputs(path, [first], meta, date="2026-11-07")
    run_eval.write_outputs(path, [second], meta, date="2026-11-07")
    run_eval.write_outputs(path, [first], meta, date="2026-11-07")
    merged = json.loads(path.with_suffix(".json").read_text())
    assert [run["task_id"] for run in merged["runs"]] == ["task-2", "task-1"]
    assert "## gemini / gemini-2.5-pro" in path.read_text()

    run_eval.write_outputs(path, [first], meta, date="2026-11-07", replace=True)
    replaced = json.loads(path.with_suffix(".json").read_text())
    assert [run["task_id"] for run in replaced["runs"]] == ["task-1"]


class FakeCrate:
    """Answers like crate.error_inbox.evaluation_cli and records every request."""

    def __init__(self, plan: dict[str, Any], records: list[dict[str, Any]]):
        self.plan, self.records, self.calls = plan, list(records), []

    def __call__(self, argv: list[str], stdin: str):
        command = argv[-1]
        payload = json.loads(stdin)
        self.calls.append((argv, command, payload))
        if command == "plan":
            answer = self.plan
        elif command == "queue":
            answer = {"task_id": "task-1", "deduplicated": False}
        else:
            answer = self.records.pop(0) if len(self.records) > 1 else self.records[0]
        return subprocess.CompletedProcess(argv, 0, json.dumps(answer) + "\n", "")

    def commands(self) -> list[str]:
        return [command for _, command, _ in self.calls]


def _plan(**overrides) -> dict[str, Any]:
    plan = {
        "action_id": "ops.error.triage",
        "available": True,
        "status": "configured",
        "error_code": None,
        "fingerprint": "fp-1",
        "provider": "gemini",
        "model_id": "gemini-2.5-flash",
        "profile_id": "profile-1",
        "profile_version": 2,
        "limits": {
            "max_input_tokens": 65536,
            "max_output_tokens": 2048,
            "timeout_seconds": 45,
        },
        "items": [
            {"short_id": short_id, "status": "ready", "estimated_input_tokens": 9000}
            for short_id in list(LABELS)[:8]
        ]
        + [
            {"short_id": "CRATE-API-9", "status": "skipped", "reason": "no_digest"},
            {
                "short_id": "CRATE-API-10",
                "status": "skipped",
                "reason": "over_input_limit",
                "estimated_input_tokens": 70000,
            },
        ],
        "calls": 8,
    }
    plan.update(overrides)
    return plan


@pytest.fixture
def labels_file(tmp_path) -> Path:
    path = tmp_path / "labels.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "source": "synthetic",
                "labels": [{"short_id": key, **value} for key, value in LABELS.items()],
            }
        )
    )
    return path


def _main(fake, *args, **kwargs) -> tuple[int, list[str]]:
    lines: list[str] = []
    status = run_eval.main(list(args), runner=fake, echo=lines.append, **kwargs)
    return status, lines


def test_plan_is_a_dry_run_that_sends_only_short_ids(labels_file):
    fake = FakeCrate(_plan(), [])

    status, lines = _main(
        fake,
        "plan",
        "--labels",
        str(labels_file),
        "--price",
        "gemini-2.5-flash=0.3/2.5",
    )

    assert status == 0 and fake.commands() == ["plan"]
    [(argv, _, payload)] = fake.calls
    assert argv == [
        "docker",
        "exec",
        "-i",
        "crate-worker",
        "python",
        "-m",
        "crate.error_inbox.evaluation_cli",
        "plan",
    ]
    assert payload == {"short_ids": list(LABELS)}
    text = "\n".join(lines)
    assert "Nothing has been sent" in text
    assert "ready, one call each: 8" in text
    assert "skipped, no stored digest: 1" in text
    assert "at least 70,000 tokens" in text
    assert "Calls: 8. Input bound: 72,000 tokens" in text
    # 72,000 x $0.30/M + 8 x 2,048 x $2.50/M
    assert "$0.06" in text


def test_run_refuses_without_execute(labels_file):
    fake = FakeCrate(_plan(), [])

    status, lines = _main(fake, "run", "--labels", str(labels_file))

    assert status == 2 and fake.commands() == ["plan"]
    assert "Add --execute to send these 8 calls" in lines[-1]


@pytest.mark.parametrize(
    "args,kwargs,message",
    [
        ((), {"interactive": lambda: False}, "Confirmation needed"),
        ((), {"interactive": lambda: True, "ask": lambda _: "7"}, "Not confirmed"),
        (("--confirm-calls", "9"), {}, "does not match the 8 planned calls"),
    ],
)
def test_run_refuses_without_the_right_confirmation(labels_file, args, kwargs, message):
    fake = FakeCrate(_plan(), [])

    status, lines = _main(
        fake, "run", "--execute", "--labels", str(labels_file), *args, **kwargs
    )

    assert status == 2 and fake.commands() == ["plan"]
    assert message in lines[-1]


def test_run_refuses_without_a_usable_model_or_issues(labels_file):
    unavailable = FakeCrate(_plan(available=False, error_code="AI_ACTION_DISABLED"), [])
    empty = FakeCrate(
        _plan(
            items=[
                {"short_id": "CRATE-API-9", "status": "skipped", "reason": "no_digest"}
            ]
        ),
        [],
    )

    for fake, message in (
        (unavailable, "AI_ACTION_DISABLED"),
        (empty, "nothing to evaluate"),
    ):
        status, lines = _main(
            fake,
            "run",
            "--execute",
            "--confirm-calls",
            "8",
            "--labels",
            str(labels_file),
        )
        assert status == 2 and fake.commands() == ["plan"]
        assert message in lines[-1]


def test_run_with_confirmation_queues_waits_and_writes(labels_file, tmp_path):
    pending = {"task_id": "task-1", "status": "running", "finished": False}
    progress = json.dumps({"done": 3, "total": 8})
    fake = FakeCrate(_plan(), [pending, {**pending, "progress": progress}, _record()])
    output = tmp_path / "out" / "error-triage-eval-2026-11-07.md"
    typed: list[str] = []

    status, lines = _main(
        fake,
        "run",
        "--execute",
        "--labels",
        str(labels_file),
        "--output",
        str(output),
        "--date",
        "2026-11-07",
        "--poll-seconds",
        "0",
        interactive=lambda: True,
        ask=lambda prompt: typed.append(prompt) or "8",
    )

    assert status == 0
    assert fake.commands() == ["plan", "queue", "result", "result", "result"]
    assert typed == ["Type 8 to send 8 calls to gemini / gemini-2.5-flash: "]
    queue = fake.calls[1][2]
    assert queue == {
        "short_ids": list(LABELS)[:8],
        "skipped": [
            {"short_id": "CRATE-API-9", "reason": "no_digest"},
            {"short_id": "CRATE-API-10", "reason": "over_input_limit"},
        ],
        "expected_fingerprint": "fp-1",
    }
    # Only short ids and the fingerprint go to the server, never a label.
    for _, _, payload in fake.calls:
        assert "classification" not in json.dumps(payload)
    assert "running: 3/8" in lines
    assert output.exists() and output.with_suffix(".json").exists()
    assert "LEAKED" not in output.read_text()


def test_run_reports_a_concurrent_evaluation(labels_file):
    class Busy(FakeCrate):
        def __call__(self, argv, stdin):
            if argv[-1] == "queue":
                self.calls.append((argv, "queue", json.loads(stdin)))
                answer = {"task_id": "task-0", "deduplicated": True}
                return subprocess.CompletedProcess(argv, 0, json.dumps(answer), "")
            return super().__call__(argv, stdin)

    fake = Busy(_plan(), [])
    status, lines = _main(
        fake, "run", "--execute", "--confirm-calls", "8", "--labels", str(labels_file)
    )

    assert status == 2 and fake.commands() == ["plan", "queue"]
    assert "task task-0" in lines[-1]


def test_report_collects_finished_tasks_only(labels_file, tmp_path):
    running = FakeCrate(_plan(), [{"task_id": "task-1", "status": "running"}])
    status, lines = _main(
        running, "report", "--task", "task-1", "--labels", str(labels_file)
    )
    assert status == 2 and "still running" in lines[-1]

    done = FakeCrate(_plan(), [_record()])
    output = tmp_path / "report.md"
    status, lines = _main(
        done,
        "report",
        "--task",
        "task-1",
        "--labels",
        str(labels_file),
        "--output",
        str(output),
        "--price",
        "gemini-2.5-flash=1/2",
    )
    assert status == 0 and done.commands() == ["result"]
    assert "$0.0105" in output.read_text()


def test_wait_gives_up_with_the_command_to_resume():
    fake = FakeCrate(_plan(), [{"task_id": "task-1", "status": "pending"}])
    clock = iter([0.0, 10.0])

    with pytest.raises(run_eval.EvalError, match="report --task task-1"):
        run_eval.wait_for(
            run_eval.Crate("python", fake),
            "task-1",
            poll_seconds=1,
            wait_seconds=5,
            sleep=lambda _: None,
            clock=lambda: next(clock),
            echo=lambda _: None,
        )


def test_server_refusals_and_garbage_become_errors():
    def refusing(argv, stdin):
        answer = {"error": {"code": "AI_CONTEXT_STALE", "message": "binding changed"}}
        return subprocess.CompletedProcess(argv, 2, json.dumps(answer), "")

    def broken(argv, stdin):
        return subprocess.CompletedProcess(
            argv, 1, "", "Traceback\nNo module named crate"
        )

    with pytest.raises(run_eval.EvalError, match="AI_CONTEXT_STALE: binding changed"):
        run_eval.Crate("python", refusing)("queue", {})
    with pytest.raises(run_eval.EvalError, match="No module named crate"):
        run_eval.Crate("python", broken)("plan", {})
    with pytest.raises(run_eval.EvalError):
        run_eval.Crate("", broken)


@pytest.mark.parametrize(
    "error,message",
    [
        (FileNotFoundError(2, "No such file or directory"), "Could not run 'ssh'"),
        (subprocess.TimeoutExpired(["ssh"], 600), "did not answer within 600 s"),
    ],
)
def test_a_missing_command_or_a_hung_call_is_a_clean_refusal(
    labels_file, error, message
):
    def runner(argv, stdin):
        raise error

    lines: list[str] = []
    status = run_eval.main(
        ["plan", "--labels", str(labels_file), "--crate", "ssh host python"],
        runner=runner,
        echo=lines.append,
    )

    assert status == 2 and message in lines[-1]


@pytest.mark.parametrize("value", ["model", "model=1", "=1/2", "model=a/b", "m=-1/2"])
def test_prices_are_parsed_strictly(value):
    with pytest.raises(Exception):
        run_eval.parse_price(value)
    assert run_eval.parse_price("gemini-2.5-flash=0.3/2.5") == (
        "gemini-2.5-flash",
        (0.3, 2.5),
    )


def test_the_reference_set_loads():
    reference = run_eval.load_labels()

    assert reference["version"] == 1
    assert len(reference["labels"]) == 79
    assert (
        sum(label["severity"] == "critical" for label in reference["labels"].values())
        == 0
    )
