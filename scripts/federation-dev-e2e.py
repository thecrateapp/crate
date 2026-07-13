#!/usr/bin/env python3
"""Federation dev helper for real two-node Listen validation.

Modes:
  pair  - approve A<->B and set trusted_library grants.
  e2e   - pair, sync fixtures, search B from A, and range-probe remote playback.
  global-catalog - validate canonical global catalog search, artwork, and playback.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


NODE_A = "http://localhost:18585"
NODE_B = "http://localhost:28585"
NODE_A_INTERNAL = "http://node-a-api:8585"
NODE_B_INTERNAL = "http://node-b-api:8585"
ADMIN_EMAIL = "admin@cratemusic.app"
ADMIN_PASSWORD = "admin"
PAIRING_PRESET = "trusted_library"
REMOTE_SEARCH_QUERIES = ("Rival Schools", "High Vis", "Guided Tour", "Pedals")
LISTEN_A = "http://localhost:15174"


class ApiError(RuntimeError):
    def __init__(self, method: str, url: str, status: int, body: str):
        super().__init__(f"{method} {url} failed with {status}: {body[:500]}")
        self.status = status
        self.body = body


class NodeClient:
    def __init__(self, name: str, base_url: str):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.token = ""

    def login(self) -> None:
        payload = self.request(
            "POST",
            "/api/auth/login",
            {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            auth=False,
        )
        self.token = str(payload["token"])

    def request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        *,
        auth: bool = True,
        headers: dict[str, str] | None = None,
        raw: bool = False,
        timeout: int = 20,
    ):
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        data = None
        request_headers = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        if auth and self.token:
            request_headers["Authorization"] = f"Bearer {self.token}"

        req = urllib.request.Request(
            url,
            data=data,
            headers=request_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if raw:
                    return resp.status, resp.headers, resp.read(2048)
                payload = resp.read().decode("utf-8")
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            raise ApiError(method, url, exc.code, body_text) from exc

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path: str, body: dict | None = None, **kwargs):
        return self.request("POST", path, body, **kwargs)

    def patch(self, path: str, body: dict | None = None, **kwargs):
        return self.request("PATCH", path, body, **kwargs)


def log(message: str) -> None:
    print(message, flush=True)


def public_descriptor(base_url: str) -> dict:
    with urllib.request.urlopen(
        f"{base_url.rstrip('/')}/.well-known/crate-node", timeout=10
    ) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_status(base_url: str, label: str) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/api/status", timeout=5) as resp:
                if resp.status == 200:
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"{label} did not become ready at {base_url}")


def wait_for_listen() -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(LISTEN_A, timeout=5) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                if resp.status == 200 and '<div id="root"' in body:
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"Listen did not become ready at {LISTEN_A}")


def find_peer(client: NodeClient, node_uid: str) -> dict | None:
    status = client.get("/api/admin/federation/status")
    for peer in status.get("peers", []):
        if peer.get("node_uid") == node_uid:
            return peer
    return None


def ensure_pair(
    local: NodeClient,
    remote_label: str,
    remote_public_url: str,
    remote_internal_url: str,
) -> str:
    descriptor = public_descriptor(remote_public_url)
    remote_uid = str(descriptor["node_uid"])
    peer = find_peer(local, remote_uid)

    if not peer or peer.get("trust_state") != "approved":
        log(f"Pairing {local.name} -> {remote_label}...")
        started = local.post(
            "/api/admin/federation/pairing/start",
            {"url": remote_internal_url},
        )
        request_uid = started["pairing"]["request_uid"]
        local.post(f"/api/admin/federation/pairing/{request_uid}/approve")
    else:
        log(f"Pairing {local.name} -> {remote_label} already approved.")

    local.post(
        f"/api/admin/federation/nodes/{urllib.parse.quote(remote_uid, safe='')}/update-base-url",
        {"api_base_url": remote_internal_url},
    )
    local.patch(
        f"/api/admin/federation/nodes/{urllib.parse.quote(remote_uid, safe='')}/preset",
        {"preset": PAIRING_PRESET},
    )
    return remote_uid


def pair_nodes() -> tuple[NodeClient, NodeClient, str, str]:
    wait_for_status(NODE_A, "Node A")
    wait_for_status(NODE_B, "Node B")
    a = NodeClient("Node A", NODE_A)
    b = NodeClient("Node B", NODE_B)
    a.login()
    b.login()
    b_uid = ensure_pair(a, "Node B", NODE_B, NODE_B_INTERNAL)
    a_uid = ensure_pair(b, "Node A", NODE_A, NODE_A_INTERNAL)
    log("Pairing ready: A <-> B with trusted_library preset.")
    return a, b, a_uid, b_uid


def active_sync_task(client: NodeClient) -> str | None:
    for status in ("running", "pending"):
        tasks = client.get(f"/api/tasks?status={status}&limit=20")
        for task in tasks:
            if task.get("type") == "library_sync":
                return str(task["id"])
    return None


def queue_library_sync(client: NodeClient) -> str:
    try:
        queued = client.post("/api/tasks/sync-library")
        task_id = str(queued["task_id"])
        log(f"{client.name}: queued library sync {task_id}")
        return task_id
    except ApiError as exc:
        if exc.status != 409:
            raise
        existing = active_sync_task(client)
        if not existing:
            raise RuntimeError(f"{client.name}: sync reported busy but no task found")
        log(f"{client.name}: waiting existing library sync {existing}")
        return existing


def wait_task(client: NodeClient, task_id: str, timeout_seconds: int = 240) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        task = client.get(f"/api/tasks/{urllib.parse.quote(task_id, safe='')}")
        status = task.get("status")
        if status == "completed":
            log(f"{client.name}: task {task_id} completed")
            return task
        if status in {"failed", "cancelled"}:
            raise RuntimeError(
                f"{client.name}: task {task_id} ended as {status}: {task.get('error')}"
            )
        time.sleep(2)
    raise TimeoutError(f"{client.name}: task {task_id} did not finish in time")


def sync_fixtures(a: NodeClient, b: NodeClient) -> None:
    task_a = queue_library_sync(a)
    task_b = queue_library_sync(b)
    wait_task(a, task_a)
    wait_task(b, task_b)
    index_genres(a)
    index_genres(b)


def index_genres(client: NodeClient) -> None:
    queued = client.post("/api/genres/index")
    task_id = str(queued["task_id"])
    log(f"{client.name}: queued genre indexing {task_id}")
    wait_task(client, task_id, timeout_seconds=360)


def sync_remote_catalog(client: NodeClient, node_uid: str) -> None:
    encoded = urllib.parse.quote(node_uid, safe="")
    queued = client.post(f"/api/admin/federation/nodes/{encoded}/sync-catalog")
    task_id = str(queued["task_id"])
    log(f"{client.name}: queued remote catalog sync {task_id}")
    wait_task(client, task_id)


def first_remote_track(a: NodeClient) -> dict:
    for query in REMOTE_SEARCH_QUERIES:
        encoded = urllib.parse.quote(query)
        result = a.get(f"/api/search?q={encoded}&limit=50&scope=federated")
        tracks = result.get("tracks") or []
        for track in tracks:
            if (
                track.get("origin") == "remote"
                and track.get("node_uid")
                and track.get("remote_entity_uid")
                and (track.get("availability") or {}).get("stream") is not False
            ):
                log(
                    "Remote search OK: "
                    f"{track.get('artist')} - {track.get('title')} ({track.get('node_name')})"
                )
                return track
        log(f"No remote playable track for query '{query}', trying next candidate...")
    raise RuntimeError("No playable remote track found from Node A search")


def resolve_and_probe_playback(a: NodeClient, track: dict) -> None:
    node_uid = urllib.parse.quote(str(track["node_uid"]), safe="")
    remote_entity_uid = urllib.parse.quote(str(track["remote_entity_uid"]), safe="")
    playback = a.post(
        f"/api/federation/remote/nodes/{node_uid}/tracks/{remote_entity_uid}/playback"
    )
    stream_url = str(playback["stream_url"])
    status, headers, body = a.request(
        "GET",
        stream_url,
        auth=True,
        headers={"Range": "bytes=0-1023"},
        raw=True,
        timeout=30,
    )
    if status not in (200, 206):
        raise RuntimeError(f"Unexpected stream status {status}")
    if not body:
        raise RuntimeError("Remote stream returned no bytes")
    log(
        "Remote playback OK: "
        f"status={status} bytes={len(body)} content-type={headers.get('content-type', '')}"
    )


def reconcile_global_catalog(client: NodeClient, mode: str = "full") -> None:
    queued = client.post("/api/admin/global-catalog/reconcile", {"mode": mode})
    task_id = str(queued["task_id"])
    log(f"{client.name}: queued global catalog {mode} reconciliation {task_id}")
    wait_task(client, task_id, timeout_seconds=360)


def first_global_album_and_track(client: NodeClient) -> tuple[dict, dict]:
    for query in REMOTE_SEARCH_QUERIES:
        encoded = urllib.parse.quote(query)
        result = client.get(f"/api/catalog/search?q={encoded}&limit=50")
        albums = result.get("albums") or []
        tracks = result.get("tracks") or []
        album = next((item for item in albums if item.get("global_album_uid")), None)
        track = next((item for item in tracks if item.get("globalTrackUid")), None)
        if album and track:
            log(
                "Global catalog search OK: "
                f"{album.get('artist')} - {album.get('name')}; "
                f"track={track.get('artist')} - {track.get('title')}"
            )
            return album, track
        log(f"No canonical album+track for query '{query}', trying next candidate...")
    raise RuntimeError("No canonical global album+track found from Node A catalog search")


def probe_global_album_cover(client: NodeClient, album: dict) -> None:
    album_uid = urllib.parse.quote(str(album["global_album_uid"]), safe="")
    status, headers, body = client.request(
        "GET",
        f"/api/catalog/albums/{album_uid}/cover?size=256",
        raw=True,
        timeout=30,
    )
    if status != 200:
        raise RuntimeError(f"Unexpected global cover status {status}")
    if not body:
        raise RuntimeError("Global album cover returned no bytes")
    log(
        "Global album cover OK: "
        f"bytes={len(body)} content-type={headers.get('content-type', '')}"
    )


def resolve_and_probe_global_playback(client: NodeClient, track: dict) -> None:
    track_uid = track.get("globalTrackUid") or track.get("global_track_uid")
    if not track_uid:
        raise RuntimeError("Global track has no globalTrackUid")
    encoded = urllib.parse.quote(str(track_uid), safe="")
    playback = client.get(f"/api/catalog/tracks/{encoded}/playback")
    stream_url = str(playback["stream_url"])
    status, headers, body = client.request(
        "GET",
        stream_url,
        auth=True,
        headers={"Range": "bytes=0-1023"},
        raw=True,
        timeout=30,
    )
    if status not in (200, 206):
        raise RuntimeError(f"Unexpected global stream status {status}")
    if not body:
        raise RuntimeError("Global stream returned no bytes")
    log(
        "Global playback OK: "
        f"status={status} bytes={len(body)} content-type={headers.get('content-type', '')}"
    )


def run_e2e() -> None:
    a, b, _a_uid, b_uid = pair_nodes()
    sync_fixtures(a, b)
    sync_remote_catalog(a, b_uid)
    track = first_remote_track(a)
    resolve_and_probe_playback(a, track)
    log("Federation E2E complete.")


def run_global_catalog_e2e() -> None:
    wait_for_listen()
    a, b, _a_uid, b_uid = pair_nodes()
    sync_fixtures(a, b)
    sync_remote_catalog(a, b_uid)
    reconcile_global_catalog(a, "full")
    album, track = first_global_album_and_track(a)
    probe_global_album_cover(a, album)
    resolve_and_probe_global_playback(a, track)
    log("Federation global catalog E2E complete.")


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "e2e"
    try:
        if mode == "pair":
            pair_nodes()
            return 0
        if mode == "e2e":
            run_e2e()
            return 0
        if mode == "global-catalog":
            run_global_catalog_e2e()
            return 0
        print("Usage: federation-dev-e2e.py [pair|e2e|global-catalog]", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
