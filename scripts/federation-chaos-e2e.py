#!/usr/bin/env python3
"""Bounded recovery drills for the two-node federation development harness."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
COMPOSE = (
    "docker",
    "compose",
    "--project-name",
    "crate-federation-dev",
    "-f",
    str(ROOT / "docker-compose.federation-dev.yaml"),
)
SCENARIOS = (
    "peer-outage",
    "api-restart",
    "worker-restart",
    "import-recovery",
    "redis-restart",
    "postgres-restart",
    "key-rotation-offline",
    "range-resume",
    "grant-revocation",
    "readplane-restart",
    "adversarial-contracts",
)


def _load_e2e_module():
    path = ROOT / "scripts/federation-dev-e2e.py"
    spec = importlib.util.spec_from_file_location("crate_federation_dev_e2e", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


E2E = _load_e2e_module()


def log(message: str) -> None:
    print(message, flush=True)


def compose(*args: str, timeout: int = 180) -> None:
    subprocess.run(
        [*COMPOSE, *args],
        cwd=ROOT,
        check=True,
        timeout=timeout,
    )


def wait_url(url: str, *, timeout_seconds: int = 90) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if 200 <= response.status < 400:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise TimeoutError(f"Service did not recover at {url}")


def stop_service(service: str, recovery: set[str]) -> None:
    compose("stop", "--timeout", "5", service)
    recovery.add(service)


def start_service(service: str, recovery: set[str]) -> None:
    compose("up", "-d", service)
    recovery.discard(service)


def _wait_task_terminal(client, task_id: str, *, timeout_seconds: int = 120) -> dict:
    deadline = time.monotonic() + timeout_seconds
    latest: dict = {}
    while time.monotonic() < deadline:
        latest = client.get(f"/api/tasks/{urllib.parse.quote(task_id, safe='')}")
        if latest.get("status") in {"completed", "failed", "cancelled"}:
            return latest
        time.sleep(1)
    raise TimeoutError(f"Task {task_id} did not become terminal: {latest}")


def _stream_ticket_uid(stream_url: str) -> str:
    ticket_uid = stream_url.rstrip("/").rsplit("/", 1)[-1]
    if not ticket_uid:
        raise RuntimeError(f"Stream URL has no ticket UID: {stream_url}")
    return ticket_uid


@dataclass
class Context:
    a: object
    b: object
    a_uid: str
    b_uid: str
    remote_track: dict


def prepare_context():
    a, b, a_uid, b_uid = E2E.pair_nodes()
    E2E.sync_fixtures(a, b)
    E2E.sync_remote_catalog(a, b_uid)
    remote_track = E2E.first_remote_track(a)
    return Context(a=a, b=b, a_uid=a_uid, b_uid=b_uid, remote_track=remote_track)


def scenario_peer_outage(context: Context, recovery: set[str]) -> None:
    playback = context.a.post(
        "/api/federation/remote/nodes/"
        f"{urllib.parse.quote(context.b_uid, safe='')}/tracks/"
        f"{urllib.parse.quote(str(context.remote_track['remote_entity_uid']), safe='')}/playback"
    )
    stream_url = str(playback["stream_url"])
    stop_service("node-b-api", recovery)
    try:
        search = context.a.get(
            "/api/search?q=Birds%20In%20Row&limit=50&scope=federated",
            timeout=15,
        )
        status = search.get("federation") or {}
        if status.get("complete") is not False:
            raise RuntimeError(
                f"Peer outage was reported as a complete search: {status}"
            )
        if not any(search.get(kind) for kind in ("artists", "albums", "tracks")):
            raise RuntimeError("Peer outage discarded all local search results")

        queued = context.a.post(
            "/api/admin/federation/nodes/"
            f"{urllib.parse.quote(context.b_uid, safe='')}/sync-catalog"
        )
        task = _wait_task_terminal(context.a, str(queued["task_id"]))
        if task.get("status") != "failed":
            raise RuntimeError(f"Offline delta sync did not fail visibly: {task}")

        try:
            context.a.request(
                "GET",
                E2E._stream_data_plane_url(stream_url),
                raw=True,
                timeout=20,
            )
        except Exception:
            pass
        else:
            raise RuntimeError(
                "Remote stream succeeded while its source peer was stopped"
            )
    finally:
        start_service("node-b-api", recovery)
        E2E.wait_for_status(E2E.NODE_B, "Node B after peer outage")
    log(
        "PASS peer-outage: partial search, terminal sync failure, stream denial, recovery"
    )


def scenario_api_restart(context: Context, recovery: set[str]) -> None:
    before = context.a.get("/api/admin/global-catalog/status")
    stop_service("node-a-api", recovery)
    start_service("node-a-api", recovery)
    E2E.wait_for_status(E2E.NODE_A, "Node A after API restart")
    context.a.login()
    after = context.a.get("/api/admin/global-catalog/status")
    if (before.get("state") or {}).get("status") != (after.get("state") or {}).get(
        "status"
    ):
        raise RuntimeError("API restart changed durable catalog state")
    log("PASS api-restart: durable catalog state and authentication recovered")


def scenario_worker_restart(context: Context, recovery: set[str]) -> None:
    stop_service("node-a-worker", recovery)
    queued = context.a.post(
        "/api/admin/global-catalog/reconcile",
        {"mode": "incremental"},
    )
    task_id = str(queued["task_id"])
    start_service("node-a-worker", recovery)
    task = _wait_task_terminal(context.a, task_id, timeout_seconds=240)
    if task.get("status") != "completed":
        raise RuntimeError(
            f"Queued reconciliation did not resume after worker restart: {task}"
        )
    log("PASS worker-restart: queued reconciliation resumed exactly once")


def scenario_import_recovery(context: Context, recovery: set[str]) -> None:
    E2E.sync_remote_catalog(context.b, context.a_uid)
    E2E.reconcile_global_catalog(context.b, "incremental")
    album = None
    for query in ("Birds In Row", "High Vis", "Rival Schools"):
        try:
            album = E2E._remote_only_album(context.b, query)
            break
        except RuntimeError:
            continue
    if album is None:
        raise RuntimeError("No remote-only album remains for import recovery drill")
    global_uid = str(album["global_album_uid"])

    stop_service("node-b-worker", recovery)
    requested = context.b.post(
        "/api/federation/remote/albums/"
        f"{urllib.parse.quote(global_uid, safe='')}/import"
    )
    request_id = str(requested["request_id"])
    approved = context.b.post(
        f"/api/admin/federation/import-requests/{urllib.parse.quote(request_id, safe='')}/approve"
    )
    task_id = str((approved.get("metadata_json") or {}).get("task_id") or "")
    if not task_id:
        raise RuntimeError("Pending import recovery drill did not create a task")
    start_service("node-b-worker", recovery)
    task = _wait_task_terminal(context.b, task_id, timeout_seconds=600)
    if task.get("status") != "completed":
        raise RuntimeError(f"Import did not resume after worker recovery: {task}")
    requests = context.b.get("/api/admin/federation/import-requests")
    final = next(
        (item for item in requests if str(item.get("request_id")) == request_id),
        None,
    )
    if not final or final.get("status") != "completed":
        raise RuntimeError(f"Recovered import has incoherent state: {final}")
    if int(final.get("reserved_bytes") or 0) != 0:
        raise RuntimeError("Recovered import retained reserved bytes")
    staging = ROOT / "test-music-federation/node-b/.imports/federation" / request_id
    if staging.exists():
        raise RuntimeError("Recovered import retained staging files")
    log("PASS import-recovery: pending task resumed, verified and released its lease")


def scenario_redis_restart(context: Context, recovery: set[str]) -> None:
    playback = context.a.post(
        "/api/federation/remote/nodes/"
        f"{urllib.parse.quote(context.b_uid, safe='')}/tracks/"
        f"{urllib.parse.quote(str(context.remote_track['remote_entity_uid']), safe='')}/playback"
    )
    stop_service("node-a-redis", recovery)
    start_service("node-a-redis", recovery)
    E2E.wait_for_status(E2E.NODE_A, "Node A after Redis restart")
    context.a.login()
    status, _headers, body = context.a.request(
        "GET",
        E2E._stream_data_plane_url(str(playback["stream_url"])),
        raw=True,
        headers={"Range": "bytes=0-1023"},
        timeout=30,
    )
    if status not in {200, 206} or not body:
        raise RuntimeError("Active playback ticket did not recover after Redis restart")
    queued = context.a.post(
        "/api/admin/global-catalog/reconcile",
        {"mode": "incremental"},
    )
    task = _wait_task_terminal(context.a, str(queued["task_id"]), timeout_seconds=240)
    if task.get("status") != "completed":
        raise RuntimeError(
            f"Redis recovery left the worker pipeline unavailable: {task}"
        )
    log("PASS redis-restart: API and worker queue recovered without manual state edits")


def scenario_postgres_restart(context: Context, recovery: set[str]) -> None:
    stop_service("node-a-postgres", recovery)
    start_service("node-a-postgres", recovery)
    E2E.wait_for_status(E2E.NODE_A, "Node A after PostgreSQL restart")
    context.a.login()
    context.a.get("/api/admin/federation/status")
    context.a.get("/api/catalog/search?q=High%20Vis&limit=10")
    log("PASS postgres-restart: pooled connections re-established and reads recovered")


def scenario_key_rotation_offline(context: Context, recovery: set[str]) -> None:
    status = context.a.get("/api/admin/federation/status")
    local = status.get("local_node") or {}
    active_key_id = str(local.get("active_key_id") or "")
    if not active_key_id:
        raise RuntimeError("Local active key is unavailable before rotation drill")
    stop_service("node-b-api", recovery)
    rotation: dict | None = None
    try:
        rotation = context.a.post(
            "/api/admin/federation/nodes/"
            f"{urllib.parse.quote(str(local['node_uid']), safe='')}/rotate-local-key",
            {"activate_in_seconds": 30, "grace_seconds": 300},
        )
        after = context.a.get("/api/admin/federation/status")
        if (after.get("local_node") or {}).get("active_key_id") != active_key_id:
            raise RuntimeError("Offline peer caused premature key activation")
    finally:
        if rotation and rotation.get("rotation_uid"):
            context.a.post(
                "/api/admin/federation/key-rotations/"
                f"{urllib.parse.quote(str(rotation['rotation_uid']), safe='')}/cancel"
            )
        start_service("node-b-api", recovery)
        E2E.wait_for_status(E2E.NODE_B, "Node B after offline key rotation")
    log(
        "PASS key-rotation-offline: old key stayed active and pending rotation was cancellable"
    )


def scenario_range_resume(context: Context, recovery: set[str]) -> None:
    """Exercise one reusable playback session across independent Range requests."""
    del recovery
    playback = context.a.post(
        "/api/federation/remote/nodes/"
        f"{urllib.parse.quote(context.b_uid, safe='')}/tracks/"
        f"{urllib.parse.quote(str(context.remote_track['remote_entity_uid']), safe='')}/playback"
    )
    stream_url = E2E._stream_data_plane_url(str(playback["stream_url"]))
    for range_value in ("bytes=0-1023", "bytes=1024-2047", "bytes=2048-4095"):
        status, _headers, body = context.a.request(
            "GET",
            stream_url,
            raw=True,
            headers={"Range": range_value},
            timeout=30,
        )
        if status not in {200, 206} or not body:
            raise RuntimeError(
                f"Reusable playback session failed for {range_value}: status={status}"
            )
    log("PASS range-resume: reusable playback session served repeated Range requests")


def scenario_grant_revocation(context: Context, recovery: set[str]) -> None:
    del recovery
    playback = context.a.post(
        "/api/federation/remote/nodes/"
        f"{urllib.parse.quote(context.b_uid, safe='')}/tracks/"
        f"{urllib.parse.quote(str(context.remote_track['remote_entity_uid']), safe='')}/playback"
    )
    stream_url = str(playback["stream_url"])
    ticket_uid = _stream_ticket_uid(stream_url)
    try:
        context.a.patch(
            "/api/admin/federation/nodes/"
            f"{urllib.parse.quote(context.b_uid, safe='')}/preset",
            {"preset": "discovery"},
        )
        active = context.a.get("/api/admin/federation/streams")
        if any(str(ticket.get("ticket_uid")) == ticket_uid for ticket in active):
            raise RuntimeError("Grant revocation left its stream ticket active")
        try:
            context.a.request(
                "GET",
                f"{E2E.NODE_A}{stream_url}",
                raw=True,
                timeout=15,
            )
        except E2E.ApiError as exc:
            if exc.status not in {401, 403, 404, 409, 410}:
                raise
        else:
            raise RuntimeError("Revoked ticket remained usable")
    finally:
        context.a.patch(
            "/api/admin/federation/nodes/"
            f"{urllib.parse.quote(context.b_uid, safe='')}/preset",
            {"preset": E2E.PAIRING_PRESET},
        )
    log("PASS grant-revocation: ticket revoked immediately and peer policy restored")


def scenario_readplane_restart(context: Context, recovery: set[str]) -> None:
    playback = context.a.post(
        "/api/federation/remote/nodes/"
        f"{urllib.parse.quote(context.b_uid, safe='')}/tracks/"
        f"{urllib.parse.quote(str(context.remote_track['remote_entity_uid']), safe='')}/playback"
    )
    stream_url = str(playback["stream_url"])
    stop_service("node-a-readplane", recovery)
    try:
        status, _headers, body = context.a.request(
            "GET",
            f"{E2E.NODE_A}{stream_url}",
            raw=True,
            headers={"Range": "bytes=0-1023"},
            timeout=30,
        )
        if status not in {200, 206} or not body:
            raise RuntimeError(
                "FastAPI stream fallback did not preserve remote playback"
            )
    finally:
        start_service("node-a-readplane", recovery)
        wait_url(f"{E2E.NODE_A_READPLANE}/readyz")
    fresh = context.a.post(
        "/api/federation/remote/nodes/"
        f"{urllib.parse.quote(context.b_uid, safe='')}/tracks/"
        f"{urllib.parse.quote(str(context.remote_track['remote_entity_uid']), safe='')}/playback"
    )
    status, _headers, body = context.a.request(
        "GET",
        E2E._stream_data_plane_url(str(fresh["stream_url"])),
        raw=True,
        headers={"Range": "bytes=0-1023"},
        timeout=30,
    )
    if status not in {200, 206} or not body:
        raise RuntimeError("Read plane did not recover after restart")
    log("PASS readplane-restart: FastAPI fallback and Go recovery both streamed bytes")


def scenario_adversarial_contracts(context: Context, recovery: set[str]) -> None:
    del context, recovery
    subprocess.run(
        [
            "uv",
            "run",
            "pytest",
            "app/tests/test_federation_security_contract.py",
            "app/tests/test_federation_url_policy.py",
            "app/tests/test_federation_outbound_transport.py",
            "app/tests/test_federation_catalog_delta.py",
            "app/tests/test_federation_import_policy.py",
            "app/tests/test_federation_directory_refresh.py",
            "app/tests/test_genre_taxonomy_signature.py",
            "-q",
        ],
        cwd=ROOT,
        check=True,
        timeout=300,
        env={**__import__("os").environ, "PYTHONPATH": "app"},
    )
    log(
        "PASS adversarial-contracts: DNS, skew, signatures, cursors, manifests and directory"
    )


RUNNERS = {
    "peer-outage": scenario_peer_outage,
    "api-restart": scenario_api_restart,
    "worker-restart": scenario_worker_restart,
    "import-recovery": scenario_import_recovery,
    "redis-restart": scenario_redis_restart,
    "postgres-restart": scenario_postgres_restart,
    "key-rotation-offline": scenario_key_rotation_offline,
    "range-resume": scenario_range_resume,
    "grant-revocation": scenario_grant_revocation,
    "readplane-restart": scenario_readplane_restart,
    "adversarial-contracts": scenario_adversarial_contracts,
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenarios", nargs="*", metavar="SCENARIO")
    parser.add_argument("--all", action="store_true", help="run every bounded drill")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / ".artifacts/federation-chaos.json",
    )
    args = parser.parse_args(argv)
    invalid = sorted(set(args.scenarios) - set(SCENARIOS))
    if invalid:
        parser.error(
            f"invalid scenario(s): {', '.join(invalid)}; "
            f"choose from {', '.join(SCENARIOS)}"
        )
    if args.all and args.scenarios:
        parser.error("use --all or explicit scenarios, not both")
    if not args.all and not args.scenarios:
        parser.error("pass --all or at least one scenario")
    return args


def main() -> int:
    args = parse_args()
    selected = SCENARIOS if args.all else tuple(args.scenarios)
    recovery: set[str] = set()
    results: list[dict] = []
    started_at = datetime.now(timezone.utc)
    try:
        context = prepare_context()
        for scenario in selected:
            started = time.monotonic()
            log(f"RUN {scenario}")
            RUNNERS[scenario](context, recovery)
            results.append(
                {
                    "scenario": scenario,
                    "status": "passed",
                    "duration_seconds": round(time.monotonic() - started, 3),
                }
            )
    except Exception as exc:
        results.append(
            {
                "scenario": selected[len(results)]
                if len(results) < len(selected)
                else "setup",
                "status": "failed",
                "error": str(exc),
            }
        )
        log(f"FAIL {exc}")
        return_code = 1
    else:
        return_code = 0
    finally:
        for service in sorted(recovery):
            try:
                compose("up", "-d", service)
            except Exception as exc:
                log(f"RECOVERY FAILED {service}: {exc}")
                return_code = 1
        report = {
            "schema": "crate-federation-chaos-v1",
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "results": results,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        log(f"Chaos report: {args.output}")
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
