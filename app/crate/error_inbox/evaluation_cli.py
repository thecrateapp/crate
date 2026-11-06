"""Maintainer-only: python -m crate.error_inbox.evaluation_cli {plan,queue,result}.

`tools/error-inbox-eval/run_eval.py` runs it inside the worker container (by default
`docker exec -i crate-worker python -m crate.error_inbox.evaluation_cli <command>`).
It reads one JSON object from stdin and prints one JSON object:

- `plan` `{"short_ids": [...]}`: the bound model and, per short id, whether it can be
  evaluated and how large its request is. Reads only.
- `queue` `{"short_ids": [...], "expected_fingerprint": "...", "skipped": [...]}`:
  queues one `evaluate_error_triage` task on the `ai_bulk` lane. It never calls a
  model itself; the task does, inside the AI-lane window.
- `result` `{"task_id": "..."}`: the task's state and, once it ended, its answers
  and token usage.

Failures print `{"error": {"code": ..., "message": ...}}` and exit with status 2.
No digest, title or event text is ever printed.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from typing import IO, Any

from crate.ai.contracts import AIConfigurationError
from crate.error_inbox.evaluation import (
    evaluation_result,
    plan_evaluation,
    queue_evaluation,
)


def _default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def run(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    if command == "plan":
        return plan_evaluation(payload.get("short_ids"))
    if command == "queue":
        return queue_evaluation(
            payload.get("short_ids"),
            expected_fingerprint=payload.get("expected_fingerprint"),
            skipped=payload.get("skipped"),
        )
    if command == "result":
        return evaluation_result(payload.get("task_id"))
    raise ValueError(f"Unknown command: {command}")


def main(
    argv: list[str] | None = None,
    *,
    stdin: IO[str] | None = None,
    stdout: IO[str] | None = None,
) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m crate.error_inbox.evaluation_cli",
        description="Plan, queue and collect an AI triage evaluation (gate EG2).",
    )
    parser.add_argument("command", choices=("plan", "queue", "result"))
    args = parser.parse_args(argv)
    source, sink = stdin or sys.stdin, stdout or sys.stdout
    try:
        raw = source.read()
        payload = json.loads(raw) if raw.strip() else {}
        if not isinstance(payload, dict):
            raise ValueError("Expected one JSON object on stdin")
        output, status = run(args.command, payload), 0
    except AIConfigurationError as error:
        output = {"error": {"code": error.code, "message": str(error)}}
        status = 2
    except ValueError as error:
        output = {"error": {"code": "ERROR_TRIAGE_EVAL_INVALID", "message": str(error)}}
        status = 2
    sink.write(json.dumps(output, default=_default, sort_keys=True) + "\n")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
