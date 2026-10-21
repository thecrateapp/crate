"""Reviewed exact Soulseek acquisition; no alternate peers, upgrades or paid providers."""

import hashlib
import json
import re
import time
from uuid import UUID

import requests

from crate.agent_access import actions_enabled
from crate.agent_diagnostics import DiagnosticError
from crate.agent_library_operations import (
    _envelope,
    prepare_operation,
)
from crate.agent_library_operations import (
    apply_operation as _apply,
)
from crate.db.repositories import agent_acquisition as store

MAX_BYTES = 2147483648
MAX_FILES = 50


def _digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _identifier(value, *, path=False):
    if not isinstance(value, str) or not 1 <= len(value) <= (512 if path else 128):
        raise ValueError("Invalid provider identifier")
    if re.search(r'[\x00-\x1f\x7f?#%:<>"|*]', value):
        raise ValueError("Invalid provider identifier")
    parts = value.replace("\\", "/").split("/")
    if any(not p or p in {".", ".."} for p in parts) or (not path and len(parts) != 1):
        raise ValueError("Invalid provider identifier")
    return value


def _transport(method, endpoint, body=None):
    """Bounded body and generic failures; never log credential-bearing provider URLs."""
    from crate import soulseek

    started = time.monotonic()
    try:
        with requests.request(
            method,
            f"{soulseek._base_url().rstrip('/')}/api/v0/{endpoint}",
            headers={"X-API-Key": soulseek._api_key() or ""},
            json=body,
            timeout=(3, 10),
            stream=True,
            allow_redirects=False,
        ) as response:
            if (
                response.status_code == 409
                and method == "POST"
                and endpoint == "transfers/downloads/batches"
            ):
                return {"duplicate_batch": True}
            response.raise_for_status()
            if response.status_code >= 300:
                raise ValueError("Redirect refused")
            data = bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data) > 1048576 or time.monotonic() - started > 15:
                    raise ValueError("Response too large")
            return json.loads(data) if data else {}
    except Exception:  # noqa: BLE001 — redact all credential-bearing transport errors.
        raise DiagnosticError(
            "PROVIDER_UNAVAILABLE",
            "Soulseek response unavailable or exceeds the bounded transport budget",
        ) from None


def _provider_version():
    from crate import soulseek

    return _digest({"url": soulseek._base_url(), "key": soulseek._api_key()})


def _supported_provider():
    application = _transport("GET", "application")
    version = (application.get("version") or {}).get("current")
    if version not in {"0.26.1", "0.26.1.0"}:
        raise DiagnosticError(
            "NOT_EXECUTABLE", "Only the reviewed slskd 0.26.1 batch API is executable"
        )
    server = application.get("server") or {}
    if not server.get("isConnected") or not server.get("isLoggedIn"):
        raise DiagnosticError(
            "NOT_EXECUTABLE", "Soulseek is not connected and logged in"
        )
    return version


def get_acquisition_readiness(principal, *, provider):
    if "library.acquisition.search" not in principal.grants:
        raise DiagnosticError("FORBIDDEN", "Acquisition search is not granted")
    store.authorize_search(principal)
    from crate import soulseek

    executable = (
        provider == "soulseek" and bool(soulseek._api_key()) and actions_enabled()
    )
    missing = None
    if executable:
        try:
            _supported_provider()
        except DiagnosticError as error:
            executable, missing = False, str(error)
    return _envelope(
        {
            "provider": provider,
            "executable": executable,
            "reason": missing
            or (
                "exact_zero_cost_flac_only"
                if executable
                else "missing_configuration_or_actions_disabled"
                if provider == "soulseek"
                else "provider_has_no_trustworthy_bounded_selection_and_cost_contract"
            ),
            "live_connectivity": "connected" if executable else "unavailable",
            "destination": "staging_then_separately_approved_new_album",
            "max_files": MAX_FILES,
            "max_bytes": MAX_BYTES,
        }
    )


