"""Discover the implemented maintenance contract and read owned evidence."""

import hashlib
import json

from crate.agent_access import AgentPrincipal, actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.agent_quality import get_library_quality as _read_quality
from crate.db.repositories.agent_plans import get_owned_plan
from crate.health_check import ARTIST_SCOPED_CHECKS

_LIMITS = {
    "search_shows": {"rows": 50, "offset": 10000},
    "preview_shows_import": {
        "shows": 50,
        "consolidation_ids": 10,
        "server_extraction": False,
    },
    "apply_shows_import": {"plans": 1, "exact_version": True},
    "get_operation_catalog": {"checks": 17},
    "get_plan": {
        "plans": 1,
        "plan_bytes": 40000,
        "result_page_size": 100,
        "result_page_bytes": 12000,
    },
    "list_library_issues": {"page_size": 100},
    "inspect_artist": {"artists": 1},
    "get_library_quality": {"page_size": 100},
    "list_jobs": {"page_size": 100},
    "get_job": {"jobs": 1},
    "read_diagnostics": {
        "page_size": 100,
        "metric_window_minutes": 100,
        "series": "enumerated",
    },
    "get_analysis_status": {"tracks": 200, "pipelines": 2},
    "run_health_check": {
        "scopes": ["artist", "global"],
        "checks": 17,
        "artist_checks": sorted(ARTIST_SCOPED_CHECKS),
    },
    "run_quality_check": {"scope": "global", "approval": "mandatory"},
    "preview_repairs": {"issues": 20, "legacy_directed_photo_issues": 1},
    "apply_repairs": {"plans": 1, "issues": 20},
    "preview_metadata_update": {"entities": 1, "album_tracks": 100},
    "plan_enrichment": {
        "artists": 20,
        "providers": 5,
        "facets": 9,
        "logical_fetches": 100,
    },
    "plan_analysis": {"tracks": 200, "pipelines": 2},
    "plan_library_sync": {
        "albums": 100,
        "indexed_albums_only": True,
        "global_limit_explicit": True,
    },
    "plan_metadata_export": {
        "albums": 20,
        "tracks_per_album": 100,
        "artifact_bytes": 16777216,
        "include_audio": False,
    },
    "plan_metadata_rehydrate": {
        "albums": 20,
        "tracks_per_album": 100,
        "audio_tags": False,
        "computed_analysis_import": False,
    },
    "read_audit": {"page_size": 100, "window_hours": 24, "raw_details": False},
    "list_schedules": {"schedules": 16, "writes_defaults": False},
    "get_runtime_policy": {"pools": 5, "configured_and_effective_separate": True},
    "preview_job_retry": {
        "default_scope": "own",
        "instance_grant": "ops.jobs.manage_instance",
        "retries": 3,
        "parameter_cloning": False,
    },
    "preview_job_cancel": {
        "default_scope": "own",
        "instance_grant": "ops.jobs.manage_instance",
        "descendants": 200,
        "max_depth": 16,
        "request_is_stop": False,
    },
    "run_schedule": {
        "reviewed_schedules": ["compute_analytics"],
        "approval": "mandatory",
        "governor": True,
        "dedup": True,
    },
    "preview_schedule_update": {
        "schedules": 16,
        "maximum_interval_seconds": 2678400,
        "expected_revision": True,
    },
    "preview_runtime_update": {
        "pools": 5,
        "max_running": 64,
        "expected_revision": True,
        "approval": "mandatory",
    },
    "retry_job": {"own_jobs_only": True, "operation": "run_health_check", "retries": 3},
    "cancel_job": {"own_jobs_only": True, "states": ["pending"]},
}


