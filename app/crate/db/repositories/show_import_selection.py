"""Atomic show selections consumed by the shared immutable operation engine."""

from pydantic import ValidationError
from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.api.schemas.show_imports import ShowCandidate
from crate.db.repositories import show_identities as identities
from crate.db.tx import optional_scope, read_scope


def compile_show_import(candidates: list[dict], source: dict, *, session=None) -> dict:
    if not 1 <= len(candidates) <= 50:
        raise DiagnosticError(
            "LIMIT_EXCEEDED", "Choose 1 to 50 shows per exact selection"
        )
    try:
        selected = [
            ShowCandidate.model_validate(candidate).model_dump(
                mode="json", exclude_unset=True
            )
            for candidate in candidates
        ]
    except ValidationError:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Candidate fields do not match the closed show contract"
        ) from None
    if len({candidate["item_id"] for candidate in selected}) != len(selected):
        raise DiagnosticError("INVALID_ARGUMENT", "Candidate item IDs must be unique")

    def read(current):
        uids = [
            candidate["artist_uid"]
            for candidate in selected
            if candidate.get("artist_uid")
        ]
        names = [
            identities.normalize(candidate.get("artist_name")) for candidate in selected
        ]
        artists = (
            current.execute(
                text("""SELECT entity_uid::text,name FROM library_artists
            WHERE entity_uid=ANY(CAST(:uids AS uuid[])) OR lower(btrim(name))=ANY(:names)"""),
                {"uids": uids, "names": names},
            )
            .mappings()
            .all()
        )
        items, issues = [], []
        for candidate in selected:
            artist_matches = (
                [
                    artist
                    for artist in artists
                    if artist["entity_uid"] == candidate.get("artist_uid")
                ]
                if candidate.get("artist_uid")
                else [
                    artist
                    for artist in artists
                    if identities.normalize(artist["name"])
                    == identities.normalize(candidate.get("artist_name"))
                ]
            )
            if len(artist_matches) > 1 or (
                candidate.get("artist_uid") and not artist_matches
            ):
                issues.append(
                    {
                        "item_id": candidate["item_id"],
                        "status": "invalid",
                        "reason": "Artist identity is ambiguous or unavailable",
                    }
                )
            elif artist_matches:
                candidate["artist_name"] = artist_matches[0]["name"]
            missing = [
                field
                for field in ("artist_name", "date", "venue", "city")
                if not candidate.get(field)
            ]
            if missing:
                issues.append(
                    {
                        "item_id": candidate["item_id"],
                        "status": "invalid",
                        "missing": missing,
                    }
                )
            match = identities.preview_show(candidate, source, session=current)
            if match["status"] == "conflict":
                issues.append({"item_id": candidate["item_id"], **match})
            before = match.get("show")
            items.append(
                {
                    "candidate": candidate,
                    "expected_show_id": (before or {}).get("id"),
                    "expected_revision": (before or {}).get("revision"),
                    "before": {
                        key: value
                        for key, value in (before or {}).items()
                        if key in identities._FIELDS
                    },
                }
            )
        return {
            "items": items,
            "source": source,
            "issues": issues,
            "executable": not issues,
        }

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


class _SelectionConflict(Exception):
    pass


def _same_selected_values(candidate, row):
    for key in identities._FIELDS:
        value = candidate.get(key)
        if value is None:
            continue
        if key == "lineup":
            if not set(value) <= set(row.get("lineup") or []):
                return False
        elif key == "date":
            if str(value) != str(row[key]):
                return False
        elif key == "local_time":
            if str(value)[:5] != str(row.get(key))[:5]:
                return False
        elif value != row.get(key):
            return False
    return True


def apply_exact_show_import(execution: dict, task_id: str, *, session=None) -> dict:
    from crate.db.repositories.agent_operation_jobs import (
        finish_operation,
        with_operation_authority,
    )
    from crate.db.repositories.agent_requests import _job
    from crate.db.repositories.agent_plans import _get

    if not execution.get("executable"):
        raise DiagnosticError(
            "NOT_EXECUTABLE",
            "Resolve invalid or conflicting show candidates before applying",
        )
    items, source = execution["items"], execution["source"]
    try:
        with optional_scope(session) as current:
            # Reuse this transaction for authority, effects and durable completion.
            # An outer authorize(effect) would hold agent_jobs in another connection.
            with_operation_authority(task_id, None, session=current)
            job = _job(current, task_id)
            if job is None:
                raise DiagnosticError("NOT_FOUND", "Show job is unavailable")
            plan = _get(current, job["payload"]["plan_id"])
            if execution != plan["execution_data"]:
                raise DiagnosticError(
                    "PLAN_STALE", "Show execution differs from its exact stored plan"
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
                    "CANCELLED", "Show operation was cancelled before effects"
                )
            current.execute(
                text("UPDATE tasks SET status='completing' WHERE id=:id"),
                {"id": task_id},
            )
            for key in sorted(
                {
                    "show:base:" + identities.identity_base(item["candidate"])
                    for item in items
                }
            ):
                current.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                    {"key": key},
                )
            outcomes = []
            for item in items:
                candidate = item["candidate"]
                matched = identities.preview_show(candidate, source, session=current)
                row = matched.get("show")
                if matched["status"] == "conflict":
                    raise _SelectionConflict("Event identity became ambiguous")
                expected = item["expected_show_id"]
                if expected is not None and (
                    not row
                    or row["id"] != expected
                    or row["revision"] != item["expected_revision"]
                ):
                    raise _SelectionConflict("Show revision changed after preview")
                if expected is None and row:
                    if not _same_selected_values(candidate, row):
                        raise _SelectionConflict(
                            "A concurrently created show has different fields; review it"
                        )
                    outcome = {
                        "status": "already_exists",
                        "show_id": row["id"],
                        "revision": row["revision"],
                    }
                else:
                    if row:
                        candidate = {
                            **candidate,
                            "existing_show_id": row["id"],
                            "expected_revision": row["revision"],
                        }
                    outcome = identities.upsert_canonical_show(
                        candidate, source, session=current
                    )
                    if outcome["status"] in {"conflict", "invalid"}:
                        raise _SelectionConflict(
                            "Show selection is no longer applicable"
                        )
                outcomes.append({"item_id": candidate["item_id"], **outcome})
            result = {
                "execution": {"status": "completed", "items": outcomes},
                "verification": {"status": "passed"},
                "projection": {"status": "pending"},
            }
            # Shows and durable result commit together. Outer engine completion is a replay.
            return finish_operation(task_id, result, session=current)
    except _SelectionConflict as error:
        return {
            "execution": {
                "status": "conflict",
                "error_code": "PLAN_STALE",
                "error": str(error),
                "items": [
                    {
                        "item_id": item["candidate"]["item_id"],
                        "status": "conflict",
                        "code": "BATCH_NOT_APPLIED",
                    }
                    for item in items
                ],
            },
            "verification": {"status": "not_required"},
        }


__all__ = ["compile_show_import", "apply_exact_show_import"]