def _selections(search_id, raw):
    if not isinstance(raw, list):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Invalid search response")
    groups = {}
    for peer in raw[:50]:
        try:
            username = _identifier(peer["username"])
            for file in peer.get("files", [])[:500]:
                filename = _identifier(file["filename"], path=True)
                parts = filename.replace("\\", "/").split("/")
                if len(parts) < 3 or not filename.lower().endswith(".flac"):
                    continue
                if any(
                    type(file.get(k)) is not int or file[k] <= 0
                    for k in ("size", "bitDepth", "sampleRate")
                ):
                    continue
                key = (username, "/".join(parts[:-1]))
                groups.setdefault(key, []).append(
                    {
                        "filename": filename,
                        "size": file["size"],
                        "bitDepth": file["bitDepth"],
                        "sampleRate": file["sampleRate"],
                    }
                )
        except (KeyError, TypeError, ValueError):
            continue
    result = []
    provider_version = _provider_version()
    for (username, folder), files in groups.items():
        size = sum(f["size"] for f in files)
        names = [f["filename"].replace("\\", "/").split("/")[-1] for f in files]
        if (
            not 1 <= len(files) <= MAX_FILES
            or size > MAX_BYTES
            or len(set(names)) != len(names)
        ):
            continue
        result.append(
            {
                "provider": "soulseek",
                "search_id": search_id,
                "peer": username,
                "artist": folder.split("/")[-2],
                "release": folder.split("/")[-1],
                "files": sorted(files, key=lambda f: f["filename"]),
                "estimated_bytes": size,
                "cost_minor": 0,
                "cost_basis": "Soulseek transfer has no purchase charge",
                "quality": "FLAC; exact bit depth and sample rate per file",
                "provider_version": provider_version,
            }
        )
    return result


def search_acquisition(principal, *, provider, query, limit=5, trace_id=None):
    readiness = get_acquisition_readiness(principal, provider=provider)["data"]
    if not readiness["executable"]:
        raise DiagnosticError("NOT_EXECUTABLE", readiness["reason"])
    if (
        not isinstance(query, str)
        or not 2 <= len(query) <= 160
        or re.search(r"[\x00-\x1f\x7f]", query)
        or not 1 <= limit <= 5
    ):
        raise ValueError("Invalid acquisition search")
    response = _transport(
        "POST",
        "searches",
        {
            "searchText": query,
            "searchTimeout": 5000,
            "responseLimit": 50,
            "fileLimit": 500,
        },
    )
    try:
        search_id = str(UUID(response["id"]))
    except (ValueError, KeyError, TypeError):
        raise DiagnosticError(
            "PROVIDER_UNAVAILABLE", "Provider did not return a valid search ID"
        ) from None
    time.sleep(5)
    sources = _selections(
        search_id, _transport("GET", f"searches/{search_id}/responses")
    )[:limit]
    bounded = []
    for source in sources:
        if len(json.dumps(source, ensure_ascii=False).encode()) > 12000:
            continue
        if len(json.dumps(bounded + [source], ensure_ascii=False).encode()) > 45000:
            break
        bounded.append(source)
    receipts = store.save_receipts(principal, bounded)
    return _envelope(
        {
            "provider": provider,
            "results": receipts,
            "coverage": "bounded_partial",
            "selection": "human_required",
            "download_started": False,
        }
    )


def preview_acquisition(principal, *, idempotency_key, trace_id=None, **parameters):
    return prepare_operation(
        principal, "acquisition", parameters, idempotency_key, trace_id=trace_id
    )


