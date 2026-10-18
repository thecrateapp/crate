"""Atomic show selections consumed by the shared immutable operation engine."""

import json
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
        _validate_draft_sources(current, selected, source)
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
            WHERE entity_uid=ANY(CAST(:uids AS uuid[])) OR lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))=ANY(:names)"""),
                {"uids": uids, "names": names},
            )
            .mappings()
            .all()
        )
        for candidate in selected:
            if candidate.get("artist_uid"):
                matches = [
                    artist
                    for artist in artists
                    if artist["entity_uid"] == candidate["artist_uid"]
                ]
            else:
                matches = [
                    artist
                    for artist in artists
                    if identities.normalize(artist["name"])
                    == identities.normalize(candidate.get("artist_name"))
                ]
            if len(matches) == 1:
                candidate["artist_name"] = matches[0]["name"]
        batch_matches = identities.match_show_candidates(selected, session=current)
        items, issues = [], []
        issues.extend(_repeated_target_issues(selected, batch_matches))
        repeated = {}
        for index, candidate in enumerate(selected):
            for prior in selected[:index]:
                if str(candidate.get("date")) != str(prior.get("date")):
                    continue
                comparison = identities._match_rows(
                    candidate, [{**prior, "id": prior["item_id"]}], False
                )
                if comparison["status"] in {"conflict", "already_exists"}:
                    repeated.setdefault(candidate["item_id"], prior["item_id"])
                    repeated.setdefault(prior["item_id"], candidate["item_id"])
        issues.extend(
            {
                "item_id": key,
                "status": "conflict",
                "related_item_id": other,
                "reason": "Selected rows may describe the same session; resolve or exclude one",
            }
            for key, other in repeated.items()
        )
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
                        "artist_matches": [
                            {"artist_uid": artist["entity_uid"], "name": artist["name"]}
                            for artist in artist_matches[:10]
                        ],
                        "more_artist_matches": len(artist_matches) > 10,
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
            match = batch_matches[candidate["item_id"]]
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


def _repeated_target_issues(candidates, matches):
    targets = {}
    repeated = {}
    for candidate in candidates:
        row = matches[candidate["item_id"]].get("show")
        alias = identities._source_alias(candidate, {})
        keys = []
        if row:
            keys.append(("show", row["id"]))
        if alias:
            keys.append(("alias", alias["provider"], alias["event_id"]))
        for key in keys:
            prior = targets.setdefault(key, candidate["item_id"])
            if prior != candidate["item_id"]:
                repeated[candidate["item_id"]] = prior
                repeated[prior] = candidate["item_id"]
    return [
        {
            "item_id": item,
            "related_item_id": other,
            "status": "conflict",
            "reason": "Selected rows target the same saved show or provider event; resolve or exclude one",
        }
        for item, other in repeated.items()
    ]


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
                    key
                    for item in items
                    for key in identities._lock_keys(item["candidate"], source)
                }
            ):
                current.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                    {"key": key},
                )
            _validate_draft_sources(
                current, [item["candidate"] for item in items], source
            )
            outcomes = []
            matches = identities.match_show_candidates(
                [item["candidate"] for item in items],
                expected_ids=[
                    item["expected_show_id"]
                    for item in items
                    if item["expected_show_id"]
                ],
                lock=True,
                session=current,
            )
            if _repeated_target_issues([item["candidate"] for item in items], matches):
                raise _SelectionConflict("Selected rows now target the same show")
            for item in items:
                candidate = item["candidate"]
                matched = matches[candidate["item_id"]]
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
                outcome = identities.upsert_canonical_show(
                    candidate, source, session=current, _matched=matched
                )
                if outcome["status"] in {"conflict", "invalid"}:
                    raise _SelectionConflict("Show selection is no longer applicable")
                outcomes.append({"item_id": candidate["item_id"], **outcome})
            result = {
                "execution": {"status": "completed", "items": outcomes},
                "verification": {"status": "passed"},
                "projection": {"status": "pending"},
            }
            from crate.db.repositories.show_invalidation import invalidate_show_views

            invalidate_show_views(
                [
                    name
                    for item in items
                    for name in [
                        item["candidate"].get("artist_name"),
                        *(item["candidate"].get("lineup") or []),
                        *(item["before"].get("lineup") or []),
                    ]
                    if name
                ],
                session=current,
            )
            _remember_draft_outcomes(current, items, outcomes)
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

    except DiagnosticError:
        raise
    except Exception as error:
        return {
            "execution": {
                "status": "failed",
                "error_code": "SHOW_WRITE_FAILED",
                "error": "The selected batch was not committed. Keep the draft and review or retry.",
                "failure_class": type(error).__name__,
                "items": [
                    {
                        "item_id": item["candidate"]["item_id"],
                        "status": "failed",
                        "code": "BATCH_NOT_APPLIED",
                    }
                    for item in items
                ],
            },
            "verification": {"status": "not_required"},
            "projection": {"status": "not_required"},
        }


__all__ = ["compile_show_import", "apply_exact_show_import"]


def _validate_draft_sources(current, candidates, source):
    ids = list(
        {row["source_draft_id"] for row in candidates if row.get("source_draft_id")}
    )
    if not ids:
        return
    if source["provider"] != "manual" or not source.get("actor_user_id"):
        raise DiagnosticError(
            "FORBIDDEN",
            "Only the owning Admin editor can select a private extraction draft",
        )
    drafts = (
        current.execute(
            text(
                "SELECT id::text,result FROM show_extraction_drafts WHERE id=ANY(CAST(:ids AS uuid[])) AND actor_user_id=:actor AND expires_at>NOW()"
            ),
            {"ids": ids, "actor": source["actor_user_id"]},
        )
        .mappings()
        .all()
    )
    evidence_by_id = {row["id"]: row["result"] or {} for row in drafts}
    allowed = {
        row["id"]: {
            candidate["item_id"]
            for candidate in (row["result"] or {}).get("candidates", [])
        }
        for row in drafts
    }
    if any(
        row.get("source_draft_id")
        and row["item_id"] not in allowed.get(row["source_draft_id"], set())
        for row in candidates
    ):
        raise DiagnosticError(
            "NOT_FOUND", "An owned draft candidate is missing or expired"
        )
    for candidate in candidates:
        if candidate.get("source_draft_id"):
            evidence = evidence_by_id[candidate["source_draft_id"]]
            original = next(
                row
                for row in evidence["candidates"]
                if row["item_id"] == candidate["item_id"]
            )
            candidate["source_ref"] = original.get("source_ref")
            candidate["evidence"] = original.get("evidence")
            candidate["extractor"] = evidence.get("extractor")
            candidate["extractor_model"] = evidence.get("model")
            candidate.pop("source_manifest", None)
            manifest = evidence.get("source_sets", {}).get(candidate["source_ref"])
            if manifest is None:
                manifest = [
                    {
                        key: row[key]
                        for key in (
                            "source_ref",
                            "sha256",
                            "text_sha256",
                            "modality",
                            "read",
                            "extractor",
                        )
                        if key in row
                    }
                    for row in evidence.get("sources", [])
                    if row.get("read")
                    and row.get("source_ref") == candidate["source_ref"]
                ]
            if manifest:
                candidate["source_manifest"] = manifest


def _remember_draft_outcomes(current, items, outcomes):
    groups = {}
    result_by_id = {row["item_id"]: row for row in outcomes}
    for item in items:
        candidate = item["candidate"]
        draft_id = candidate.get("source_draft_id")
        if not draft_id:
            continue
        group = groups.setdefault(
            draft_id, {"id": draft_id, "publication": {}, "candidates": {}}
        )
        group["publication"][candidate["item_id"]] = result_by_id[candidate["item_id"]]
        group["candidates"][candidate["item_id"]] = {
            key: value for key, value in candidate.items() if key != "source_manifest"
        }
    if not groups:
        return
    current.execute(
        text("""WITH incoming AS (SELECT * FROM jsonb_to_recordset(CAST(:data AS jsonb)) AS x(id text,publication jsonb,candidates jsonb))
      UPDATE show_extraction_drafts d SET result=jsonb_set(jsonb_set(d.result,'{publication}',coalesce(d.result->'publication','{}'::jsonb)||i.publication),'{candidates}',
        (SELECT jsonb_agg(coalesce(i.candidates->(e->>'item_id'),e)) FROM jsonb_array_elements(d.result->'candidates') e))
      FROM incoming i WHERE d.id=CAST(i.id AS uuid)"""),
        {"data": json.dumps(list(groups.values()))},
    )
