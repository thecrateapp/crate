"""Admin backups API: destinations, policies, runs and the recovery kit (BK4).

Everything sits behind ``system.backups.manage`` and every change is audited.
Secrets are write-only: they arrive in ``secrets`` fields, go to
``crate.credentials`` through ``crate.backups.destinations``, and never come back,
not even in validation errors. The only way out for a repository password or the
SFTP key is the recovery kit, behind the current account password (D1).

No handler runs restic or rclone: tests, copies, verifications and drills are
worker tasks queued with ``create_task_dedup``. Unsaved settings travel to the
worker through ``crate.backups.ephemeral`` (encrypted, ten minutes, read once),
never as task parameters (BG1-9).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse

from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    OpenApiResponses,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.backups import (
    BackupDeleted,
    BackupDestination,
    BackupDestinationCreate,
    BackupDestinationProbe,
    BackupDestinationUpdate,
    BackupLocalRetention,
    BackupOAuthStart,
    BackupOverview,
    BackupPolicy,
    BackupPolicyCreate,
    BackupPolicyUpdate,
    BackupProvider,
    BackupRecoveryKitConfirmation,
    BackupRecoveryKitRequest,
    BackupRunList,
    BackupRunRequest,
    BackupSnapshotList,
)
from crate.api.schemas.common import TaskEnqueueResponse
from crate.auth import verify_password
from crate.backups import ephemeral, health, kit, oauth
from crate.backups import policies as rules
from crate.backups import providers
from crate.backups.destinations import (
    DestinationError,
    DestinationNotFound,
    create_destination,
    delete_destination,
    get_destination,
    list_destinations,
    update_destination,
)
from crate.backups.settings import (
    local_backups_enabled,
    retention_policy,
    set_local_retention,
)
from crate.db.audit import log_audit
from crate.db.queries.backup_destinations import (
    get_backup_destination,
    list_backup_destinations,
    valid_uuid,
)
from crate.db.queries.backup_policies import get_backup_policy, list_backup_policies
from crate.db.queries.backup_runs import (
    count_backup_runs,
    latest_destination_runs,
    latest_successful_dump,
    list_backup_runs,
    repository_size_series,
)
from crate.db.repositories.backup_destinations import (
    confirm_recovery_kit,
    mark_recovery_kit_downloaded,
)
from crate.db.repositories.backup_policies import (
    delete_backup_policy,
    insert_backup_policy,
    set_policy_destinations,
    update_backup_policy,
)
from crate.db.repositories.tasks import (
    create_task_dedup,
    find_active_task_by_type_params,
)
from crate.db.repositories.users import get_user_by_id

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/backups", tags=["backups"])

CAPABILITY = "system.backups.manage"
TEST_TASK = "backup_test_destination"
PROBE_TASK = "backup_probe_destination"
UI_PATH = "/backups"

_NOT_FOUND: OpenApiResponses = {
    404: error_response("The destination or policy does not exist.")
}
_BAD: OpenApiResponses = {
    400: error_response("The settings are not valid; the message says why.")
}
_CONFLICT: OpenApiResponses = {
    409: error_response("The request conflicts with the current state.")
}
_KIT_FILE: OpenApiResponses = {
    200: {
        "content": {"application/octet-stream": {}},
        "description": "The age-encrypted kit",
    }
}
_RESPONSES = merge_responses(AUTH_ERROR_RESPONSES, _BAD, _NOT_FOUND)


def _require(request: Request) -> dict:
    return require_permission(request, CAPABILITY)


def _audit(user: dict, action: str, name: str, details: dict | None = None) -> None:
    log_audit(
        action,
        "backup",
        name,
        details=details or {},
        user_id=user.get("id"),
    )


def _queue(task_type: str, params: dict, dedup_key: str, user: dict) -> dict[str, Any]:
    task_id = create_task_dedup(
        task_type,
        params,
        dedup_key=dedup_key,
        origin="admin",
        actor_user_id=user.get("id"),
    )
    if task_id:
        return {"task_id": str(task_id), "deduplicated": False}
    existing = find_active_task_by_type_params(task_type, params, dedup_key=dedup_key)
    return {"task_id": str(existing or ""), "deduplicated": True}


def _destination_or_404(destination_id: str) -> dict[str, Any]:
    destination = get_destination(destination_id)
    if destination is None:
        raise HTTPException(status_code=404, detail="The destination does not exist")
    return destination


def _policy_view(policy: dict[str, Any]) -> dict[str, Any]:
    return {**policy, "next_run": rules.next_run(policy, rules.local_now())}


def _admin_origin() -> str:
    domain = os.environ.get("DOMAIN", "localhost")
    if domain == "localhost":
        return "http://localhost:5173"
    return f"https://admin.{domain}"


def _redirect_uri() -> str:
    return f"{_admin_origin()}{router.prefix}/oauth/callback"


# ── overview and providers ──────────────────────────────────────────


@router.get(
    "/overview",
    response_model=BackupOverview,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get backup health, alerts and the recovery kit state",
)
def api_backups_overview(request: Request):
    _require(request)
    retention = retention_policy()
    return {
        **health.build_overview(
            destinations=list_destinations(),
            policy_rows=list_backup_policies(),
            latest=latest_destination_runs(),
            latest_dump=latest_successful_dump(),
            size_series=repository_size_series(days=90),
        ),
        "local_retention": {
            "keep_daily": retention.daily,
            "keep_weekly": retention.weekly,
            "keep_monthly": retention.monthly,
        },
        "local_backups_enabled": local_backups_enabled(),
    }


@router.get(
    "/providers",
    response_model=list[BackupProvider],
    responses=AUTH_ERROR_RESPONSES,
    summary="List the destination kinds and their fields",
)
def api_backups_providers(request: Request):
    _require(request)
    out = []
    for spec in providers.PROVIDERS.values():
        out.append(
            {
                "kind": spec.kind,
                "label": spec.label,
                "oauth": spec.oauth,
                "config_fields": [
                    {
                        "name": f.name,
                        "label": f.label,
                        "required": f.required,
                        "system": f.system,
                        "default": f.default,
                    }
                    for f in spec.config_fields
                ],
                "secret_fields": [
                    {
                        "name": f.name,
                        "label": f.label,
                        "required": f.required,
                        "secret": True,
                        "system": f.system,
                    }
                    for f in spec.secret_fields
                ],
            }
        )
    return out


# ── destinations ────────────────────────────────────────────────────


@router.get(
    "/destinations",
    response_model=list[BackupDestination],
    responses=AUTH_ERROR_RESPONSES,
    summary="List backup destinations, without secrets",
)
def api_backups_destinations(request: Request):
    _require(request)
    return list_destinations()


@router.post(
    "/destinations",
    response_model=BackupDestination,
    status_code=201,
    responses=_RESPONSES,
    summary="Create a backup destination (disabled until its first test passes)",
)
def api_backups_create_destination(request: Request, body: BackupDestinationCreate):
    user = _require(request)
    try:
        created = create_destination(
            kind=body.kind,
            name=body.name,
            config=body.config,
            secrets=body.secrets,
            enabled=False,
        )
    except DestinationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    _audit(
        user,
        "create_backup_destination",
        created["name"],
        {
            "destination_id": created["id"],
            "kind": created["kind"],
            "location": created["location"],
            "secrets_set": created["secrets_set"],
        },
    )
    return created


@router.post(
    "/destinations/test",
    response_model=TaskEnqueueResponse,
    status_code=202,
    responses=merge_responses(_RESPONSES, _CONFLICT),
    summary="Test unsaved destination settings without storing any secret",
)
def api_backups_probe_destination(request: Request, body: BackupDestinationProbe):
    user = _require(request)
    if body.kind not in providers.PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown kind: {body.kind}")
    if body.kind == "sftp":
        raise HTTPException(
            status_code=409,
            detail="Save the destination first: Crate generates its SSH key, "
            "and the server must accept the public key before a test can pass",
        )
    try:
        probe_id = ephemeral.put(
            {"kind": body.kind, "config": body.config, "secrets": body.secrets}
        )
    except ephemeral.EphemeralUnavailable:
        raise HTTPException(status_code=503, detail="The probe store is unavailable")
    return _queue(PROBE_TASK, {"probe_id": probe_id}, f"backup_probe:{probe_id}", user)


@router.get(
    "/destinations/{destination_id}",
    response_model=BackupDestination,
    responses=_RESPONSES,
    summary="Get one backup destination, without secrets",
)
def api_backups_destination(request: Request, destination_id: str):
    _require(request)
    return _destination_or_404(destination_id)


@router.patch(
    "/destinations/{destination_id}",
    response_model=BackupDestination,
    responses=merge_responses(_RESPONSES, _CONFLICT),
    summary="Change a backup destination; secrets are write-only",
)
def api_backups_update_destination(
    request: Request, destination_id: str, body: BackupDestinationUpdate
):
    user = _require(request)
    current = _destination_or_404(destination_id)
    if body.enabled and current["repository_initialized_at"] is None:
        raise HTTPException(
            status_code=409,
            detail="Test the connection first: it enables the destination",
        )
    try:
        updated = update_destination(
            destination_id,
            name=body.name,
            config=body.config,
            secrets=body.secrets,
            enabled=body.enabled,
        )
    except DestinationNotFound:
        raise HTTPException(status_code=404, detail="The destination does not exist")
    except DestinationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    _audit(
        user,
        "update_backup_destination",
        updated["name"],
        {
            "destination_id": destination_id,
            "changed": sorted(
                k
                for k, v in body.model_dump(exclude_unset=True).items()
                if k != "secrets"
            ),
            "secrets_changed": sorted((body.secrets or {}).keys()),
        },
    )
    return updated


@router.delete(
    "/destinations/{destination_id}",
    response_model=BackupDeleted,
    responses=_RESPONSES,
    summary="Delete a backup destination (its repository stays where it is)",
)
def api_backups_delete_destination(request: Request, destination_id: str):
    user = _require(request)
    try:
        deleted = delete_destination(destination_id)
    except DestinationNotFound:
        raise HTTPException(status_code=404, detail="The destination does not exist")
    _audit(
        user,
        "delete_backup_destination",
        deleted["name"],
        {"destination_id": destination_id, "kind": deleted["kind"]},
    )
    return {"id": destination_id, "deleted": True}


@router.post(
    "/destinations/{destination_id}/test",
    response_model=TaskEnqueueResponse,
    status_code=202,
    responses=_RESPONSES,
    summary="Queue the connection test of a saved destination",
)
def api_backups_test_destination(request: Request, destination_id: str):
    user = _require(request)
    destination = _destination_or_404(destination_id)
    _audit(
        user,
        "test_backup_destination",
        destination["name"],
        {"destination_id": destination_id},
    )
    return _queue(
        TEST_TASK,
        {"destination_id": destination_id},
        f"{TEST_TASK}:{destination_id}",
        user,
    )


@router.get(
    "/destinations/{destination_id}/snapshots",
    response_model=BackupSnapshotList,
    responses=_RESPONSES,
    summary="List a destination's snapshots as the worker last saw them",
)
def api_backups_snapshots(request: Request, destination_id: str):
    _require(request)
    row = get_backup_destination(destination_id)
    if row is None:
        raise HTTPException(status_code=404, detail="The destination does not exist")
    return {
        "destination_id": destination_id,
        "listed_at": row.get("snapshots_listed_at"),
        "snapshot_count": row.get("snapshot_count"),
        "snapshots": row.get("snapshots") or [],
    }


@router.post(
    "/destinations/{destination_id}/oauth/start",
    response_model=BackupOAuthStart,
    responses=_RESPONSES,
    summary="Start connecting Google Drive or Dropbox with the install's own client",
)
def api_backups_oauth_start(request: Request, destination_id: str):
    user = _require(request)
    destination = _destination_or_404(destination_id)
    try:
        url = oauth.start_authorization(
            destination_id, user_id=int(user["id"]), redirect_uri=_redirect_uri()
        )
    except DestinationNotFound:
        raise HTTPException(status_code=404, detail="The destination does not exist")
    except oauth.OAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    _audit(
        user,
        "connect_backup_destination",
        destination["name"],
        {"destination_id": destination_id},
    )
    return {"authorize_url": url}


@router.get(
    "/oauth/callback",
    response_class=RedirectResponse,
    status_code=303,
    responses=AUTH_ERROR_RESPONSES,
    summary="OAuth callback of Google Drive and Dropbox; redirects to the Backups page",
)
def api_backups_oauth_callback(
    request: Request,
    state: str = Query("", max_length=512),
    code: str = Query("", max_length=4096),
    error: str = Query("", max_length=200),
):
    user = _require(request)

    def back(**params: str) -> RedirectResponse:
        return RedirectResponse(f"{UI_PATH}?{urlencode(params)}", status_code=303)

    if error:
        return back(oauth="error", message=f"The provider refused: {error}")
    try:
        destination = oauth.complete_authorization(
            state=state, code=code, user_id=int(user["id"])
        )
    except (oauth.OAuthError, DestinationNotFound, DestinationError) as exc:
        log.info("Backup OAuth callback refused: %s", exc)
        return back(oauth="error", message=str(exc))
    _audit(
        user,
        "connected_backup_destination",
        destination["name"],
        {"destination_id": destination["id"], "kind": destination["kind"]},
    )
    _queue(
        TEST_TASK,
        {"destination_id": destination["id"]},
        f"{TEST_TASK}:{destination['id']}",
        user,
    )
    return back(oauth="connected", destination=destination["id"])


# ── policies ────────────────────────────────────────────────────────


def _clean_tiers(tiers: Mapping[str, Sequence[str]]) -> dict[str, list[str]]:
    clean = rules.validate_tiers(tiers)
    known = {row["id"] for row in list_backup_destinations()}
    unknown = [d for d in clean if d not in known]
    if unknown:
        raise rules.PolicyError("Unknown destination in the tiers")
    return clean


def _check_drill_destination(values: dict[str, Any]) -> None:
    drill = values.get("drill_destination_id")
    if drill and (valid_uuid(drill) is None or get_backup_destination(drill) is None):
        raise rules.PolicyError("The restore drill destination does not exist")


@router.get(
    "/policies",
    response_model=list[BackupPolicy],
    responses=AUTH_ERROR_RESPONSES,
    summary="List backup policies with their destinations and tiers",
)
def api_backups_policies(request: Request):
    _require(request)
    return [_policy_view(p) for p in list_backup_policies()]


@router.post(
    "/policies",
    response_model=BackupPolicy,
    status_code=201,
    responses=_RESPONSES,
    summary="Create a backup policy",
)
def api_backups_create_policy(request: Request, body: BackupPolicyCreate):
    user = _require(request)
    values = body.model_dump(exclude={"destinations"})
    try:
        clean = rules.validate_policy(values)
        _check_drill_destination(clean)
        tiers = _clean_tiers(body.destinations)
    except rules.PolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    policy = insert_backup_policy(**clean)
    try:
        set_policy_destinations(policy["id"], tiers)
    except Exception:
        delete_backup_policy(policy["id"])
        raise
    created = get_backup_policy(policy["id"]) or policy
    _audit(
        user,
        "create_backup_policy",
        created["name"],
        {"policy_id": created["id"], "destinations": tiers},
    )
    return _policy_view(created)


@router.patch(
    "/policies/{policy_id}",
    response_model=BackupPolicy,
    responses=_RESPONSES,
    summary="Change a backup policy",
)
def api_backups_update_policy(
    request: Request, policy_id: str, body: BackupPolicyUpdate
):
    user = _require(request)
    current = get_backup_policy(policy_id)
    if current is None:
        raise HTTPException(status_code=404, detail="The policy does not exist")
    values = body.model_dump(exclude_unset=True)
    tiers_raw = values.pop("destinations", None)
    try:
        clean = rules.validate_policy(values, current=current) if values else {}
        _check_drill_destination(clean)
        tiers = None if tiers_raw is None else _clean_tiers(tiers_raw)
    except rules.PolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if clean:
        update_backup_policy(policy_id, **clean)
    if tiers is not None:
        set_policy_destinations(policy_id, tiers)
    updated = get_backup_policy(policy_id)
    assert updated is not None
    _audit(
        user,
        "update_backup_policy",
        updated["name"],
        {
            "policy_id": policy_id,
            "changed": sorted([*clean, *([] if tiers is None else ["destinations"])]),
        },
    )
    return _policy_view(updated)


@router.delete(
    "/policies/{policy_id}",
    response_model=BackupDeleted,
    responses=_RESPONSES,
    summary="Delete a backup policy (its runs stay in the history)",
)
def api_backups_delete_policy(request: Request, policy_id: str):
    user = _require(request)
    deleted = delete_backup_policy(policy_id)
    if deleted is None:
        raise HTTPException(status_code=404, detail="The policy does not exist")
    _audit(user, "delete_backup_policy", deleted["name"], {"policy_id": policy_id})
    return {"id": policy_id, "deleted": True}


# ── runs ────────────────────────────────────────────────────────────


@router.get(
    "/runs",
    response_model=BackupRunList,
    responses=AUTH_ERROR_RESPONSES,
    summary="List backup runs, newest first",
)
def api_backups_runs(
    request: Request,
    kind: str | None = Query(None, max_length=32),
    status: str | None = Query(None, max_length=16),
    destination_id: str | None = Query(None, max_length=64),
    policy_id: str | None = Query(None, max_length=64),
    since: datetime | None = None,
    before: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=100_000),
):
    _require(request)
    for value in (destination_id, policy_id):
        if value is not None and valid_uuid(value) is None:
            raise HTTPException(status_code=400, detail="Not a valid id")
    filters = {
        "kind": kind,
        "status": status,
        "destination_id": destination_id,
        "policy_id": policy_id,
        "since": since,
        "before": before,
    }
    items = list_backup_runs(**filters, limit=limit, offset=offset)
    total = count_backup_runs(**filters)
    destinations = {row["id"]: row["name"] for row in list_backup_destinations()}
    policy_names = {row["id"]: row["name"] for row in list_backup_policies()}
    for run in items:
        run["destination_name"] = destinations.get(run.get("destination_id") or "")
        run["policy_name"] = policy_names.get(run.get("policy_id") or "")
        finished = run.get("finished_at")
        run["duration_seconds"] = (
            (finished - run["started_at"]).total_seconds() if finished else None
        )
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }


@router.post(
    "/run",
    response_model=TaskEnqueueResponse,
    status_code=202,
    responses=_RESPONSES,
    summary="Run a policy now, or verify or drill one destination",
)
def api_backups_run(request: Request, body: BackupRunRequest):
    user = _require(request)
    policy = None
    if body.policy_id:
        policy = get_backup_policy(body.policy_id)
        if policy is None:
            raise HTTPException(status_code=404, detail="The policy does not exist")
    if body.kind == "backup":
        if policy is None:
            result = _queue(
                "backup_dump",
                {"ignore_maintenance_window": True},
                "backup_dump:admin",
                user,
            )
            _audit(user, "run_backup", "local dump", {})
            return result
        params = {
            "policy_id": policy["id"],
            "ignore_maintenance_window": True,
            "ignore_window": True,
        }
        result = _queue("backup_dump", params, f"backup_policy:{policy['id']}", user)
        _audit(user, "run_backup", policy["name"], {"policy_id": policy["id"]})
        return result
    if not body.destination_id:
        raise HTTPException(status_code=400, detail="Choose the destination")
    destination = _destination_or_404(body.destination_id)
    if body.kind == "verify":
        params = {
            "destination_id": destination["id"],
            "read_percent": (policy or {}).get("verify_read_percent") or 5,
        }
        task_type = "backup_verify"
    else:
        params = {"destination_id": destination["id"]}
        task_type = "backup_restore_drill"
    result = _queue(task_type, params, f"{task_type}:{destination['id']}", user)
    _audit(
        user,
        f"run_{task_type}",
        destination["name"],
        {"destination_id": destination["id"]},
    )
    return result


# ── local retention ─────────────────────────────────────────────────


@router.get(
    "/local-retention",
    response_model=BackupLocalRetention,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the retention counts of the local dumps",
)
def api_backups_local_retention(request: Request):
    _require(request)
    policy = retention_policy()
    return {
        "keep_daily": policy.daily,
        "keep_weekly": policy.weekly,
        "keep_monthly": policy.monthly,
    }


@router.put(
    "/local-retention",
    response_model=BackupLocalRetention,
    responses=_RESPONSES,
    summary="Set the retention counts of the local dumps",
)
def api_backups_set_local_retention(request: Request, body: BackupLocalRetention):
    user = _require(request)
    try:
        policy = set_local_retention(
            daily=body.keep_daily, weekly=body.keep_weekly, monthly=body.keep_monthly
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    values = {
        "keep_daily": policy.daily,
        "keep_weekly": policy.weekly,
        "keep_monthly": policy.monthly,
    }
    _audit(user, "update_backup_local_retention", "local dumps", values)
    return values


# ── recovery kit ────────────────────────────────────────────────────


@router.post(
    "/recovery-kit",
    response_class=Response,
    responses=merge_responses(
        AUTH_ERROR_RESPONSES,
        _BAD,
        _CONFLICT,
        _KIT_FILE,
    ),
    summary="Download the recovery kit after confirming the account password",
)
def api_backups_recovery_kit(request: Request, body: BackupRecoveryKitRequest):
    user = _require(request)
    account = get_user_by_id(int(user["id"])) or {}
    password_hash = account.get("password_hash")
    if not password_hash:
        raise HTTPException(
            status_code=409,
            detail="This account has no password; set one to download the kit",
        )
    if not verify_password(body.password, str(password_hash)):
        _audit(
            user, "backup_recovery_kit_denied", "recovery kit", {"reason": "password"}
        )
        # 403, not 401: Admin's client treats 401 as an expired session.
        raise HTTPException(status_code=403, detail="The password is not correct")
    try:
        kit.check_passphrase(body.passphrase)
    except kit.KitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    rows = list_backup_destinations()
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sealed = kit.seal_kit(
        kit.build_kit(rows, generated_at=generated_at), body.passphrase
    )
    mark_recovery_kit_downloaded([row["id"] for row in rows])
    _audit(
        user,
        "download_backup_recovery_kit",
        "recovery kit",
        {"destinations": [row["name"] for row in rows], "generated_at": generated_at},
    )
    return Response(
        content=sealed,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{kit.kit_filename(generated_at)}"',
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/recovery-kit/confirm",
    response_model=BackupRecoveryKitConfirmation,
    responses=AUTH_ERROR_RESPONSES,
    summary="Confirm the downloaded recovery kit is stored off the server",
)
def api_backups_confirm_recovery_kit(request: Request):
    user = _require(request)
    confirmed = confirm_recovery_kit()
    _audit(
        user, "confirm_backup_recovery_kit", "recovery kit", {"destinations": confirmed}
    )
    return {"confirmed": confirmed}


__all__ = ["CAPABILITY", "router"]