def apply_acquisition(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply(
        principal,
        "acquisition",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def _validate_source(source):
    _supported_provider()
    if source["provider_version"] != _provider_version():
        raise DiagnosticError("EVIDENCE_STALE", "Provider configuration changed")
    matches = _selections(
        source["search_id"],
        _transport("GET", f"searches/{source['search_id']}/responses"),
    )
    if source not in matches:
        raise DiagnosticError(
            "EVIDENCE_STALE", "Exact peer, files, quality or byte selection changed"
        )


def compile_operation(operation, parameters, config, *, principal, task_id=None):
    if operation == "acquisition_publish":
        from crate.agent_acquisition_publish import compile_publication

        return compile_publication(
            parameters, config, principal=principal, task_id=task_id
        )
    if operation != "acquisition" or set(parameters) != {
        "receipt_id",
        "artist_uid",
        "max_items",
        "max_bytes",
        "max_cost_minor",
        "destination_policy",
    }:
        raise ValueError("Invalid acquisition parameters")
    receipt = store.read_receipt(principal, parameters["receipt_id"])
    source = receipt["source"]
    if (
        parameters["destination_policy"] != "provider_staging_only"
        or type(parameters["max_cost_minor"]) is not int
        or parameters["max_cost_minor"] != 0
        or type(parameters["max_items"]) is not int
        or not len(source["files"]) <= parameters["max_items"] <= MAX_FILES
        or type(parameters["max_bytes"]) is not int
        or not source["estimated_bytes"] <= parameters["max_bytes"] <= MAX_BYTES
    ):
        raise DiagnosticError(
            "LIMIT_EXCEEDED",
            "Exact selection cannot satisfy approved item, byte or zero-cost caps",
        )
    target = store.target_state(parameters["artist_uid"], source["release"])
    if target["name"].casefold() != source["artist"].casefold():
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Provider artist does not match the exact local artist"
        )
    _validate_source(source)
    from crate.agent_acquisition_publish import staging_root

    root = staging_root(config)
    execution = {
        "download_root": str(root),
        **parameters,
        "source": source,
        "target": target,
        "batch_id": parameters["receipt_id"],
        "staging_relative": "crate-agent/" + parameters["receipt_id"],
    }
    return {
        "document": {
            "operation": operation,
            "risk": "high",
            "targets": [
                {"entity_type": "artist", "entity_uid": parameters["artist_uid"]}
            ],
            "changes": [
                {
                    "selection": source,
                    "caps": parameters,
                    "batch_id": execution["batch_id"],
                    "staging_relative": execution["staging_relative"],
                }
            ],
            "impact": {
                "scope": "selected",
                "library_publication": "requires_separate_approved_plan",
            },
            "preconditions": {
                "source_hash": _digest(source),
                "source_valid_until": receipt["expires_at"].isoformat(),
                "target": target,
            },
            "verification": {
                "status": "exact_transfer_and_staged_audio_then_library_pending"
            },
        },
        "execution": execution,
    }


def _downloads():
    raw = _transport("GET", "transfers/downloads")
    if not isinstance(raw, list):
        raise DiagnosticError("PROVIDER_UNAVAILABLE", "Transfer state unavailable")
    return [
        {**file, "username": peer.get("username")}
        for peer in raw
        for directory in peer.get("directories", [])
        for file in directory.get("files", [])
    ]


def apply_operation(operation, execution, config, *, task_id, authorize):
    if operation == "acquisition_publish":
        from crate.agent_acquisition_publish import apply_publication

        return apply_publication(
            execution, config, task_id=task_id, authorize=authorize
        )
    from crate.agent_acquisition_publish import (
        _safe_path,
        staged_manifest,
        staging_root,
    )
    from crate.worker_handlers import is_cancelled

    if str(staging_root(config)) != execution["download_root"]:
        raise DiagnosticError("EVIDENCE_STALE", "Provider staging root changed")

    source = execution["source"]
    authorize()
    receipt = store.execution_receipt(task_id, execution["receipt_id"])
    if receipt["source"] != source:
        raise DiagnosticError("EVIDENCE_STALE", "Persisted source selection changed")
    _validate_source(source)
    if (
        store.target_state(execution["artist_uid"], source["release"])
        != execution["target"]
    ):
        raise DiagnosticError("EVIDENCE_STALE", "Target library identity changed")
    names = {f["filename"] for f in source["files"]}
    prior = _downloads()
    if any(f.get("filename") in names for f in prior):
        raise DiagnosticError(
            "RECONCILIATION_REQUIRED",
            "Selected paths already have provider transfer state",
        )
    selection_hash = _digest(
        {
            "provider": "soulseek",
            "peer": source["peer"],
            "files": source["files"],
        }
    )
    # Durable separate commit before an external send; failed/uncertain sends never replay.
    store.reserve_transfer(task_id, execution["receipt_id"], selection_hash, execution)
    staging = _safe_path(staging_root(config), execution["staging_relative"])
    if staging.exists() or staging.is_symlink():
        raise DiagnosticError(
            "SOURCE_CONFLICT", "Owned staging destination already exists"
        )
    response = authorize(
        lambda: _transport(
            "POST",
            "transfers/downloads/batches",
            {
                "id": execution["batch_id"],
                "searchId": source["search_id"],
                "username": source["peer"],
                "files": [
                    {"filename": f["filename"], "size": f["size"]}
                    for f in source["files"]
                ],
                "options": {"destination": execution["staging_relative"]},
            },
        )
    )
    status, rows = "pending", []
    enqueue_failed = bool(response.get("failures"))
    for _ in range(24):
        if is_cancelled(task_id):
            status = "cancelled"
            break
        authorize()
        status, rows = _batch_state(execution)
        if enqueue_failed:
            status = "conflict"
        if status != "pending":
            break
        time.sleep(5)
    evidence = {
        "download_root": execution["download_root"],
        "batch_id": execution["batch_id"],
        "staging_relative": execution["staging_relative"],
        "source": source,
        "target": execution["target"],
        "caps": {k: execution[k] for k in ("max_items", "max_bytes", "max_cost_minor")},
        "remote_state": status,
        "transfers": [
            {k: f.get(k) for k in ("filename", "size", "bytesTransferred", "state")}
            for f in rows
        ],
    }
    if status == "staged":
        try:
            evidence["manifest"] = staged_manifest(
                source, config, execution["staging_relative"], check=authorize
            )
        except (DiagnosticError, ValueError, OSError):
            status = "verification_conflict"
    store.record_transfer(task_id, status, evidence)
    return {
        "execution": {
            "status": "completed" if status == "staged" else "partial",
            "items": [{"task_id": task_id, "provider": "soulseek", "status": status}],
            "remote_transfers_may_continue": status != "staged",
            "publication": "not_started",
        },
        "verification": {
            "status": "passed"
            if status == "staged"
            else "manual_reconciliation_required"
        },
        "projection": {"status": "library_pending_separate_approval"},
    }


def _batch_state(execution):
    source = execution["source"]
    batch = _transport("GET", f"transfers/downloads/batches/{execution['batch_id']}")
    rows = batch.get("transfers", [])
    expected = {f["filename"]: f["size"] for f in source["files"]}
    if (
        batch.get("id") != execution["batch_id"]
        or batch.get("username") != source["peer"]
        or batch.get("searchId") != source["search_id"]
        or (batch.get("options") or {}).get("destination")
        != execution["staging_relative"]
        or len(rows) != len({f.get("filename") for f in rows})
        or any(
            f.get("filename") not in expected
            or f.get("username") != source["peer"]
            or f.get("batchId") != execution["batch_id"]
            or f.get("size") != expected[f["filename"]]
            or f.get("bytesTransferred", 0) > expected[f["filename"]]
            for f in rows
        )
    ):
        return "conflict", []
    if any(
        any(s in f.get("state", "") for s in ("Errored", "Rejected", "Cancelled"))
        for f in rows
    ):
        return "conflict", rows
    if len(rows) == len(expected) and all(
        f.get("state") == "Completed, Succeeded"
        and f.get("bytesTransferred") == expected[f["filename"]]
        for f in rows
    ):
        return "staged", rows
    return "pending", rows


def reconcile_transfer(source_job_id, evidence, config, *, check=None):
    """Observe the original batch only. No re-enqueue, peer substitution or resume."""
    from crate.agent_acquisition_publish import staged_manifest, staging_root

    if str(staging_root(config)) != evidence["download_root"]:
        raise DiagnosticError("EVIDENCE_STALE", "Provider staging root changed")
    if evidence["source"]["provider_version"] != _provider_version():
        raise DiagnosticError(
            "EVIDENCE_STALE", "Provider changed since original transfer"
        )
    status, rows = _batch_state(evidence)
    if status != "staged":
        raise DiagnosticError(
            "RECONCILIATION_REQUIRED",
            "Original exact batch has not completed successfully",
        )
    manifest = staged_manifest(
        evidence["source"], config, evidence["staging_relative"], check=check
    )
    result = {
        **evidence,
        "manifest": manifest,
        "remote_state": "staged",
        "transfers": [
            {k: f.get(k) for k in ("filename", "size", "bytesTransferred", "state")}
            for f in rows
        ],
    }
    store.record_transfer(source_job_id, "staged", result)
    return result


def preview_acquisition_publication(
    principal, *, source_job_id, idempotency_key, trace_id=None
):
    return prepare_operation(
        principal,
        "acquisition_publish",
        {"source_job_id": source_job_id},
        idempotency_key,
        trace_id=trace_id,
    )


def apply_acquisition_publication(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply(
        principal,
        "acquisition_publish",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


__all__ = [
    "apply_acquisition",
    "apply_acquisition_publication",
    "apply_operation",
    "compile_operation",
    "get_acquisition_readiness",
    "preview_acquisition",
    "preview_acquisition_publication",
    "reconcile_transfer",
    "search_acquisition",
]
