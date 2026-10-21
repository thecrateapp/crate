"""Pure, bounded operational observations. Stored evidence is not a live probe."""

import json
import re
from uuid import UUID

from crate.agent_diagnostics import (
    DiagnosticError,
    _date,
    _envelope,
    _fresh,
    _now,
    _safe,
)
from crate.db.queries import agent_observability as evidence_store
from crate.smart_mix import versions

SERVICES = (
    "crate-api",
    "crate-readplane",
    "crate-worker",
    "crate-fast-worker",
    "crate-maintenance-worker",
    "crate-analysis-worker",
    "crate-playback-worker",
    "crate-projector",
    "crate-media-worker",
    "crate-ui",
    "crate-listen",
    "crate-cast-receiver",
    "crate-site",
    "crate-docs",
    "crate-postgres",
    "crate-redis",
    "redis-durable",
)
RUNTIME_FIELDS = {
    "worker_live": ("engine", "running_count", "pending_count"),
    "analysis_status": tuple(
        f"{pipeline}_{state}"
        for pipeline in ("analysis", "bliss")
        for state in ("done", "pending", "active", "failed")
    )
    + ("total",),
    "imports_pending": ("count",),
    "smart_mix:coverage": (
        "profile_version",
        "analyzer_version",
        "total_tracks",
        "current_profiles",
        "stale_profiles",
        "outdated_profiles",
        "source_changed_profiles",
        "missing_profiles",
        "coverage_percent",
        "quality",
        "current_quality",
        "processing",
        "versions",
    ),
    "smart_mix:backfill_campaign": (
        "target",
        "status",
        "batch_size",
        "max_attempts",
        "batches",
        "claimed",
        "sequence",
    ),
}


def _bounded(value, depth=0):
    if depth > 5:
        return None
    if isinstance(value, dict):
        return _safe(
            {str(k)[:80]: _bounded(v, depth + 1) for k, v in list(value.items())[:20]}
        )
    if isinstance(value, list):
        return [_bounded(v, depth + 1) for v in value[:20]]
    if isinstance(value, str):
        return _safe(value)[:512]
    return _safe(value)


def _was_truncated(value, depth=0):
    if depth > 5:
        return value is not None
    if isinstance(value, dict):
        return len(value) > 20 or any(
            _was_truncated(v, depth + 1) for v in value.values()
        )
    if isinstance(value, list):
        return len(value) > 20 or any(_was_truncated(v, depth + 1) for v in value)
    return isinstance(value, str) and len(value) > 512


def _load(**kwargs):
    try:
        return evidence_store.read_observation_evidence(**kwargs), None
    except Exception:  # noqa: BLE001 — failures must not leak DB DSNs or credentials.
        return {}, "Persisted evidence source failed"


def _records(evidence):
    return {
        r["source"]: r
        for group in ("runtime", "snapshots")
        for r in evidence.get(group) or []
    }


def _source(source, record=None, payload=None, failure=None, fresh=180):
    observed = (record or {}).get("observed_at")
    state, reason = _fresh(observed, fresh, 86400)
    if record and record.get("oversized") and not failure:
        state, reason, payload = (
            "unavailable",
            "Stored evidence exceeds 32768 byte bound",
            None,
        )
    elif failure or not record or not isinstance(payload, dict) or not payload:
        state, reason = "unavailable", failure or "No stored evidence"
        payload = None
    elif record.get("invalidated_at") and state != "unavailable":
        state, reason = "stale", "Stored snapshot is invalidated"
    truncated = _was_truncated(payload)
    payload = _bounded(payload)
    if len(json.dumps(payload, ensure_ascii=False).encode()) > 12000:
        state, reason, payload, truncated = (
            "unavailable",
            "Sanitized source exceeds 12000 byte display bound",
            None,
            True,
        )
    date = _date(observed)
    return {
        **_envelope(source, payload, observed, state, reason),
        "truncated": truncated,
        "freshness": {
            "age_seconds": max(0, (_now() - date).total_seconds()) if date else None,
            "fresh_seconds": fresh,
            "expired_seconds": 86400,
        },
        "version": _bounded(
            {
                key: record[key]
                for key in ("version", "source_seq")
                if key in (record or {})
            }
        )
        if record
        else {},
        "coverage": "partial" if payload else "unavailable",
        "interpretation": "Persisted observation; available does not prove functional health",
    }


