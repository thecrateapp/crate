"""Explicit consolidation is an approved variant of the shared show operation."""

from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.api.schemas.show_imports import ShowConsolidationInput
from crate.db.repositories.tasks_shared import _register_task_transition_signal
from crate.db.tx import optional_scope, read_scope


def read_consolidation_shows(ids: list[int], *, session=None) -> list[dict]:
    if not 1 <= len(ids) <= 10 or any(
        type(value) is not int or value < 1 for value in ids
    ):
        raise DiagnosticError("INVALID_ARGUMENT", "Choose at most ten exact show IDs")

    def read(current):
        rows = (
            current.execute(
                text("""WITH attendance AS (SELECT show_id,count(*) AS attendance_count FROM user_show_attendance WHERE show_id=ANY(:ids) GROUP BY show_id),
          reminders AS (SELECT show_id,count(*) AS reminder_count FROM user_show_reminders WHERE show_id=ANY(:ids) GROUP BY show_id)
          SELECT s.*,coalesce(a.attendance_count,0) AS attendance_count,coalesce(r.reminder_count,0) AS reminder_count
          FROM shows s LEFT JOIN attendance a ON a.show_id=s.id LEFT JOIN reminders r ON r.show_id=s.id WHERE s.id=ANY(:ids) ORDER BY s.id"""),
                {"ids": ids},
            )
            .mappings()
            .all()
        )
        from crate.db.repositories.show_identities import _FIELDS

        return [
            {
                key: (str(value) if key == "date" else value)
                for key, value in row.items()
                if key
                in {
                    *_FIELDS,
                    "id",
                    "revision",
                    "merged_into_id",
                    "attendance_count",
                    "reminder_count",
                }
            }
            for row in rows
        ]

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def compile_show_consolidation(parameters: dict, *, session=None) -> dict:
    selection = ShowConsolidationInput.model_validate(parameters).model_dump()
    ids = [selection["canonical_show_id"], *selection["duplicate_show_ids"]]
    rows = read_consolidation_shows(ids, session=session)
    valid = len(rows) == len(ids) and all(
        not row["merged_into_id"]
        and row["revision"] == selection["revisions"][str(row["id"])]
        for row in rows
    )
    return {
        "document": {
            "operation": "shows_import",
            "kind": "consolidation",
            "executable": valid,
            "issues": []
            if valid
            else [{"reason": "Exact consolidation IDs or revisions changed"}],
            "targets": [{"entity_type": "show", "name": str(value)} for value in ids],
            "changes": [
                {
                    "item_id": "consolidation",
                    "targets": [
                        {"entity_type": "show", "name": str(value)} for value in ids
                    ],
                    "field": "canonical_identity",
                    "before": {"shows": rows},
                    "after": selection,
                }
            ],
            "source_versions": {"shows": selection["revisions"]},
            "risk": "high",
            "impact": {
                "scope": "selected",
                "public": True,
                "filesystem": False,
                "shows": len(ids),
            },
            "reversibility": "manual_reconciliation_required",
            "notices": [
                "Explicit human approval is mandatory. The canonical show keeps its fields; attendance, reminders and source aliases transfer; old IDs redirect."
            ],
        },
        "execution": {
            "kind": "consolidation",
            "selection": selection,
            "executable": valid,
        },
    }


def apply_show_consolidation(execution: dict, task_id: str, *, session=None) -> dict:
    from crate.db.repositories.agent_operation_jobs import (
        finish_operation,
        with_operation_authority,
    )
    from crate.db.repositories.agent_plans import _get
    from crate.db.repositories.agent_requests import _job
    from crate.db.repositories.show_consolidation import consolidate_shows

    with optional_scope(session) as current:
        with_operation_authority(task_id, None, session=current)
        job = _job(current, task_id)
        if (
            not job
            or execution != _get(current, job["payload"]["plan_id"])["execution_data"]
        ):
            raise DiagnosticError(
                "PLAN_STALE", "Consolidation differs from the approved selection"
            )
        task = (
            current.execute(
                text(
                    "SELECT cancellation_requested_at FROM tasks WHERE id=:id FOR UPDATE"
                ),
                {"id": task_id},
            )
            .mappings()
            .one()
        )
        if task["cancellation_requested_at"] is not None:
            raise DiagnosticError(
                "CANCELLED", "Consolidation was cancelled before effects"
            )
        transition = (
            current.execute(
                text("UPDATE tasks SET status='completing' WHERE id=:id RETURNING *"),
                {"id": task_id},
            )
            .mappings()
            .first()
        )
        if transition is not None:
            _register_task_transition_signal(current, dict(transition))
        selected = execution["selection"]
        result = consolidate_shows(
            selected["canonical_show_id"],
            selected["duplicate_show_ids"],
            selected["revisions"],
            session=current,
        )
        succeeded = result["status"] == "completed"
        outcome = {
            **result,
            "status": "linked_source" if succeeded else result["status"],
            "item_id": "consolidation",
            "code": "CONSOLIDATED" if succeeded else "PLAN_STALE",
        }
        return finish_operation(
            task_id,
            {
                "execution": {
                    "status": "completed" if succeeded else "conflict",
                    "items": [outcome],
                },
                "verification": {"status": "passed" if succeeded else "not_required"},
                "projection": {"status": "pending" if succeeded else "not_required"},
            },
            session=current,
        )


__all__ = [
    "apply_show_consolidation",
    "compile_show_consolidation",
    "read_consolidation_shows",
]
