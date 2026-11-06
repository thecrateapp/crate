#!/usr/bin/env python3
"""Measure Crate's AI error triage against the E0 reference set (gate EG2).

Standard library only; it never imports `crate` and never calls a model. It drives
`python -m crate.error_inbox.evaluation_cli` inside the worker container through a
command prefix (`--crate`, by default `docker exec -i crate-worker python`):

    plan    dry run: the bound model, which reference issues have a stored digest,
            how many calls an evaluation makes and their token bound. Sends nothing.
    run     plan, then, only with --execute and a typed confirmation of the number of
            calls, queue one `evaluate_error_triage` task (ai_bulk lane), wait for it
            and write the report.
    report  collect finished evaluation tasks by id and write the report.

Only short ids go to the server; the reference labels stay here. The report and its
JSON hold labels, short ids, counts and token figures: no event text, file names or
titles. See README.md next to this file.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
import time
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
LABELS = ROOT / "app/tests/fixtures/error_inbox/reference_labels.json"
OUTPUT_DIR = ROOT / "docs/technical/evidence/observability"
DEFAULT_CRATE = "docker exec -i crate-worker python"
CLI_MODULE = "crate.error_inbox.evaluation_cli"
SCHEMA_VERSION = 1
CLASSIFICATIONS = (
    "bug",
    "infrastructure",
    "external_dependency",
    "client_environment",
    "noise",
)
SEVERITIES = ("critical", "high", "medium", "low")
STATUSES = ("ok", "invalid_output", "failed", "skipped", "not_run")
EG2_CLASSIFICATION = 0.8
ACTION_MAX_OUTPUT_TOKENS = 2048
SHORT_ID = re.compile(r"[A-Z0-9][A-Z0-9_-]{0,62}-[A-Z0-9]+")
CODE = re.compile(r"[A-Z][A-Z0-9_]{0,79}")
MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}")
SKIP_TEXT = {
    "not_in_inbox": "not in the inbox",
    "no_digest": "no stored digest",
    "over_input_limit": "over the profile's input limit",
    "not_queued": "not queued",
    "cancelled": "cancelled",
}

Runner = Callable[[list[str], str], "subprocess.CompletedProcess[str]"]


class EvalError(Exception):
    """A refusal or failure the tool reports and exits on."""


# -- reference labels ---------------------------------------------------------


def load_labels(path: Path = LABELS) -> dict[str, Any]:
    """The reference set: `{"version", "source", "labels": {short_id: label}}`."""
    data = json.loads(path.read_text(encoding="utf-8"))
    labels: dict[str, dict[str, Any]] = {}
    for label in data["labels"]:
        short_id = label["short_id"]
        if (
            not SHORT_ID.fullmatch(short_id)
            or label["classification"] not in CLASSIFICATIONS
            or label["severity"] not in SEVERITIES
            or short_id in labels
        ):
            raise EvalError(f"Invalid reference label for {short_id!r}")
        labels[short_id] = {
            "group": label.get("group"),
            "classification": label["classification"],
            "severity": label["severity"],
            "duplicate_of": label.get("duplicate_of"),
        }
    return {
        "version": data.get("version"),
        "source": data.get("source"),
        "labels": labels,
    }


# -- the server ---------------------------------------------------------------


def _run(argv: list[str], stdin: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 — the maintainer's own command prefix.
        argv, input=stdin, capture_output=True, text=True, timeout=600, check=False
    )


class Crate:
    """Runs one evaluation CLI command inside Crate and returns its JSON answer."""

    def __init__(self, command: str = DEFAULT_CRATE, runner: Runner | None = None):
        self.prefix = shlex.split(command)
        if not self.prefix:
            raise EvalError("--crate needs a command that runs Crate's Python")
        self.runner = runner or _run

    def __call__(self, command: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        argv = [*self.prefix, "-m", CLI_MODULE, command]
        try:
            process = self.runner(argv, json.dumps(payload))
        except subprocess.TimeoutExpired:
            raise EvalError(f"`{command}` did not answer within 600 s") from None
        except OSError as error:
            raise EvalError(
                f"Could not run {self.prefix[0]!r}: {error.strerror}"
            ) from None
        lines = (process.stdout or "").strip().splitlines()
        try:
            answer = json.loads(lines[-1]) if lines else None
        except ValueError:
            answer = None
        if not isinstance(answer, dict):
            tail = (process.stderr or "").strip().splitlines()[-1:]
            raise EvalError(
                f"`{command}` gave no answer (exit {process.returncode})"
                + (f": {tail[0][:200]}" if tail else "")
            )
        error = answer.get("error")
        if isinstance(error, dict):
            raise EvalError(
                f"`{command}` refused: {error.get('code')}: {error.get('message')}"
            )
        if process.returncode != 0:
            raise EvalError(f"`{command}` failed (exit {process.returncode})")
        return answer


# -- prices -------------------------------------------------------------------


def parse_price(value: str) -> tuple[str, tuple[float, float]]:
    """`MODEL=IN/OUT`: US dollars per million input and output tokens."""
    try:
        model, rates = value.split("=", 1)
        input_rate, output_rate = (float(part) for part in rates.split("/", 1))
    except ValueError:
        raise argparse.ArgumentTypeError(
            "use MODEL=IN/OUT, dollars per million tokens"
        ) from None
    if not model or input_rate < 0 or output_rate < 0:
        raise argparse.ArgumentTypeError("use MODEL=IN/OUT, dollars per million tokens")
    return model, (input_rate, output_rate)


def _price(prices: Mapping[str, tuple[float, float]], *models: Any):
    for model in models:
        if isinstance(model, str) and model in prices:
            return model, prices[model]
    return None, None


def _cost(rates: tuple[float, float], input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * rates[0] + output_tokens * rates[1]) / 1_000_000


# -- plan ---------------------------------------------------------------------


def describe_plan(
    plan: Mapping[str, Any], prices: Mapping[str, tuple[float, float]]
) -> str:
    """What `run --execute` would send, as text. Nothing here has been sent."""
    items = plan.get("items") or []
    ready = [item for item in items if item.get("status") == "ready"]
    reasons = Counter(
        str(item.get("reason")) for item in items if item.get("status") == "skipped"
    )
    limits = plan.get("limits") or {}
    output_limit = limits.get("max_output_tokens") or ACTION_MAX_OUTPUT_TOKENS
    input_bound = sum(int(item.get("estimated_input_tokens") or 0) for item in ready)
    profile = (
        f" (profile {plan.get('profile_id')} v{plan.get('profile_version')})"
        if plan.get("profile_id")
        else ""
    )
    lines = [
        "AI triage evaluation plan. Nothing has been sent.",
        "",
        f"Action {plan.get('action_id')}: "
        + (
            f"{plan.get('provider')} / {plan.get('model_id')}{profile}, "
            f"{plan.get('status')}"
            if plan.get("available")
            else f"unavailable ({plan.get('error_code')})"
        ),
    ]
    if any(limits.get(key) for key in limits):
        lines.append(
            "Profile limits: input "
            f"{_tokens(limits.get('max_input_tokens'))}, output "
            f"{_tokens(limits.get('max_output_tokens'))}, timeout "
            f"{limits.get('timeout_seconds') or 'unknown'} s"
        )
    lines += [
        f"Reference issues: {len(items)}",
        f"  ready, one call each: {len(ready)}",
    ]
    for reason, count in sorted(reasons.items()):
        lines.append(f"  skipped, {SKIP_TEXT.get(reason, reason)}: {count}")
    over = [item for item in items if item.get("reason") == "over_input_limit"]
    if over:
        needed = max(int(item.get("estimated_input_tokens") or 0) for item in over)
        lines.append(
            f"  Raise the profile's input limit to at least {needed:,} tokens to "
            "include them."
        )
    lines += [
        "",
        "Each call sends the bound provider the issue's sanitized digest (exception "
        "chain, the app's frames with the code lines Sentry stored, allowlisted tags, "
        "short breadcrumbs), its service, level, status, counts and releases, and up "
        "to ten duplicate candidates reduced to short id, status, main exception and "
        "innermost frame. Titles, culprits, links and the reference labels are not "
        "sent. Nothing is saved to the inbox.",
        "",
        f"Calls: {len(ready)}. Input bound: {input_bound:,} tokens (Crate's "
        "one-token-per-byte estimate; real counts are lower). Output: at most "
        f"{len(ready) * output_limit:,} tokens.",
    ]
    model, rates = _price(prices, plan.get("model_id"))
    if rates is not None:
        bound = _cost(rates, input_bound, len(ready) * output_limit)
        lines.append(
            f"Cost bound at ${rates[0]:g} / ${rates[1]:g} per million tokens "
            f"({model}): ${bound:.2f}"
        )
    return "\n".join(lines)


def _tokens(value: Any) -> str:
    return f"{value:,} tokens" if isinstance(value, int) else "unknown"


def confirm(
    calls: int,
    plan: Mapping[str, Any],
    expected: int | None,
    *,
    ask: Callable[[str], str] = input,
    interactive: Callable[[], bool] = sys.stdin.isatty,
) -> None:
    """Refuse unless the person confirmed exactly this number of calls."""
    if expected is not None:
        if expected != calls:
            raise EvalError(
                f"--confirm-calls {expected} does not match the {calls} planned calls"
            )
        return
    if not interactive():
        raise EvalError(
            f"Confirmation needed: run from a terminal or add --confirm-calls {calls}"
        )
    answer = ask(
        f"Type {calls} to send {calls} calls to "
        f"{plan.get('provider')} / {plan.get('model_id')}: "
    )
    if answer.strip() != str(calls):
        raise EvalError("Not confirmed; nothing was sent")


# -- scoring ------------------------------------------------------------------


def _prediction(item: Mapping[str, Any]) -> dict[str, Any] | None:
    """Only the closed fields of an answer; anything else is dropped."""
    value = item.get("prediction")
    if not isinstance(value, Mapping):
        return None
    duplicate = value.get("duplicate_of")
    confidence = value.get("confidence")
    if (
        value.get("classification") not in CLASSIFICATIONS
        or value.get("severity") not in SEVERITIES
        or (
            duplicate is not None
            and not (isinstance(duplicate, str) and SHORT_ID.fullmatch(duplicate))
        )
        or type(confidence) not in {int, float}
        or not 0 <= confidence <= 1
    ):
        return None
    return {
        "classification": value["classification"],
        "severity": value["severity"],
        "duplicate_of": duplicate,
        "confidence": round(float(confidence), 3),
    }


def _code(value: Any) -> str | None:
    return value if isinstance(value, str) and CODE.fullmatch(value) else None


def _short_ids(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [v for v in values if isinstance(v, str) and SHORT_ID.fullmatch(v)][:10]


def _rows(labels: Mapping[str, Mapping], result: Mapping[str, Any]) -> list[dict]:
    """One row per reference issue: its label, what happened and the answer."""
    items = {
        item["short_id"]: item
        for item in result.get("items") or []
        if isinstance(item, Mapping) and isinstance(item.get("short_id"), str)
    }
    skipped = {
        item["short_id"]: item.get("reason")
        for item in result.get("skipped") or []
        if isinstance(item, Mapping) and isinstance(item.get("short_id"), str)
    }
    rows = []
    for short_id, label in labels.items():
        item = items.get(short_id)
        status = item.get("status") if item else "skipped"
        if status not in STATUSES:
            status = "failed"
        reason = (item or {}).get("reason") if item else skipped.get(short_id)
        prediction = _prediction(item) if item and status == "ok" else None
        if status == "ok" and prediction is None:
            status = "invalid_output"
        rows.append(
            {
                "short_id": short_id,
                "group": label.get("group"),
                "reference": {
                    "classification": label["classification"],
                    "severity": label["severity"],
                    "duplicate_of": label.get("duplicate_of"),
                },
                "status": status,
                "reason": (reason if reason in SKIP_TEXT else "not_queued")
                if status in {"skipped", "not_run"}
                else None,
                "error_code": _code((item or {}).get("error_code")),
                "prediction": prediction,
                "candidate_ids": _short_ids((item or {}).get("candidate_ids")),
            }
        )
    return rows


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def _agreement(rows: list[dict], field: str, values: Iterable[str]) -> dict:
    attempted = [r for r in rows if r["status"] in {"ok", "invalid_output", "failed"}]
    answered = [r for r in attempted if r["prediction"]]
    agreed = [r for r in answered if r["prediction"][field] == r["reference"][field]]
    confusion = {value: dict.fromkeys(values, 0) for value in values}
    by_reference: dict[str, dict[str, int]] = {
        value: {"attempted": 0, "agreed": 0} for value in values
    }
    for row in attempted:
        by_reference[row["reference"][field]]["attempted"] += 1
    for row in answered:
        confusion[row["reference"][field]][row["prediction"][field]] += 1
    for row in agreed:
        by_reference[row["reference"][field]]["agreed"] += 1
    return {
        "attempted": len(attempted),
        "answered": len(answered),
        "agreed": len(agreed),
        "rate": _rate(len(agreed), len(attempted)),
        "rate_answered": _rate(len(agreed), len(answered)),
        "confusion": confusion,
        "by_reference": by_reference,
    }


def _taken_for_noise(rows: list[dict], severity: str) -> dict:
    attempted = [
        r
        for r in rows
        if r["status"] in {"ok", "invalid_output", "failed"}
        and r["reference"]["severity"] == severity
    ]
    noise = [
        r["short_id"]
        for r in attempted
        if r["prediction"] and r["prediction"]["classification"] == "noise"
    ]
    return {
        "reference_total": sum(r["reference"]["severity"] == severity for r in rows),
        "attempted": len(attempted),
        "count": len(noise),
        "short_ids": noise,
    }


def _duplicates(rows: list[dict], labels: Mapping[str, Mapping]) -> dict:
    def root(short_id: str | None) -> str | None:
        label = labels.get(short_id) if short_id else None
        return (label.get("duplicate_of") or short_id) if label else None

    answered = [r for r in rows if r["prediction"]]
    labelled = [r for r in answered if r["reference"]["duplicate_of"]]
    counts = Counter()
    lists: dict[str, list[str]] = defaultdict(list)
    for row in labelled:
        expected = row["reference"]["duplicate_of"]
        named = row["prediction"]["duplicate_of"]
        if not any(root(c) == expected for c in row["candidate_ids"]):
            counts["unreachable"] += 1
            lists["unreachable"].append(row["short_id"])
        if named is None:
            counts["missed"] += 1
            lists["missed"].append(row["short_id"])
        elif root(named) == expected:
            counts["agreed"] += 1
            counts["exact"] += named == expected
        else:
            counts["other_group"] += 1
            lists["other_group"].append(row["short_id"])
    unique = [r for r in answered if not r["reference"]["duplicate_of"]]
    false = [
        r["short_id"]
        for r in unique
        if r["prediction"]["duplicate_of"]
        and root(r["prediction"]["duplicate_of"]) != root(r["short_id"])
    ]
    return {
        "labelled": len(labelled),
        "agreed": counts["agreed"],
        "exact": counts["exact"],
        "missed": counts["missed"],
        "other_group": counts["other_group"],
        "unreachable": counts["unreachable"],
        "rate": _rate(counts["agreed"], len(labelled)),
        "unique_answered": len(unique),
        "false_duplicates": len(false),
        "short_ids": {**lists, "false_duplicates": false},
    }


def _usage(
    invocations: list[Mapping[str, Any]],
    model: Mapping[str, Any],
    prices: Mapping[str, tuple[float, float]],
) -> dict[str, Any]:
    by_model: dict[str, dict[str, Any]] = {}
    for row in invocations:
        name = row.get("reported_model") or row.get("model_id") or "unknown"
        name = name if isinstance(name, str) and MODEL.fullmatch(name) else "unknown"
        entry = by_model.setdefault(
            name,
            {
                "calls": 0,
                "usage_known": 0,
                "input_tokens": 0,
                "cached_input_tokens": 0,
                "output_tokens": 0,
                "thought_tokens": 0,
                "charged_tokens": 0,
                "duration_ms": 0,
            },
        )
        entry["calls"] += 1
        entry["usage_known"] += bool(row.get("usage_known"))
        for key in (
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "thought_tokens",
            "charged_tokens",
            "duration_ms",
        ):
            value = row.get(key)
            if type(value) is int and value >= 0:
                entry[key] += value
    for name, entry in by_model.items():
        entry["mean_input_tokens"] = (
            round(entry["input_tokens"] / entry["usage_known"])
            if entry["usage_known"]
            else None
        )
        priced, rates = _price(prices, name, model.get("model_id"))
        entry["price"] = (
            {
                "model": priced,
                "input_per_million": rates[0],
                "output_per_million": rates[1],
            }
            if rates
            else None
        )
        entry["cost_usd"] = (
            round(
                _cost(
                    rates,
                    entry["input_tokens"],
                    entry["output_tokens"] + entry["thought_tokens"],
                ),
                4,
            )
            if rates
            else None
        )
    return by_model


def score_run(
    labels: Mapping[str, Mapping[str, Any]],
    record: Mapping[str, Any],
    prices: Mapping[str, tuple[float, float]] | None = None,
) -> dict[str, Any]:
    """The metrics of one evaluation task against the reference labels."""
    result = record.get("result") or {}
    model = result.get("model") or {}
    threshold = result.get("critical_confidence")
    threshold = threshold if type(threshold) in {int, float} else 0.6
    rows = _rows(labels, result)
    statuses = Counter(row["status"] for row in rows)
    classification = _agreement(rows, "classification", CLASSIFICATIONS)
    critical = _taken_for_noise(rows, "critical")
    false_critical = [
        row["short_id"]
        for row in rows
        if row["prediction"]
        and row["prediction"]["severity"] == "critical"
        and row["prediction"]["confidence"] >= threshold
        and row["reference"]["severity"] != "critical"
    ]
    failures = Counter(
        row["error_code"] or "unknown" for row in rows if row["status"] == "failed"
    )
    return {
        "task_id": record.get("task_id"),
        "task_status": record.get("status"),
        "created_at": record.get("created_at"),
        "started_at": record.get("started_at"),
        "finished_at": record.get("updated_at"),
        "task_error_code": _code(result.get("error_code")),
        "cancelled": bool(result.get("cancelled")),
        "model": {
            key: model.get(key)
            for key in ("provider", "model_id", "profile_id", "profile_version")
        }
        | {"limits": model.get("limits") or {}},
        "counts": {"reference": len(rows), **{s: statuses.get(s, 0) for s in STATUSES}},
        "skipped": [
            {"short_id": r["short_id"], "reason": r["reason"]}
            for r in rows
            if r["status"] in {"skipped", "not_run"}
        ],
        "classification": classification,
        "severity": _agreement(rows, "severity", SEVERITIES),
        "critical_as_noise": critical,
        "high_as_noise": _taken_for_noise(rows, "high"),
        "false_critical": {
            "confidence_threshold": threshold,
            "count": len(false_critical),
            "short_ids": false_critical,
        },
        "duplicates": _duplicates(rows, labels),
        "invalid_outputs": {
            "count": statuses.get("invalid_output", 0),
            "short_ids": [
                r["short_id"] for r in rows if r["status"] == "invalid_output"
            ],
        },
        "failures": {
            "count": statuses.get("failed", 0),
            "by_code": dict(sorted(failures.items())),
            "short_ids": [r["short_id"] for r in rows if r["status"] == "failed"],
        },
        "usage": _usage(list(record.get("invocations") or []), model, prices or {}),
        "eg2": {
            "classification_threshold": EG2_CLASSIFICATION,
            "classification_met": (classification["rate"] or 0) >= EG2_CLASSIFICATION,
            "critical_as_noise_met": critical["count"] == 0,
            "reference_has_critical": critical["reference_total"] > 0,
        },
        "items": rows,
    }


# -- report -------------------------------------------------------------------


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _ids(values: Iterable[str]) -> str:
    values = list(values)
    return ", ".join(values) if values else "none"


def _model_name(run: Mapping[str, Any]) -> str:
    model = run.get("model") or {}
    return (
        f"{model.get('provider') or 'unknown'} / {model.get('model_id') or 'unknown'}"
    )


def _table(
    header: list[str], rows: Iterable[Iterable[Any]], align: str = ""
) -> list[str]:
    """A Markdown table; `align` has one `l` or `r` per column (default: first left)."""
    align = align or "l" + "r" * (len(header) - 1)
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join("---" if a == "l" else "---:" for a in align) + "|",
    ]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return lines


def _confusion(
    name: str, block: Mapping[str, Any], values: tuple[str, ...]
) -> list[str]:
    lines = [
        f"### {name}",
        "",
        f"Agreement: {block['agreed']}/{block['attempted']} issues sent "
        f"({_pct(block['rate'])}); {block['agreed']}/{block['answered']} valid "
        f"answers ({_pct(block['rate_answered'])}). Rows are the reference label, "
        "columns the model's answer.",
        "",
    ]
    lines += _table(
        ["Reference", *values, "Agreed"],
        (
            [
                value,
                *(block["confusion"][value][other] for other in values),
                f"{block['by_reference'][value]['agreed']}/"
                f"{block['by_reference'][value]['attempted']}",
            ]
            for value in values
            if block["by_reference"][value]["attempted"]
        ),
    )
    return [*lines, ""]


def _cost_text(usage: Mapping[str, Mapping[str, Any]]) -> str:
    costs = [entry["cost_usd"] for entry in usage.values()]
    if not costs or any(cost is None for cost in costs):
        return "unknown"
    return f"${sum(costs):.2f}"


def _summary_row(run: Mapping[str, Any]) -> list[Any]:
    counts, duplicates = run["counts"], run["duplicates"]
    usage = run["usage"]
    sent = counts["ok"] + counts["invalid_output"] + counts["failed"]
    tokens_in = sum(entry["input_tokens"] for entry in usage.values())
    tokens_out = sum(
        entry["output_tokens"] + entry["thought_tokens"] for entry in usage.values()
    )
    return [
        _model_name(run),
        f"{sent}/{counts['reference']}",
        _pct(run["classification"]["rate"]),
        _pct(run["severity"]["rate"]),
        run["critical_as_noise"]["count"],
        run["high_as_noise"]["count"],
        run["false_critical"]["count"],
        run["invalid_outputs"]["count"],
        f"{duplicates['agreed']}/{duplicates['labelled']}",
        f"{tokens_in:,} / {tokens_out:,}",
        _cost_text(usage),
    ]


def _run_section(run: Mapping[str, Any]) -> list[str]:
    model, counts = run["model"], run["counts"]
    limits = model.get("limits") or {}
    lines = [f"## {_model_name(run)}", ""]
    lines.append(
        f"- Task `{run['task_id']}` ({run['task_status']}"
        + (", cancelled" if run["cancelled"] else "")
        + (f", {run['task_error_code']}" if run["task_error_code"] else "")
        + f"), started {run['started_at'] or 'unknown'}, finished "
        f"{run['finished_at'] or 'unknown'}."
    )
    if model.get("profile_id"):
        lines.append(
            f"- Profile `{model['profile_id']}` version {model.get('profile_version')}"
            f": input {_tokens(limits.get('max_input_tokens'))}, output "
            f"{_tokens(limits.get('max_output_tokens'))}."
        )
    reported = sorted(run["usage"])
    if reported:
        lines.append(f"- Models that answered: {', '.join(reported)}.")
    lines += ["", "### Coverage", ""]
    lines += _table(
        [
            "Reference issues",
            "Valid answers",
            "Invalid outputs",
            "Failed calls",
            "Skipped",
            "Not run",
        ],
        [
            [
                counts["reference"],
                counts["ok"],
                counts["invalid_output"],
                counts["failed"],
                counts["skipped"],
                counts["not_run"],
            ]
        ],
    )
    if run["skipped"]:
        by_reason: dict[str, list[str]] = defaultdict(list)
        for item in run["skipped"]:
            by_reason[item["reason"]].append(item["short_id"])
        lines.append("")
        for reason, ids in sorted(by_reason.items()):
            lines.append(
                f"- {SKIP_TEXT.get(reason, reason).capitalize()}: {_ids(ids)}."
            )
    lines.append("")
    lines += _confusion("Classification", run["classification"], CLASSIFICATIONS)
    lines += _confusion("Severity", run["severity"], SEVERITIES)
    critical, high, false = (
        run["critical_as_noise"],
        run["high_as_noise"],
        run["false_critical"],
    )
    lines += [
        "### Worst errors",
        "",
        f"- Critical issues taken for noise: {critical['count']} of "
        f"{critical['attempted']} sent ({_ids(critical['short_ids'])})."
        + (
            " The reference set has no critical label, so this check is empty; the "
            "next line is the closest one."
            if not critical["reference_total"]
            else ""
        ),
        f"- High-severity issues taken for noise: {high['count']} of "
        f"{high['attempted']} sent ({_ids(high['short_ids'])}).",
        f"- Confident critical answers (confidence at least "
        f"{false['confidence_threshold']:g}) on issues the reference does not call "
        f"critical: {false['count']} ({_ids(false['short_ids'])}). Each would put the "
        "issue in the critical lane and fire `errors-critical` once it is enabled.",
        "",
    ]
    duplicates = run["duplicates"]
    lines += [
        "### Duplicates",
        "",
        f"Of {duplicates['labelled']} answered issues the reference marks as "
        f"duplicates, {duplicates['agreed']} named an issue of the same group "
        f"({_pct(duplicates['rate'])}), {duplicates['exact']} the exact root; "
        f"{duplicates['missed']} named none and {duplicates['other_group']} named "
        f"another group. For {duplicates['unreachable']} of them no candidate of the "
        "right group was offered, so only a missed answer was possible. Issues the "
        "reference calls unique but the model tied to another group: "
        f"{duplicates['false_duplicates']} of {duplicates['unique_answered']}.",
        "",
    ]
    failures = run["failures"]
    lines += [
        "### Invalid outputs and failures",
        "",
        f"- Invalid outputs: {run['invalid_outputs']['count']} "
        f"({_ids(run['invalid_outputs']['short_ids'])}).",
        f"- Failed calls: {failures['count']}"
        + (
            " ("
            + ", ".join(
                f"{code} {count}" for code, count in failures["by_code"].items()
            )
            + ")"
            if failures["by_code"]
            else ""
        )
        + ".",
        "",
        "### Tokens and cost",
        "",
    ]
    usage = run["usage"]
    if usage:
        lines += _table(
            [
                "Model",
                "Calls",
                "Usage known",
                "Input",
                "Cached input",
                "Output",
                "Thought",
                "Mean input",
                "Cost",
            ],
            (
                [
                    name,
                    entry["calls"],
                    entry["usage_known"],
                    f"{entry['input_tokens']:,}",
                    f"{entry['cached_input_tokens']:,}",
                    f"{entry['output_tokens']:,}",
                    f"{entry['thought_tokens']:,}",
                    f"{entry['mean_input_tokens']:,}"
                    if entry["mean_input_tokens"] is not None
                    else "n/a",
                    f"${entry['cost_usd']:.4f}"
                    if entry["cost_usd"] is not None
                    else "unknown",
                ]
                for name, entry in sorted(usage.items())
            ),
        )
        priced = [entry["price"] for entry in usage.values() if entry["price"]]
        lines += [
            "",
            "Cost uses "
            + (
                ", ".join(
                    f"${p['input_per_million']:g} / ${p['output_per_million']:g} per "
                    f"million input / output tokens for {p['model']}"
                    for p in priced
                )
                if priced
                else "no price (pass --price MODEL=IN/OUT)"
            )
            + "; thought tokens count as output and cached input at the full input "
            "price, so it is an upper bound of the invoice.",
        ]
    else:
        lines.append("No call reached the provider.")
    disagreements = [
        row
        for row in run["items"]
        if row["prediction"]
        and (
            row["prediction"]["classification"] != row["reference"]["classification"]
            or row["prediction"]["severity"] != row["reference"]["severity"]
        )
    ]
    lines += ["", "### Disagreements", ""]
    if disagreements:
        lines += _table(
            ["Short id", "Group", "Reference", "Model", "Confidence"],
            (
                [
                    row["short_id"],
                    row["group"] or "",
                    f"{row['reference']['classification']} / {row['reference']['severity']}",
                    f"{row['prediction']['classification']} / {row['prediction']['severity']}",
                    f"{row['prediction']['confidence']:.2f}",
                ]
                for row in disagreements
            ),
            align="lllll",
        )
    else:
        lines.append("None.")
    return [*lines, ""]


def render_report(document: Mapping[str, Any]) -> str:
    """The Markdown report: one summary table, then one section per model."""
    reference = document["reference"]
    runs = document["runs"]
    lines = [
        f"# AI error triage evaluation: {document['date']}",
        "",
        "Error Inbox gate EG2. Each reference issue's stored digest was triaged with "
        "`ops.error.triage` by the model below, through `evaluate_error_triage` on the "
        "`ai_bulk` lane; nothing was saved to the inbox. Reference: "
        f"{reference['labels']} labelled issues from phase E0 "
        f"(`{reference['path']}`, version {reference['version']}). This report holds "
        "labels, short ids, counts and token figures only: no event text, file names "
        "or titles. Produced by `tools/error-inbox-eval/run_eval.py`; the JSON next to "
        "it has every answer.",
        "",
        "## Summary",
        "",
    ]
    lines += _table(
        [
            "Model",
            "Sent",
            "Classification",
            "Severity",
            "Critical as noise",
            "High as noise",
            "False critical",
            "Invalid outputs",
            "Duplicates",
            "Tokens in / out",
            "Cost",
        ],
        (_summary_row(run) for run in runs),
    )
    lines += [
        "",
        f"EG2 asks for at least {EG2_CLASSIFICATION:.0%} agreement on classification "
        "and no critical issue taken for noise. Agreement counts every issue sent: an "
        "invalid output or a failed call is a disagreement. "
        + " ".join(
            f"{_model_name(run)}: classification "
            f"{'meets' if run['eg2']['classification_met'] else 'misses'} it; "
            f"{'no' if run['eg2']['critical_as_noise_met'] else 'at least one'} "
            "critical issue "
            "taken for noise"
            + (
                ""
                if run["eg2"]["reference_has_critical"]
                else " (none labelled critical)"
            )
            + "."
            for run in runs
        )
        + " Choosing the model and turning on automatic triage is the maintainer's "
        "decision.",
        "",
    ]
    for run in runs:
        lines += _run_section(run)
    return "\n".join(lines).rstrip() + "\n"


def write_outputs(
    path: Path,
    runs: list[dict[str, Any]],
    reference: Mapping[str, Any],
    *,
    date: str,
    replace: bool = False,
) -> tuple[Path, Path]:
    """Write the Markdown report and its JSON; earlier runs in that JSON are kept."""
    json_path = path.with_suffix(".json")
    kept: list[dict[str, Any]] = []
    if json_path.exists() and not replace:
        previous = json.loads(json_path.read_text(encoding="utf-8"))
        if previous.get("schema_version") != SCHEMA_VERSION:
            raise EvalError(f"{json_path} is not an evaluation report; use --replace")
        new_ids = {run["task_id"] for run in runs}
        kept = [
            run for run in previous.get("runs", []) if run["task_id"] not in new_ids
        ]
    document = {
        "schema_version": SCHEMA_VERSION,
        "date": date,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reference": dict(reference),
        "runs": [*kept, *runs],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    path.write_text(render_report(document))
    return path, json_path


# -- commands -----------------------------------------------------------------


def _reference_meta(args: argparse.Namespace, reference: Mapping[str, Any]) -> dict:
    try:
        shown = args.labels.resolve().relative_to(ROOT)
    except ValueError:
        shown = args.labels.name
    return {
        "path": str(shown),
        "version": reference["version"],
        "labels": len(reference["labels"]),
    }


def wait_for(
    crate: Crate,
    task_id: str,
    *,
    poll_seconds: float,
    wait_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    echo: Callable[[str], None] = print,
) -> dict[str, Any]:
    deadline = clock() + wait_seconds
    shown = None
    while True:
        record = crate("result", {"task_id": task_id})
        if record.get("finished"):
            return record
        progress = _progress_text(record)
        if progress != shown:
            echo(progress)
            shown = progress
        if clock() >= deadline:
            raise EvalError(
                f"Task {task_id} is still {record.get('status')}; collect it later "
                f"with: run_eval.py report --task {task_id}"
            )
        sleep(poll_seconds)


def _progress_text(record: Mapping[str, Any]) -> str:
    raw = record.get("progress") or ""
    try:
        progress = json.loads(raw) if raw else {}
    except ValueError:
        # A plain note, such as the AI lane's "Waiting for AI provider capacity".
        return f"{record.get('status')}: {str(raw)[:120]}"
    if isinstance(progress, dict) and progress.get("total"):
        return f"{record.get('status')}: {progress.get('done')}/{progress.get('total')}"
    return f"{record.get('status')}"


def _output_path(args: argparse.Namespace, date: str) -> Path:
    return args.output or OUTPUT_DIR / f"error-triage-eval-{date}.md"


def command_plan(args, crate: Crate, reference, echo=print) -> dict[str, Any]:
    plan = crate("plan", {"short_ids": list(reference["labels"])})
    echo(describe_plan(plan, dict(args.price)))
    return plan


def command_run(
    args, crate: Crate, reference, echo=print, ask=input, interactive=None
) -> int:
    plan = command_plan(args, crate, reference, echo)
    if not plan.get("available"):
        raise EvalError(
            f"ops.error.triage has no usable model ({plan.get('error_code')})"
        )
    ready = [item["short_id"] for item in plan["items"] if item["status"] == "ready"]
    if not ready:
        raise EvalError("No reference issue has a stored digest; nothing to evaluate")
    if not args.execute:
        raise EvalError(
            f"Dry run only. Add --execute to send these {len(ready)} calls."
        )
    confirm(
        len(ready),
        plan,
        args.confirm_calls,
        ask=ask,
        interactive=interactive or sys.stdin.isatty,
    )
    skipped = [
        {"short_id": item["short_id"], "reason": item["reason"]}
        for item in plan["items"]
        if item["status"] == "skipped"
    ]
    queued = crate(
        "queue",
        {
            "short_ids": ready,
            "skipped": skipped,
            "expected_fingerprint": plan.get("fingerprint"),
        },
    )
    task_id = queued.get("task_id")
    if queued.get("deduplicated"):
        raise EvalError(f"Another evaluation is pending or running: task {task_id}")
    echo(f"Queued evaluation task {task_id} ({len(ready)} calls).")
    record = wait_for(
        crate,
        task_id,
        poll_seconds=args.poll_seconds,
        wait_seconds=args.wait_seconds,
        echo=echo,
    )
    return _write(args, reference, [record], echo)


def command_report(args, crate: Crate, reference, echo=print) -> int:
    records = []
    for task_id in args.task:
        record = crate("result", {"task_id": task_id})
        if not record.get("finished"):
            raise EvalError(f"Task {task_id} is still {record.get('status')}")
        records.append(record)
    return _write(args, reference, records, echo)


def _write(args, reference, records, echo) -> int:
    date = args.date or datetime.now(timezone.utc).date().isoformat()
    runs = [
        score_run(reference["labels"], record, dict(args.price)) for record in records
    ]
    md, js = write_outputs(
        _output_path(args, date),
        runs,
        _reference_meta(args, reference),
        date=date,
        replace=args.replace,
    )
    for run in runs:
        echo(
            f"{_model_name(run)}: classification {_pct(run['classification']['rate'])}, "
            f"severity {_pct(run['severity']['rate'])}, critical as noise "
            f"{run['critical_as_noise']['count']}, invalid outputs "
            f"{run['invalid_outputs']['count']}"
        )
    echo(f"Wrote {md} and {js}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="run_eval.py",
        description="Evaluate Crate's AI error triage against the E0 reference set.",
    )
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--crate",
        default=DEFAULT_CRATE,
        help="command that runs Python with the crate package "
        f"(default: {DEFAULT_CRATE!r}); prefix it with ssh for a remote host",
    )
    common.add_argument("--labels", type=Path, default=LABELS)
    common.add_argument(
        "--price",
        type=parse_price,
        action="append",
        default=[],
        metavar="MODEL=IN/OUT",
        help="dollars per million input / output tokens for a model id",
    )
    written = argparse.ArgumentParser(add_help=False)
    written.add_argument(
        "--output", type=Path, help="Markdown path; JSON goes next to it"
    )
    written.add_argument("--date", help="report date (default: today, UTC)")
    written.add_argument(
        "--replace", action="store_true", help="drop earlier runs kept in the JSON"
    )
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "plan", parents=[common], help="dry run: show what would be sent"
    )
    run = commands.add_parser(
        "run", parents=[common, written], help="send the calls (needs --execute)"
    )
    run.add_argument("--execute", action="store_true", help="really send the calls")
    run.add_argument(
        "--confirm-calls",
        type=int,
        help="confirm the number of calls without a prompt (must match the plan)",
    )
    run.add_argument("--poll-seconds", type=float, default=15)
    run.add_argument("--wait-seconds", type=float, default=7800)
    report = commands.add_parser(
        "report", parents=[common, written], help="collect finished tasks"
    )
    report.add_argument("--task", action="append", required=True)
    return root


def main(
    argv: list[str] | None = None,
    *,
    runner: Runner | None = None,
    echo: Callable[[str], None] = print,
    ask: Callable[[str], str] = input,
    interactive: Callable[[], bool] | None = None,
) -> int:
    args = parser().parse_args(argv)
    try:
        reference = load_labels(args.labels)
        crate = Crate(args.crate, runner)
        if args.command == "plan":
            command_plan(args, crate, reference, echo)
            return 0
        if args.command == "run":
            return command_run(args, crate, reference, echo, ask, interactive)
        return command_report(args, crate, reference, echo)
    except EvalError as error:
        echo(f"run_eval.py: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