def _runtime(records, name, failure=None):
    record = records.get(name)
    payload = (record or {}).get("payload")
    selected = {
        k: payload[k]
        for k in RUNTIME_FIELDS[name]
        if isinstance(payload, dict)
        and k in payload
        and (
            not isinstance(payload[k], (dict, list))
            or k in {"quality", "current_quality", "processing", "versions"}
        )
    }
    result = _source(name, record, selected, failure)
    result["version"] = _bounded(
        {
            k: selected[k]
            for k in ("analyzer_version", "profile_version", "target")
            if k in selected
        }
    )
    return result


def _result(name, sources, *, data=None, queried_at=None):
    states = [source["availability"] for source in sources.values()]
    state = (
        "available"
        if states and all(s == "available" for s in states)
        else "stale"
        if any(s != "unavailable" for s in states)
        else "unavailable"
    )
    return _envelope(
        name,
        {
            "sources": sources,
            "queried_at": str(queried_at) if queried_at else None,
            **(data or {}),
        },
        availability=state,
        coverage="partial",
        interpretation="Source timestamps are independent. Missing evidence and live probes remain unknown; no refresh or task enqueue.",
    )


def _missing(name, reason):
    return _source(name, failure=reason)


def get_instance_inventory():
    """Inventory current contract/schema and stored service image references."""
    from crate.mcp.contract import CONTRACT_VERSION

    evidence, failure = _load()
    records = _records(evidence)
    record = records.get("ops:stack")
    stack = (record or {}).get("payload") or {}
    containers = stack.get("containers") if isinstance(stack, dict) else None
    containers = containers if isinstance(containers, list) else []
    services = {}
    for service in SERVICES:
        rows = [
            r
            for r in (containers or [])[:32]
            if isinstance(r, dict) and r.get("name") == service
        ]
        row = rows[0] if len(rows) == 1 else None
        image = (row or {}).get("image")
        valid_image = (
            isinstance(image, str)
            and re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9._-]*(?::[0-9]{1,5})?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-fA-F0-9]{64})?",
                image,
            )
            and len(image) <= 256
            and "crate_mcp_" not in image
            and "://" not in image
        )
        item = _source(
            "ops:stack",
            record,
            {
                "state": (row or {}).get("state")
                if isinstance((row or {}).get("state"), str)
                else None,
                "image_reference": None,
            },
            failure,
            fresh=30,
        )
        if not row or not valid_image or stack.get("available") is not True:
            item = _missing(
                "ops:stack", failure or "No unambiguous stored service image reference"
            )
            item["observed_at"] = (
                str(record["observed_at"])
                if record and record.get("observed_at")
                else None
            )
        elif item["data"] is not None:
            item["data"]["image_reference"] = image
        item.update(image_id=None, image_source_sha=None, live_image_verified=False)
        services[service] = item
    schema = evidence.get("database_schema_version")
    sources = {
        "database_schema": _source(
            "alembic_version",
            {"observed_at": evidence.get("queried_at")},
            {"version": schema} if schema else None,
            failure,
        ),
        "release_manifest": _missing(
            "release_manifest",
            "Release manifest is not available to this API; consult get_release_context on the context MCP",
        ),
        "context": _missing(
            "release_context",
            "Context version and image source revisions are available only from the separate context MCP",
        ),
        "stack": _source(
            "ops:stack",
            record,
            {"available": stack.get("available")}
            if isinstance(stack, dict) and "available" in stack
            else None,
            failure,
            fresh=30,
        ),
    }
    return _result(
        "instance_inventory",
        sources,
        queried_at=evidence.get("queried_at"),
        data={
            "mcp_contract_version": CONTRACT_VERSION,
            "observation_schema_version": "1",
            "services": services,
            "service_limit": 32,
            "services_truncated": isinstance(containers, list) and len(containers) > 32,
            "release_sha": None,
            "context_version": None,
        },
    )