def get_operation_catalog(principal: AgentPrincipal) -> dict:
    from crate.agent_operation_catalog import OPERATIONS
    from crate.mcp.tools import ACTION_CATALOG, CATALOG, _allowed
    from crate.mcp.contract import (
        CONTRACT_VERSION,
        contract_metadata,
        schema_fingerprint,
        worker_readiness,
    )

    operations = []
    readiness = (
        worker_readiness()
        if actions_enabled()
        and any(_allowed(principal, name) for name in ACTION_CATALOG)
        else None
    )
    for name, (model, grant, _) in (CATALOG | ACTION_CATALOG).items():
        action = name in ACTION_CATALOG
        limits = {
            **(
                {"plan_bytes": 40000, "target_limit": 500}
                if action and name not in {"retry_job", "cancel_job"}
                else {}
            ),
            **_LIMITS.get(name, {"plans": 1}),
        }
        grants = (
            ["editorial.prepare", "editorial.write", "editorial.publish"]
            if name == "editorial_plan_apply"
            else []
            if name in {"editorial_plan_get", "editorial_plan_validate"}
            else [grant]
            if grant
            else []
        )
        allowed = _allowed(principal, name)
        status = (
            "disabled"
            if action and not actions_enabled()
            else "enabled"
            if allowed
            else "denied"
        )
        if status == "enabled" and action and readiness and readiness["missing"]:
            status = "unavailable"
        operations.append(
            {
                "name": name,
                "status": status,
                "contract_version": CONTRACT_VERSION,
                "input_schema_sha256": schema_fingerprint(model),
                "readiness": readiness
                if action and allowed and actions_enabled()
                else {
                    "status": status,
                    "missing": []
                    if status == "enabled"
                    else [
                        "actions_disabled"
                        if status == "disabled"
                        else "required_grants"
                    ],
                },
                "required_grants": grants,
                **(
                    {
                        "grants_by_variant": {
                            "prepare_visibility": ["editorial.publish"],
                            "publish_new_or_duplicate": [
                                "editorial.prepare",
                                "editorial.write",
                                "editorial.publish",
                            ],
                            "publish_existing_visibility": ["editorial.publish"],
                        }
                    }
                    if name == "editorial_publication_set"
                    else {}
                ),
                **(
                    {
                        "grants_by_variant": {
                            "owned_editorial_plan": ["editorial.prepare"],
                            "owned_visibility_plan": ["editorial.publish"],
                        }
                    }
                    if name in {"editorial_plan_get", "editorial_plan_validate"}
                    else {}
                ),
                **(
                    {
                        "grants_by_operation": {
                            "repair_photo_flag": "library.repair.photo_flag",
                            **{
                                operation: entry[0]
                                for operation, entry in OPERATIONS.items()
                            },
                        }
                    }
                    if name == "get_plan"
                    else {}
                ),
                **(
                    {
                        "grants_by_variant": {
                            "directed_photo": "library.repair.photo_flag",
                            "exact_issue_selection": "library.repair.run",
                        }
                    }
                    if name in {"preview_repairs", "apply_repairs"}
                    else {}
                ),
                "read_only": not action,
                "limits": limits,
                **(
                    {
                        "grants_by_source": {
                            "worker_logs": "ops.logs.read",
                            "worker_status": "ops.status.read",
                            "analysis_status": "ops.status.read",
                            "metric_series": "ops.status.read",
                        }
                    }
                    if name == "read_diagnostics"
                    else {}
                ),
            }
        )
    from crate.repair_contracts import repair_contracts

    checks = [
        {
            **contract,
            "mcp_support": contract["support"],
            "artist_scanner_supported": contract["check_type"] in ARTIST_SCOPED_CHECKS,
        }
        for contract in repair_contracts()
    ]
    presets = None
    if principal.grants & {"library.metadata.export", "library.metadata.rehydrate"}:
        from crate.config import load_config

        try:
            configured = load_config().get("agent_metadata_presets") or {}
            presets = {
                "availability": "configured",
                "filesystem_readiness": "checked_in_worker",
                "items": [
                    {
                        "id": name,
                        "export": value.get("export") is True
                        and "library.metadata.export" in principal.grants,
                        "rehydrate": value.get("rehydrate") is True
                        and "library.metadata.rehydrate" in principal.grants,
                    }
                    for name, value in sorted(configured.items())
                    if isinstance(name, str) and isinstance(value, dict)
                ],
            }
        except (OSError, ValueError, AttributeError):
            presets = {"availability": "unavailable", "items": []}
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "agent_operation_catalog",
        "data": {
            "contract": contract_metadata(),
            "operations": operations,
            "checks": checks,
            "metadata_presets": presets,
        },
        "interpretation": "Only enabled operations and supported checks can execute through MCP. Catalog discovery grants no permissions; each call rechecks current authority. Conditional repair variants can still require manual intervention. Every complete plan must fit both its target and byte budgets.",
    }


