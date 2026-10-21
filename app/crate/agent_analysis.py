"""Exact analysis plans; DSP remains in the analysis daemons."""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from uuid import UUID

from crate.agent_metadata import _path
from crate.analysis_provenance import source_identity, source_version
from crate.db.jobs.agent_analysis import requeue_analysis_targets
from crate.db.queries.agent_analysis import (
    analysis_targets_version,
    read_analysis_targets,
)


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    if operation != "analysis" or set(parameters) - {"track_uids", "pipelines", "mode"}:
        raise ValueError("Unsupported analysis parameters")
    uids = parameters.get("track_uids")
    pipelines = parameters.get("pipelines", ["analysis", "bliss"])
    mode = parameters.get("mode", "pending")
    if (
        not isinstance(uids, list)
        or not isinstance(pipelines, list)
        or mode not in {"pending", "refresh"}
    ):
        raise ValueError("Unsupported analysis parameters")
    state = read_analysis_targets(uids, pipelines)
    files = [
        {
            "entity_uid": t["entity_uid"],
            "path": t["path"],
            "source": source_identity(str(_path(t["path"], config))),
        }
        for t in state["tracks"]
    ]
    changes = [
        {
            "entity_uid": t["entity_uid"],
            "pipeline": p["pipeline"],
            "before": p["state"],
            "after": "pending",
            "generation_before": p["generation"],
        }
        for p in state["processing"]
        for t in state["tracks"]
        if p["track_id"] == t["id"] and (mode == "refresh" or p["state"] == "pending")
    ]
    version = analysis_targets_version(state)
    return {
        "document": {
            "operation": operation,
            "targets": [
                {"entity_type": "track", "entity_uid": t["entity_uid"]}
                for t in state["tracks"]
            ],
            "source_versions": {
                "database": version,
                "files": [
                    {
                        "entity_uid": f["entity_uid"],
                        "source_version": source_version(f["source"]),
                    }
                    for f in files
                ],
            },
            "changes": changes,
            "impact": {
                "database": True,
                "filesystem": False,
                "audio_read": True,
                "tracks": len(files),
                "bytes_scheduled": sum(f["source"]["size"] for f in files),
                "pipelines": pipelines,
                "completion": "asynchronous_daemon_results",
                "may_replace_existing_results": mode == "refresh",
            },
            "risk": "caution" if mode == "refresh" else "safe",
            "reversibility": "existing analysis values retained until a new result commits",
        },
        "execution": {
            "track_uids": [t["entity_uid"] for t in state["tracks"]],
            "pipelines": pipelines,
            "mode": mode,
            "database_version": version,
            "files": files,
            "references": [
                {
                    "track_uid": change["entity_uid"],
                    "pipeline": change["pipeline"],
                    "generation": change["generation_before"] + 1,
                    "source_version": source_version(
                        next(
                            file["source"]
                            for file in files
                            if file["entity_uid"] == change["entity_uid"]
                        )
                    ),
                }
                for change in changes
            ],
        },
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize: Callable
) -> dict:
    if operation != "analysis":
        raise ValueError("Unsupported analysis operation")
    authorize()
    for file in execution["files"]:
        if source_identity(str(_path(file["path"], config))) != file["source"]:
            return {
                "execution": {"status": "conflict", "code": "SOURCE_CHANGED"},
                "verification": {"status": "conflict"},
            }
    result = authorize(
        lambda: requeue_analysis_targets(
            execution["track_uids"],
            execution["pipelines"],
            expected_version=execution["database_version"],
            mode=execution["mode"],
        )
    )
    files = {f["entity_uid"]: f for f in execution["files"]}
    for reference in result.get("references", []):
        reference["source_version"] = source_version(
            files[reference["track_uid"]]["source"]
        )
    return {
        "execution": result,
        "verification": {
            "status": "conflict"
            if result["status"] == "conflict"
            else "passed"
            if result["status"] == "skipped"
            else "pending",
            "references": result.get("references", []),
        },
    }


def get_analysis_status(
    *, track_uids: list[str] | None = None, references: list[dict] | None = None
) -> dict:
    if references is not None:
        if not isinstance(references, list) or not 1 <= len(references) <= 400:
            raise ValueError("Analysis status requires bounded references")
        if any(
            set(r) - {"track_uid", "pipeline", "generation", "source_version"}
            or type(r.get("generation")) is not int
            or r["generation"] < 0
            for r in references
        ):
            raise ValueError("Invalid analysis references")
        uids = list(dict.fromkeys(str(UUID(str(r["track_uid"]))) for r in references))
        pipelines = sorted({r["pipeline"] for r in references})
        expected = {
            (str(UUID(str(r["track_uid"]))), r["pipeline"]): r for r in references
        }
        if len(expected) != len(references):
            raise ValueError("Duplicate analysis references")
    else:
        uids = [str(UUID(str(uid))) for uid in (track_uids or [])]
        pipelines = ["analysis", "bliss"]
        expected = {}
    state = read_analysis_targets(uids, pipelines, require_all=False)
    tracks = {t["id"]: t for t in state["tracks"]}
    items = []
    present = {track["entity_uid"] for track in state["tracks"]}
    for uid in uids:
        if uid not in present:
            for pipeline in pipelines:
                if not expected or (uid, pipeline) in expected:
                    items.append(
                        {
                            "track_uid": uid,
                            "pipeline": pipeline,
                            "generation": None,
                            "status": "not_found",
                            "version_evidence": "unknown",
                            "analysis_version": None,
                        }
                    )
    for row in state["processing"]:
        uid = tracks[row["track_id"]]["entity_uid"]
        reference = expected.get((uid, row["pipeline"]))
        if expected and reference is None:
            continue
        status = row["state"]
        version = None
        try:
            version = (
                json.loads(row["pipeline_signature"])
                if row["pipeline_signature"]
                else None
            )
        except (ValueError, TypeError):
            pass
        evidence = (
            "recorded"
            if isinstance(version, dict) and version.get("implementation_sha256")
            else "unknown"
        )
        if reference and row["generation"] < reference["generation"]:
            status = "not_submitted"
        elif reference and row["generation"] > reference["generation"]:
            status = "superseded"
        elif (
            reference
            and status == "done"
            and (
                evidence != "recorded"
                or (
                    reference.get("source_version")
                    and (
                        not isinstance(version, dict)
                        or version.get("source_version") != reference["source_version"]
                    )
                )
            )
        ):
            status = "verification_failed"
        items.append(
            {
                "track_uid": uid,
                "pipeline": row["pipeline"],
                "generation": row["generation"],
                "status": status,
                "version_evidence": evidence,
                "analysis_version": version,
            }
        )
    counts = dict(Counter(item["status"] for item in items))
    terminal_bad = any(
        item["status"] in {"failed", "superseded", "verification_failed", "not_found"}
        for item in items
    )
    done = bool(items) and all(item["status"] == "done" for item in items)
    not_submitted = bool(items) and all(
        item["status"] == "not_submitted" for item in items
    )
    return {
        "status": "failed"
        if terminal_bad
        else "completed"
        if done
        else "not_submitted"
        if not_submitted
        else "pending",
        "verification": {
            "status": "failed"
            if terminal_bad
            else "passed"
            if done
            else "not_started"
            if not_submitted
            else "pending"
        },
        "counts": counts,
        "items": items,
    }


__all__ = ["compile_operation", "apply_operation", "get_analysis_status"]