def _pipeline_sources(records, pipeline, failure):
    sources = {"worker": _runtime(records, "worker_live", failure)}
    if pipeline == "import":
        sources["pending"] = _runtime(records, "imports_pending", failure)
    if pipeline in {"analysis", "bliss"}:
        analysis = _runtime(records, "analysis_status", failure)
        if analysis["data"]:
            analysis["data"] = {
                k: v
                for k, v in analysis["data"].items()
                if k.startswith(pipeline + "_") or k == "total"
            }
        sources["coverage"] = analysis
    if pipeline == "projector":
        record = records.get("ops")
        payload = (record or {}).get("payload")
        eventing = payload.get("eventing") if isinstance(payload, dict) else None
        outbox = eventing.get("outbox") if isinstance(eventing, dict) else None
        outbox = outbox if isinstance(outbox, dict) else {}
        selected = {
            k: outbox[k]
            for k in ("pending", "leased", "dead_letter", "oldest_pending_seconds")
            if k in outbox
        }
        sources["outbox"] = _source(
            "ops:dashboard:eventing:outbox",
            record,
            selected,
            failure
            or (
                "Producer marked outbox unavailable"
                if outbox.get("unavailable")
                else None
            ),
        )
    sources["live_probe"] = _missing(
        pipeline + ":live_probe",
        "No functional live probe is exposed by this read surface",
    )
    return sources


def get_observability_summary():
    """Declare independent source coverage for each closed pipeline/subsystem."""
    evidence, failure = _load()
    records = _records(evidence)
    data = {
        name: {
            "coverage": "partial",
            "sources": _pipeline_sources(records, name, failure),
            "unavailable_signals": [
                "functional_live_probe",
                "complete_pipeline_progress",
            ],
        }
        for name in evidence_store.PIPELINES
    }
    sources = {
        name: _runtime(records, name, failure)
        for name in ("worker_live", "analysis_status", "imports_pending")
    }
    return _result(
        "observability_summary",
        sources,
        queried_at=evidence.get("queried_at"),
        data={
            "subsystems": data,
            "unavailable_subsystems": [
                "provider_health",
                "storage_integrity",
                "streaming_end_to_end",
                "redis_live_health",
            ],
            "operational_event_cursor": None,
            "event_cursor_reason": "No global UI-event journal; supervisor owns its operational event cursor",
        },
    )


def get_pipeline_status(pipeline):
    """Bounded 24-hour task sample and independent persisted pipeline counters."""
    if pipeline not in evidence_store.PIPELINES:
        raise DiagnosticError("INVALID_ARGUMENT", "Unknown pipeline")
    evidence, failure = _load(pipeline=pipeline)
    records = _records(evidence)
    sources = _pipeline_sources(records, pipeline, failure)
    jobs = evidence.get("jobs") or []
    sources["tasks"] = _source(
        "tasks:24h:sample",
        {"observed_at": evidence.get("queried_at")},
        {"rows": jobs[:20]},
        failure,
    )
    sources["tasks"].update(
        returned_count=min(len(jobs), 20),
        truncated=len(jobs) > 20,
        coverage="partial",
        interpretation="Newest 20 matching tasks created in 24 hours. Empty sample is not zero backlog or pipeline health.",
    )
    return _result(
        "pipeline_status",
        sources,
        queried_at=evidence.get("queried_at"),
        data={
            "pipeline": pipeline,
            "task_types": list(evidence_store.PIPELINE_TASK_TYPES[pipeline]),
            "sample_limit": 20,
            "lookback_hours": 24,
            "complete": False,
        },
    )


