"""Admin adapters for the same frozen repair plans used by MCP workers."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from crate.agent_repairs import apply_operation, compile_operation
from crate.db.repositories.admin_repair_plans import (
    finish_admin_repair_execution,
    load_admin_repair_execution,
    with_admin_repair_authority,
    store_admin_repair_preparation,
)
from crate.db.queries.repair_plans import get_open_repair_issues
from crate.db.repositories.agent_repairs import repair_source_version
from crate.repair_contracts import repair_contracts


def prepare_admin_repairs(task_id: str, params: dict, config: dict) -> dict:
    from crate.worker_handlers import is_cancelled

    actor = params["actor_user_id"]
    if is_cancelled(task_id):
        return {"status": "cancelled"}
    with_admin_repair_authority(actor, lambda: None)
    issues = get_open_repair_issues(params["issue_ids"])
    if not issues:
        payload = {
            "preview": {
                "items": [],
                "total": 0,
                "executable": 0,
                "manual_only": 0,
                "plan_version": "repair-contract:empty",
            },
            "compiled": {
                "document": {},
                "execution": {"executable": False, "items": []},
            },
        }
        store_admin_repair_preparation(task_id, actor, payload)
        return {"status": "prepared", "preparation_task_id": task_id}
    compiled = compile_operation("repairs", {"issue_ids": params["issue_ids"]}, config)
    if len(json.dumps(compiled["document"], default=str).encode()) > 40000:
        raise ValueError("Repair plan exceeds its review budget; narrow the selection")
    by_id = {issue["id"]: issue for issue in issues}
    contracts = {contract["check_type"]: contract for contract in repair_contracts()}
    items = []
    for change in compiled["document"]["changes"]:
        issue = by_id[change["issue_id"]]
        contract = contracts[change["check_type"]]
        items.append(
            {
                "issue_id": issue["id"],
                "item_key": f"issue:{issue['id']}",
                "plan_item_id": f"repair-contract:{issue['id']}",
                "check_type": change["check_type"],
                "severity": issue["severity"],
                "description": issue["description"],
                "support": "automatic" if change["executable"] else "manual",
                "risk": contract["risk"],
                "scope": "hybrid" if contract["effects"]["filesystem"] else "db",
                "requires_confirmation": contract["approval_required"]
                or contract["risk"] == "caution",
                "supports_batch": not compiled["document"]["impact"][
                    "overlapping_scopes"
                ],
                "auto_fixable": change["executable"],
                "executable": change["executable"],
                "action": change.get("action"),
                "target": ", ".join(
                    str(target["entity_uid"]) for target in change.get("targets", [])
                ),
                "message": change.get("reason")
                or change.get("action", "Repair").replace("_", " "),
                "fs_write": contract["effects"]["filesystem"],
                "details": change,
                "issue": issue,
            }
        )
    preview = {
        "items": items,
        "total": len(items),
        "executable": sum(item["executable"] for item in items),
        "manual_only": sum(not item["executable"] for item in items),
        "plan_version": "repair-contract:"
        + repair_source_version(compiled["document"]),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "document": compiled["document"],
    }
    store_admin_repair_preparation(
        task_id, actor, {"preview": preview, "compiled": compiled}
    )
    return {"status": "prepared", "preparation_task_id": task_id}


def _public_result(result: dict) -> dict:
    return {
        "status": result["status"],
        "summary": result.get("summary", {}),
        "resolved_ids": result.get("resolved_ids", []),
        "error": result.get("error"),
        "verification": {"status": result.get("verification", {}).get("status")},
        "item_results": [
            {
                key: item.get(key)
                for key in (
                    "issue_id",
                    "item_key",
                    "plan_item_id",
                    "check_type",
                    "outcome",
                )
            }
            for item in result.get("item_results", [])
        ],
    }


def apply_admin_repairs(task_id: str, params: dict, config: dict) -> dict:
    from crate.worker_handlers import is_cancelled

    actor, preparation = params["actor_user_id"], params["preparation_task_id"]
    if is_cancelled(task_id):
        return {"status": "cancelled", "verification": {"status": "not_required"}}
    loaded = load_admin_repair_execution(task_id, preparation, actor)
    if "result" in loaded:
        return _public_result(loaded["result"])
    depth = 0

    def authorize(effect=None):
        nonlocal depth
        if is_cancelled(task_id):
            raise ValueError("Repair was cancelled")
        if depth:
            return effect() if effect else None

        def held():
            nonlocal depth
            depth += 1
            try:
                return effect() if effect else None
            finally:
                depth -= 1

        return with_admin_repair_authority(actor, held)

    try:
        outcome = apply_operation(
            "repairs", loaded["execution"], config, task_id=task_id, authorize=authorize
        )
        raw = outcome["execution"]
        selected = {item["issue_id"]: item for item in loaded["selected"]}
        items = [
            {
                **selected[item["issue_id"]],
                "outcome": "applied" if item["status"] == "applied" else "failed",
                "details": item,
            }
            for item in raw["items"]
        ]
        result = {
            "status": raw["status"],
            "actions": [
                {
                    "action": item.get("action"),
                    "applied": item["status"] == "applied",
                    "details": item,
                }
                for item in raw["items"]
            ],
            "item_results": items,
            "resolved_ids": [
                item["issue_id"] for item in raw["items"] if item["status"] == "applied"
            ],
            "summary": {
                "applied": sum(item["status"] == "applied" for item in raw["items"]),
                "failed": sum(item["status"] != "applied" for item in raw["items"]),
            },
            "verification": outcome["verification"],
        }
    except Exception:
        result = {
            "status": "partial",
            "error": "Repair stopped; inspect its prepared sources and quarantine before preparing another plan",
            "verification": {"status": "manual_reconciliation_required"},
        }
    return _public_result(finish_admin_repair_execution(task_id, preparation, result))


__all__ = ["prepare_admin_repairs", "apply_admin_repairs"]
