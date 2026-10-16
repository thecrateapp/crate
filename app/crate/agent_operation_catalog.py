"""Closed library operation identifiers, grants and human capabilities."""

import hashlib
import json
from collections import Counter
from uuid import UUID

OPERATIONS = {
    "job_retry": ("ops.jobs.retry", "ops.tasks.manage"),
    "job_cancel": ("ops.jobs.cancel", "ops.tasks.manage"),
    "schedule_run": ("ops.schedules.run", "ops.tasks.manage"),
    "schedule_update": ("ops.schedules.write", "ops.tasks.manage"),
    "runtime_update": ("ops.runtime.write", "ops.runtime.manage"),
    "health_check": ("library.health.run", "library.repair.run"),
    "quality_check": ("library.quality.run", "library.repair.run"),
    "repairs": ("library.repair.run", "library.repair.run"),
    "metadata_update": ("library.metadata.write", "library.metadata.write"),
    "enrichment": ("library.enrichment.run", "library.metadata.write"),
    "analysis": ("library.analysis.run", "library.metadata.write"),
    "library_sync": ("library.sync.run", "library.metadata.write"),
    "metadata_export": ("library.metadata.export", "library.metadata.write"),
    "metadata_rehydrate": ("library.metadata.rehydrate", "library.metadata.write"),
}


def operation_grant(operation: str) -> str:
    from crate.agent_diagnostics import DiagnosticError

    if operation not in OPERATIONS:
        raise DiagnosticError("INVALID_ARGUMENT", "Unknown library operation")
    return OPERATIONS[operation][0]


def public_operation_result(result: dict) -> dict:
    """Task surfaces are shared; exact plans/results remain in owned agent stores."""
    from crate.agent_diagnostics import _text

    execution = result.get("execution") or {}
    public = {
        key: execution[key]
        for key in ("status", "plan_id", "plan_version", "error_code")
        if key in execution
    }
    if execution.get("error"):
        public["error"] = _text(execution["error"], 512)
    return {
        "status": result.get("status"),
        "execution": public,
        "verification": {"status": (result.get("verification") or {}).get("status")},
        "projection": {"status": (result.get("projection") or {}).get("status")},
    }


_OUTCOME_IDENTITIES = (
    "entity_type",
    "entity_uid",
    "artist_uid",
    "track_uid",
    "album_uid",
    "issue_id",
    "check_type",
    "provider",
    "facet",
    "pipeline",
)
_OUTCOME_FIELDS = _OUTCOME_IDENTITIES + (
    "status",
    "code",
    "error_code",
    "verification",
    "recoverable",
    "field",
    "generation",
    "source_version",
    "tracks",
    "removed_tracks",
    "size",
    "artifact_id",
    "sha256",
    "byte_size",
    "expires_in_seconds",
    "published",
    "scanned_tracks",
    "task_id",
    "retry_of",
    "request_state",
    "configured_revision",
    "effective_revision",
    "reason",
    "cancellation_requested",
)


def operation_result_items(result: dict) -> list[dict]:
    """Project outcomes, never metadata values, from the closed adapter shapes."""
    items = []

    def visit(node, path, inherited):
        row = {
            **inherited,
            "result_path": path,
            **{
                field: node[field]
                for field in _OUTCOME_FIELDS
                if field in node
                and (
                    node[field] is None
                    or type(node[field]) in {bool, int}
                    or (isinstance(node[field], str) and len(node[field]) <= 256)
                )
            },
        }
        if isinstance(node.get("after"), dict):
            row["modified_fields"] = sorted(node["after"])
        for key in ("locked_fields", "present_fields"):
            if key in node:
                row[key] = node[key]
        items.append(row)
        context = {key: row[key] for key in _OUTCOME_IDENTITIES if key in row}
        if "verification" in row:
            context["verification"] = row["verification"]
        for key in ("items", "providers", "facets", "references", "artifacts"):
            for index, child in enumerate(node.get(key) or []):
                if isinstance(child, dict):
                    visit(child, f"{path}.{key}[{index}]", context)

    for section in ("execution", "verification", "projection"):
        content = result.get(section) or {}
        inherited = {"status": content["status"]} if "status" in content else {}
        for key in ("items", "references", "artifacts"):
            for index, child in enumerate(content.get(key) or []):
                if isinstance(child, dict):
                    visit(child, f"{section}.{key}[{index}]", inherited)
        if isinstance(content.get("report"), dict):
            visit(content["report"], f"{section}.report", inherited)
    return items


def operation_result_summary(result: dict | None, *, plan_id=None, job_id=None):
    """Owned transport summary; the persisted result and Admin review stay exact."""
    if result is None:
        return None
    summary = public_operation_result(result)
    execution = result.get("execution") or {}
    plan_id = (
        plan_id or execution.get("plan_id") or (result.get("plan") or {}).get("plan_id")
    )
    items = operation_result_items(result)
    summary.update(
        {
            "details": {
                "tool": "get_plan",
                "plan_id": plan_id,
                "job_id": job_id,
                "result_hash": hashlib.sha256(
                    json.dumps(
                        result, sort_keys=True, separators=(",", ":"), default=str
                    ).encode()
                ).hexdigest(),
                "projection": "outcomes",
                "full_values": "private_admin_plan_result",
            },
            "outcome_count": len(items),
            "outcome_status_counts": dict(
                Counter(item.get("status", "unspecified") for item in items)
            ),
        }
    )
    for key in (
        "code",
        "issue_count",
        "albums",
        "include_audio",
        "checks",
        "failed_checks",
        "configured_revision",
        "effective_revision",
    ):
        if key in execution:
            summary["execution"][key] = execution[key]
    if any(item.get("pipeline") in {"analysis", "bliss"} for item in items):
        summary["details"]["analysis_status"] = {
            "tool": "get_analysis_status",
            "plan_id": plan_id,
        }
    artifacts = execution.get("artifacts") or []
    if len(artifacts) == 1:
        artifact = artifacts[0]
        artifact_id = str(UUID(artifact["artifact_id"]))
        summary["artifacts"] = [
            {
                "artifact_id": artifact_id,
                "download_path": f"/mcp/artifacts/{artifact_id}",
                **{
                    key: artifact[key]
                    for key in ("sha256", "byte_size", "expires_in_seconds")
                    if key in artifact
                },
            }
        ]
    if artifacts:
        summary["details"]["artifact_download_path_template"] = (
            "/mcp/artifacts/{artifact_id}"
        )
    return summary


def interrupted_operation_result(operation, status, effect_started_at, result):
    """Derive uncertainty from durable facts even when the worker never returns."""
    if result is not None or operation != "apply_operation":
        return result
    if status not in {"failed", "cancelled", "completed"}:
        return None
    if effect_started_at is not None:
        return {
            "status": status,
            "execution": {
                "status": "partial",
                "error_code": "RECONCILIATION_REQUIRED",
                "error": "Execution ended after effects may have started. Inspect current state and prepare a new plan; effects must not be repeated automatically.",
            },
            "verification": {"status": "manual_reconciliation_required"},
        }
    return {
        "status": status,
        "execution": {
            "status": "cancelled" if status == "cancelled" else "failed",
            "error_code": "EXECUTION_INTERRUPTED",
            "error": "Execution ended before effects started; prepare a new plan.",
        },
        "verification": {"status": "not_required"},
    }


__all__ = [
    "OPERATIONS",
    "operation_grant",
    "public_operation_result",
    "operation_result_items",
    "operation_result_summary",
    "interrupted_operation_result",
]
