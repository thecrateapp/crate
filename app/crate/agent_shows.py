"""Closed show import adapter; Admin jobs or the MCP client perform extraction."""

import hashlib

from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.show_imports import (
    compile_show_import,
    apply_exact_show_import,
)
from crate.db.repositories.show_identities import identity_base


def compile_operation(
    operation: str, parameters: dict, config: dict, *, principal
) -> dict:
    if operation != "shows_import" or set(parameters) != {"candidates"}:
        raise DiagnosticError("INVALID_ARGUMENT", "A closed show selection is required")
    source = {
        "provider": "manual" if principal.human_actor_id is not None else "mcp",
        "actor": "user:" + str(principal.actor_user_id)
        if principal.actor_user_id
        else "integration:" + principal.id,
    }
    execution = compile_show_import(parameters["candidates"], source)
    return {
        "document": {
            "operation": operation,
            "executable": execution["executable"],
            "issues": execution["issues"],
            "targets": [
                {
                    "entity_type": "show",
                    "name": hashlib.sha256(
                        identity_base(item["candidate"]).encode()
                    ).hexdigest(),
                }
                for item in execution["items"]
            ],
            "changes": [
                {
                    "item_id": item["candidate"]["item_id"],
                    "field": "show",
                    "before": item["before"],
                    "after": item["candidate"],
                }
                for item in execution["items"]
            ],
            "source_versions": {
                "shows": hashlib.sha256(
                    str(
                        [
                            (item["expected_show_id"], item["expected_revision"])
                            for item in execution["items"]
                        ]
                    ).encode()
                ).hexdigest()
            },
            "impact": {
                "scope": "selected",
                "filesystem": False,
                "public": True,
                "shows": len(execution["items"]),
            },
            "risk": "safe",
            "reversibility": "new_plan_required",
            "notices": [
                "Only the exact reviewed selection is written; no extraction, notifications or ticket purchases."
            ],
        },
        "execution": execution,
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize
) -> dict:
    if operation != "shows_import":
        raise DiagnosticError("INVALID_ARGUMENT", "Unknown show operation")
    authorize()
    return apply_exact_show_import(execution, task_id)


__all__ = ["compile_operation", "apply_operation"]