def get_smart_mix_status(track_uids=None):
    """Stored coverage/campaign and exact UUID profile version evidence only."""
    if track_uids is not None and (
        type(track_uids) is not list or len(track_uids) > 50
    ):
        raise DiagnosticError("INVALID_ARGUMENT", "At most 50 exact track UUIDs")
    try:
        uids = [str(UUID(uid)) for uid in (track_uids or [])]
    except (ValueError, TypeError, AttributeError):
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Exact track UUIDs required"
        ) from None
    if len(set(uids)) != len(uids):
        raise DiagnosticError("INVALID_ARGUMENT", "Duplicate track UUIDs")
    evidence, failure = _load(track_uids=uids)
    records = _records(evidence)
    sources = {
        name: _runtime(records, key, failure)
        for name, key in (
            ("coverage", "smart_mix:coverage"),
            ("campaign", "smart_mix:backfill_campaign"),
        )
    }
    current = {
        "analyzer_version": versions.ANALYZER_VERSION,
        "profile_version": versions.PROFILE_SCHEMA_VERSION,
        "planner_identifier": versions.PLANNER_IDENTIFIER,
        "planner_policy_version": versions.PLANNER_POLICY_VERSION,
        "api_contract_version": versions.API_CONTRACT_VERSION,
        "measurement_version": versions.MEASUREMENT_VERSION,
    }
    coverage = sources["coverage"]
    if coverage["data"] and (
        coverage["data"].get("analyzer_version") != current["analyzer_version"]
        or coverage["data"].get("profile_version") != current["profile_version"]
    ):
        coverage.update(
            availability="stale"
            if coverage["availability"] != "unavailable"
            else "unavailable",
            reason="Stored coverage uses a different implementation version; "
            + (coverage["reason"] or "historical evidence"),
        )
    campaign = sources["campaign"]
    if (
        campaign["data"]
        and campaign["data"].get("target") != current["analyzer_version"]
    ):
        campaign.update(
            availability="stale"
            if campaign["availability"] != "unavailable"
            else "unavailable",
            reason="Stored campaign targets a different analyzer version; "
            + (campaign["reason"] or "historical evidence"),
        )
    by_uid = {row["track_uid"]: row for row in evidence.get("profiles") or []}
    tracks = []
    for uid in uids:
        row = by_uid.get(uid)
        state = (
            "missing_track"
            if not row
            else "missing_profile"
            if not row.get("profile_revision")
            else "unavailable"
            if row.get("quality") not in {"full", "partial", "legacy"}
            else "source_changed"
            if row.get("source_stale_at")
            else "outdated"
            if (
                row.get("analyzer_version") != current["analyzer_version"]
                or row.get("profile_version") != current["profile_version"]
            )
            else "current"
        )
        item = _source(
            "track_mix_profiles:exact",
            {"observed_at": (row or {}).get("analyzed_at")},
            row,
            failure,
        )
        item.update(track_uid=uid, profile_status="unknown" if failure else state)
        if row and state != "current" and item["availability"] == "available":
            item.update(
                availability="stale"
                if state in {"source_changed", "outdated"}
                else "unavailable",
                reason=state,
            )
        tracks.append(item)
    result = _result(
        "smart_mix_status",
        sources,
        queried_at=evidence.get("queried_at"),
        data={
            "implementation_versions": current,
            "tracks": tracks,
            "requested_count": len(uids),
            "track_limit": 50,
            "complete": False,
            "interpretation": "Current profile means stored versions match this API implementation; no fresh audio validation, playback test or coverage refresh.",
        },
    )

    omitted = []
    result["data"]["omitted_track_uids"] = omitted
    while (
        len(json.dumps(result, default=str, ensure_ascii=False).encode()) > 55000
        and tracks
    ):
        omitted.insert(0, tracks.pop()["track_uid"])
    result["truncated"] = bool(omitted)
    result["returned_count"] = len(tracks) if uids else 1
    if omitted:
        result["data"]["retry_hint"] = (
            "Request omitted exact track UUIDs in smaller batches"
        )
    return result
