"""Closed show import adapter; Admin jobs or the MCP client perform extraction."""

import hashlib
from pydantic import ValidationError
from crate.agent_library_operations import (
    prepare_operation as queue_prepare,
    apply_operation as queue_apply,
)
from crate.mcp.show_schemas import ShowsPrepare, ShowsSearch
from crate.db.queries.show_search import search_canonical_shows

from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.show_imports import (
    compile_show_import,
    apply_exact_show_import,
)
from crate.db.repositories.show_identities import identity_base


def compile_operation(
    operation: str, parameters: dict, config: dict, *, principal
) -> dict:
    if operation != "shows_import" or set(parameters) not in (
        {"candidates"},
        {"consolidation"},
    ):
        raise DiagnosticError("INVALID_ARGUMENT", "A closed show selection is required")
    if "consolidation" in parameters:
        from crate.db.repositories.show_consolidation_plans import (
            compile_show_consolidation,
        )

        return compile_show_consolidation(parameters["consolidation"])
    source: dict = {
        "provider": "manual" if principal.human_actor_id is not None else "mcp",
        "actor": "user:" + str(principal.actor_user_id)
        if principal.actor_user_id
        else "integration:" + principal.id,
    }
    if principal.human_actor_id is not None:
        source["actor_user_id"] = principal.human_actor_id
    execution = compile_show_import(parameters["candidates"], source)
    from crate.show_telemetry import record_show_metrics

    record_show_metrics(
        candidates=len(execution["items"]),
        result={"execution": {"items": execution["issues"]}},
    )
    return {
        "document": {
            "operation": operation,
            "executable": execution["executable"],
            "issues": execution["issues"],
            "targets": list(
                {
                    _show_target(item["candidate"])["name"]: _show_target(
                        item["candidate"]
                    )
                    for item in execution["items"]
                }.values()
            ),
            "changes": [
                {
                    "item_id": item["candidate"]["item_id"],
                    "field": "show",
                    "targets": [_show_target(item["candidate"])],
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
    if execution.get("kind") == "consolidation":
        from crate.db.repositories.show_consolidation_plans import (
            apply_show_consolidation,
        )

        return apply_show_consolidation(execution, task_id)
    result = apply_exact_show_import(execution, task_id)
    from crate.show_telemetry import record_show_metrics

    record_show_metrics(result=result)
    return result


def search_shows(principal, **parameters):
    if "curation.shows.read" not in principal.grants:
        raise DiagnosticError("FORBIDDEN", "Show read grant is required")
    try:
        ShowsSearch.model_validate(parameters)
        data = search_canonical_shows(**parameters)
    except (ValidationError, ValueError):
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Invalid bounded show search"
        ) from None
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "shows",
        "data": data,
        "interpretation": "Canonical shows, including external artists. Unknown coordinates and times remain unknown. Search absence is not proof that a show does not exist.",
    }


def preview_shows_import(
    principal, *, candidates=None, consolidation=None, idempotency_key, trace_id=None
):
    selection = ShowsPrepare.model_validate(
        {
            "candidates": candidates or [],
            "consolidation": consolidation,
            "idempotency_key": idempotency_key,
        }
    )
    parameters = (
        {"consolidation": selection.consolidation.model_dump()}
        if selection.consolidation
        else {
            "candidates": [
                c.model_dump(mode="json", exclude_unset=True)
                for c in selection.candidates
            ]
        }
    )
    return queue_prepare(
        principal, "shows_import", parameters, idempotency_key, trace_id=trace_id
    )


def apply_shows_import(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return queue_apply(
        principal,
        "shows_import",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def _show_target(candidate):
    return {
        "entity_type": "show",
        "name": hashlib.sha256(identity_base(candidate).encode()).hexdigest(),
        "label": f"{candidate.get('artist_name') or 'Unresolved artist'} · {candidate.get('date') or 'Unresolved date'}",
    }


__all__ = [
    "compile_operation",
    "apply_operation",
    "search_shows",
    "preview_shows_import",
    "apply_shows_import",
]