def get_plan(principal: AgentPrincipal, *, plan_id: str, limit=50, cursor=None) -> dict:
    from crate.agent_access import authorization_context
    from crate.agent_diagnostics import _cursor, _decode, _fingerprint, _rows
    from crate.agent_operation_catalog import (
        operation_result_items,
        operation_result_summary,
    )

    if type(limit) is not int or not 1 <= limit <= 100:
        raise DiagnosticError("INVALID_ARGUMENT", "Result page size must be 1 to 100")
    document = get_owned_plan(principal, plan_id)
    raw = document.get("result")
    items = operation_result_items(raw) if raw is not None else []
    filters = {
        "principal_id": principal.id,
        "authorization_context": authorization_context(principal),
        "plan_id": document["plan_id"],
    }
    version = hashlib.sha256(
        json.dumps(document, sort_keys=True, default=str).encode()
    ).hexdigest()
    offset = 0
    if cursor:
        decoded = _decode(cursor, filters)
        if decoded.get("version") != version:
            raise DiagnosticError(
                "CURSOR_STALE", "Plan or result changed; restart pagination"
            )
        offset = decoded.get("offset")
        if type(offset) is not int or not 0 <= offset <= len(items):
            raise DiagnosticError("INVALID_ARGUMENT", "Invalid result cursor")
    page = _rows(items[offset:], limit, byte_budget=11800)
    next_offset = offset + len(page)
    next_cursor = (
        _cursor(
            {
                "filters": _fingerprint(filters),
                "version": version,
                "offset": next_offset,
            }
        )
        if next_offset < len(items)
        else None
    )
    summary = operation_result_summary(
        raw, plan_id=document["plan_id"], job_id=document.get("job_id")
    )
    if summary is not None:
        summary.update(
            {
                "items": page,
                "total": len(items),
                "next_cursor": next_cursor,
                "evidence_version": version,
            }
        )
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "agent_plan",
        "data": {**document, "result": summary},
        "returned_count": len(page),
        "next_cursor": next_cursor,
        "interpretation": "The complete approved diff is included. Result items are paginated outcomes with modified field names, not duplicated before/after values. The result hash and result_path identify exact private evidence retained for Admin review.",
    }


def get_analysis_status(
    principal: AgentPrincipal, *, track_uids=None, plan_id=None, limit=50, cursor=None
) -> dict:
    from crate.agent_analysis import get_analysis_status as read_status
    from crate.db.repositories.agent_plans import get_owned_analysis_references
    from crate.agent_diagnostics import _cursor, _decode, _fingerprint, _rows

    if type(limit) is not int or not 1 <= limit <= 100:
        raise DiagnosticError("INVALID_ARGUMENT", "Analysis page size must be 1 to 100")

    if "library.health.read" not in principal.grants:
        raise DiagnosticError("FORBIDDEN", "Integration lacks the diagnostic grant")
    if plan_id:
        plan = get_owned_analysis_references(principal, plan_id)
        if plan["state"] not in {"applied", "partial", "failed", "conflict"}:
            data = {
                "status": "not_submitted",
                "verification": {"status": "not_started"},
                "items": [],
            }
        else:
            data = read_status(references=plan["references"])
    else:
        data = read_status(track_uids=track_uids)
    filters = {"plan_id": plan_id, "track_uids": sorted(track_uids or [])}
    evidence_version = hashlib.sha256(
        json.dumps(data, sort_keys=True, default=str).encode()
    ).hexdigest()
    offset = 0
    if cursor:
        decoded = _decode(cursor, filters)
        offset = decoded.get("offset")
        if type(offset) is not int or not 0 <= offset <= 400:
            raise DiagnosticError("INVALID_ARGUMENT", "Invalid analysis cursor")
        if decoded.get("version") != evidence_version:
            raise DiagnosticError(
                "CURSOR_STALE", "Analysis evidence changed; restart pagination"
            )
    items = data.get("items", [])
    page = _rows(items[offset:], limit)
    next_offset = offset + len(page)
    next_cursor = (
        _cursor(
            {
                "filters": _fingerprint(filters),
                "version": evidence_version,
                "offset": next_offset,
            }
        )
        if next_offset < len(items)
        else None
    )
    data = {
        **data,
        "items": page,
        "total": len(items),
        "next_cursor": next_cursor,
        "evidence_version": evidence_version,
    }
    return {
        "schema_version": "1",
        "availability": "available",
        "source": "analysis_pipeline",
        "data": data,
        "returned_count": len(page),
        "next_cursor": next_cursor,
    }


def get_library_quality(*, category=None, limit=50, cursor=None) -> dict:
    report = _read_quality(category=category, limit=limit, cursor=cursor)
    return {
        "schema_version": "1",
        "availability": "available"
        if report["availability"] == "ready"
        else report["availability"],
        "source": "analytics:quality",
        "data": report,
        "returned_count": len(report.get("items") or []),
        "next_cursor": report.get("next_cursor"),
        "snapshot": report.get("snapshot"),
        "interpretation": "Worker-produced metadata and filename heuristics. Suspected unreadable metadata is not proof of corrupt audio; edition matches are candidates, not acoustic identity.",
    }


__all__ = [
    "get_library_quality",
    "get_operation_catalog",
    "get_plan",
    "get_analysis_status",
]
