#!/usr/bin/env python3
"""Federation dev helper for real two-node Listen validation.

Modes:
  singleton - validate a fresh one-node catalog without contacting a peer.
  zero-downtime - probe catalog reads throughout sync and reconciliation tasks.
  pair  - approve A<->B and set trusted_library grants.
  e2e   - pair, sync fixtures, search B from A, and range-probe remote playback.
  global-catalog - validate canonical global catalog search, artwork, and playback.
  import - import a remote-only album and verify its local lifecycle.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


NODE_A = "http://localhost:18585"
NODE_B = "http://localhost:28585"
NODE_A_INTERNAL = "http://node-a-api:8585"
NODE_B_INTERNAL = "http://node-b-api:8585"
NODE_A_READPLANE = "http://localhost:18686"
ADMIN_EMAIL = "admin@cratemusic.app"
ADMIN_PASSWORD = "admin"
PAIRING_PRESET = "trusted_library"
REMOTE_SEARCH_QUERIES = ("Rival Schools", "High Vis", "Guided Tour", "Pedals")
LISTEN_A = "http://localhost:15174"
SINGLETON_PARITY_PATHS = (
    "/api/me/follows",
    "/api/me/albums",
    "/api/me/likes",
    "/api/me/history?limit=1",
    "/api/genres/sound-intelligence/health",
)


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
        include_headers: bool = False,
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
                decoded = json.loads(payload) if payload else {}
                if include_headers:
                    return decoded, resp.headers
                return decoded
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            raise ApiError(method, url, exc.code, body_text) from exc

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path: str, body: dict | None = None, **kwargs):
        return self.request("POST", path, body, **kwargs)

    def patch(self, path: str, body: dict | None = None, **kwargs):
        return self.request("PATCH", path, body, **kwargs)


def _stream_data_plane_url(stream_url: str) -> str:
    if stream_url.startswith("/api/federation/remote/streams/"):
        return f"{NODE_A_READPLANE}{stream_url}"
    return stream_url


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


def wait_for_catalog_ready(client: NodeClient, timeout_seconds: int = 360) -> dict:
    deadline = time.monotonic() + timeout_seconds
    latest: dict = {}
    while time.monotonic() < deadline:
        latest = client.get("/api/admin/global-catalog/status")
        state = latest.get("state") or {}
        status = state.get("status")
        if status == "ready":
            log(f"{client.name}: global catalog ready")
            return latest
        if status == "failed":
            raise RuntimeError(
                f"{client.name}: global catalog bootstrap failed: "
                f"{state.get('last_error') or 'unknown error'}"
            )
        time.sleep(2)
    state = latest.get("state") or {}
    raise TimeoutError(
        f"{client.name}: catalog remained {state.get('status') or 'unknown'}: "
        f"{state.get('last_error') or 'no error reported'}"
    )


def find_peer(client: NodeClient, node_uid: str) -> dict | None:
    status = client.get("/api/admin/federation/status")
    for peer in status.get("peers", []):
        if peer.get("node_uid") == node_uid:
            return peer
    return None


def ensure_pair(
    local: NodeClient,
    remote: NodeClient,
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
        request_uid = started["pairing"].get("pairing_uid") or started["pairing"].get(
            "request_uid"
        )
        if not request_uid:
            raise RuntimeError("Pairing response omitted its identifier")
        remote.post(f"/api/admin/federation/pairing/{request_uid}/approve")
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
    wait_for_catalog_ready(a)
    wait_for_catalog_ready(b)
    b_uid = ensure_pair(a, b, "Node B", NODE_B, NODE_B_INTERNAL)
    a_uid = ensure_pair(b, a, "Node A", NODE_A, NODE_A_INTERNAL)
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
        _stream_data_plane_url(stream_url),
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


CATALOG_SERVING_MODES = {
    "local-fallback",
    "global-ready",
    "global-refreshing",
    "global-degraded",
}


def probe_catalog_while_task_runs(
    client: NodeClient,
    task_id: str,
    track: dict | None = None,
    timeout_seconds: int = 360,
) -> set[str]:
    deadline = time.monotonic() + timeout_seconds
    modes: set[str] = set()
    probes = 0
    while time.monotonic() < deadline:
        search, headers = client.get(
            "/api/catalog/search?q=High%20Vis&limit=5",
            include_headers=True,
        )
        mode = str(headers.get("X-Crate-Catalog-Mode") or "")
        if mode not in CATALOG_SERVING_MODES:
            raise RuntimeError(
                f"Canonical search returned invalid serving mode {mode!r}"
            )
        if not isinstance(search.get("artists"), list):
            raise RuntimeError("Canonical search returned an invalid payload")
        modes.add(mode)

        for path in (
            "/api/catalog/me/follows",
            "/api/catalog/me/albums/saved",
            "/api/catalog/genres",
        ):
            client.get(path)

        if track is not None:
            track_uid = track.get("globalTrackUid") or track.get("global_track_uid")
            if not track_uid:
                raise RuntimeError("Zero-downtime track omitted its global UID")
            encoded = urllib.parse.quote(str(track_uid), safe="")
            client.get(f"/api/catalog/tracks/{encoded}/info")
            client.get(f"/api/catalog/tracks/{encoded}/playback")

        probes += 1
        task = client.get(f"/api/tasks/{urllib.parse.quote(task_id, safe='')}")
        status = task.get("status")
        if status == "completed":
            log(
                f"{client.name}: zero-downtime probes={probes} "
                f"modes={','.join(sorted(modes))}"
            )
            return modes
        if status in {"failed", "cancelled"}:
            raise RuntimeError(
                f"{client.name}: task {task_id} ended as {status}: {task.get('error')}"
            )
        time.sleep(1)
    raise TimeoutError(f"{client.name}: zero-downtime task {task_id} timed out")


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
    raise RuntimeError(
        "No canonical global album+track found from Node A catalog search"
    )


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


def probe_human_catalog_routes(client: NodeClient, album: dict) -> None:
    artist_slug_value = str(album.get("artist_slug") or "").strip()
    album_slug_value = str(album.get("slug") or "").strip()
    if not artist_slug_value or not album_slug_value:
        raise RuntimeError(f"Canonical album omitted human slugs: {album}")
    artist_slug = urllib.parse.quote(artist_slug_value, safe="")
    album_slug = urllib.parse.quote(album_slug_value, safe="")

    artist_page = client.get(f"/api/artist-slugs/{artist_slug}/page")
    artist = artist_page.get("artist") or {}
    if artist.get("global_artist_uid") != album.get("global_artist_uid"):
        raise RuntimeError("Human artist route resolved a different canonical artist")

    album_page = client.get(f"/api/artist-slugs/{artist_slug}/albums/{album_slug}")
    if album_page.get("global_album_uid") != album.get("global_album_uid"):
        raise RuntimeError("Human album route resolved a different canonical album")
    log(f"Human catalog routes OK: /artists/{artist_slug_value}/{album_slug_value}")


def resolve_and_probe_global_playback(client: NodeClient, track: dict) -> None:
    track_uid = track.get("globalTrackUid") or track.get("global_track_uid")
    if not track_uid:
        raise RuntimeError("Global track has no globalTrackUid")
    encoded = urllib.parse.quote(str(track_uid), safe="")
    playback = client.get(f"/api/catalog/tracks/{encoded}/playback")
    stream_url = str(playback["stream_url"])
    status, headers, body = client.request(
        "GET",
        _stream_data_plane_url(stream_url),
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


def run_singleton_e2e() -> None:
    wait_for_status(NODE_A, "Node A")
    wait_for_listen()
    a = NodeClient("Singleton Node", NODE_A)
    a.login()

    federation_status = a.get("/api/admin/federation/status")
    peers = federation_status.get("peers") or []
    if peers:
        raise RuntimeError(f"Singleton expected zero peers, found {len(peers)}")

    wait_for_catalog_ready(a)
    task_id = queue_library_sync(a)
    wait_task(a, task_id)
    index_genres(a)
    reconcile_global_catalog(a, "full")
    status = wait_for_catalog_ready(a)

    for path in SINGLETON_PARITY_PATHS:
        a.get(path)

    taxonomy = status.get("taxonomy") or {}
    if taxonomy.get("id") != "crate-core" or not taxonomy.get("digest"):
        raise RuntimeError(f"Singleton taxonomy descriptor is invalid: {taxonomy}")

    result = a.get("/api/catalog/search?q=Birds%20In%20Row&limit=50")
    artists = result.get("artists") or []
    albums = result.get("albums") or []
    tracks = result.get("tracks") or []
    if not artists or not albums or not tracks:
        raise RuntimeError("Singleton canonical search did not return local content")

    artist = artists[0]
    album = albums[0]
    track = tracks[0]
    artist_slug = urllib.parse.quote(str(artist.get("slug") or "birds-in-row"))
    album_slug = urllib.parse.quote(str(album.get("slug") or "album"))
    artist_page = a.get(f"/api/artist-slugs/{artist_slug}/page")
    if not (artist_page.get("artist") or {}).get("global_artist_uid"):
        raise RuntimeError("Singleton human artist detail is not canonical")
    if "top_tracks" not in artist_page or "enrichment" not in artist_page:
        raise RuntimeError("Singleton artist detail omitted enrichment contracts")
    album_page = a.get(f"/api/artist-slugs/{artist_slug}/albums/{album_slug}")
    if not album_page.get("global_album_uid"):
        raise RuntimeError("Singleton human album detail is not canonical")

    genres = a.get("/api/catalog/genres")
    if not (genres.get("taxonomy") or {}).get("digest"):
        raise RuntimeError("Singleton canonical genres omitted taxonomy metadata")

    probe_global_album_cover(a, album)
    resolve_and_probe_global_playback(a, track)
    log("Singleton catalog E2E complete with zero federation requests.")


def run_zero_downtime_e2e() -> None:
    wait_for_status(NODE_A, "Node A")
    wait_for_listen()
    client = NodeClient("Singleton Node", NODE_A)
    client.login()

    sync_task = queue_library_sync(client)
    probe_catalog_while_task_runs(client, sync_task)
    index_genres(client)
    reconcile_global_catalog(client, "full")
    _album, track = first_global_album_and_track(client)

    queued = client.post("/api/admin/global-catalog/reconcile", {"mode": "full"})
    task_id = str(queued["task_id"])
    log(f"{client.name}: queued zero-downtime reconciliation {task_id}")
    modes = probe_catalog_while_task_runs(client, task_id, track)
    wait_for_catalog_ready(client)
    if not modes & {"global-ready", "global-refreshing"}:
        raise RuntimeError(f"Refresh did not expose a healthy global mode: {modes}")
    log("Catalog zero-downtime E2E complete.")


def run_global_catalog_e2e() -> None:
    wait_for_listen()
    a, b, _a_uid, b_uid = pair_nodes()
    sync_fixtures(a, b)
    sync_remote_catalog(a, b_uid)
    reconcile_global_catalog(a, "full")
    album, track = first_global_album_and_track(a)
    probe_human_catalog_routes(a, album)
    probe_global_album_cover(a, album)
    resolve_and_probe_global_playback(a, track)
    log("Federation global catalog E2E complete.")


def _remote_only_album(client: NodeClient, query: str) -> dict:
    result = client.get(f"/api/catalog/search?q={urllib.parse.quote(query)}&limit=50")
    for album in result.get("albums") or []:
        global_uid = album.get("global_album_uid")
        if not global_uid:
            continue
        detail = client.get(
            f"/api/catalog/albums/{urllib.parse.quote(str(global_uid), safe='')}"
        )
        availability = detail.get("availability") or {}
        if availability.get("remote") and not availability.get("local"):
            return {**album, **detail}
    raise RuntimeError(f"No remote-only album found for {query!r}")


def _verify_imported_hashes(request: dict) -> None:
    metadata = request.get("metadata_json") or {}
    manifest = metadata.get("manifest") if isinstance(metadata, dict) else None
    tracks = manifest.get("tracks") if isinstance(manifest, dict) else None
    if not tracks:
        raise RuntimeError("Completed import omitted its verified manifest")
    expected = {str(track["sha256"]) for track in tracks}
    actual: set[str] = set()
    root = Path("test-music-federation/node-b")
    for path in root.rglob("*"):
        if not path.is_file() or ".imports" in path.parts:
            continue
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        actual.add(digest.hexdigest())
    missing = expected - actual
    if missing:
        raise RuntimeError(
            f"Imported files failed hash verification: {sorted(missing)}"
        )


def run_import_e2e() -> None:
    a, b, a_uid, _b_uid = pair_nodes()
    sync_fixtures(a, b)
    sync_remote_catalog(b, a_uid)
    reconcile_global_catalog(b, "full")
    before = _remote_only_album(b, "Birds In Row")
    global_uid = str(before["global_album_uid"])
    artist_slug = str(before.get("artist_slug") or "")
    album_slug = str(before.get("slug") or "")
    if not artist_slug or not album_slug:
        raise RuntimeError("Remote album omitted its human route")

    requested = b.post(
        f"/api/federation/remote/albums/{urllib.parse.quote(global_uid, safe='')}/import"
    )
    request_id = str(requested["request_id"])
    approved = b.post(f"/api/admin/federation/import-requests/{request_id}/approve")
    task_id = str((approved.get("metadata_json") or {}).get("task_id") or "")
    if not task_id:
        raise RuntimeError("Approved import did not enqueue a worker task")
    wait_task(b, task_id, timeout_seconds=600)
    reconcile_global_catalog(b, "incremental")

    after = b.get(f"/api/catalog/albums/{urllib.parse.quote(global_uid, safe='')}")
    if not (after.get("availability") or {}).get("local"):
        raise RuntimeError("Imported album did not become a local global source")
    human = b.get(
        "/api/artist-slugs/"
        f"{urllib.parse.quote(artist_slug, safe='')}/albums/"
        f"{urllib.parse.quote(album_slug, safe='')}"
    )
    if str(human.get("global_album_uid")) != global_uid:
        raise RuntimeError("Import changed the album's human URL or global identity")

    requests = b.get("/api/admin/federation/import-requests")
    completed = next(
        (item for item in requests if str(item.get("request_id")) == request_id),
        None,
    )
    if not completed or completed.get("status") != "completed":
        raise RuntimeError(f"Import lifecycle did not complete: {completed}")
    if int(completed.get("reserved_bytes") or 0) != 0:
        raise RuntimeError("Completed import retained its storage reservation")
    if int(completed.get("received_bytes") or 0) != int(
        completed.get("expected_bytes") or -1
    ):
        raise RuntimeError("Completed import byte counters do not match")
    provenance = (completed.get("metadata_json") or {}).get("provenance") or {}
    if not provenance.get("local_album_id"):
        raise RuntimeError("Completed import omitted local provenance")
    _verify_imported_hashes(completed)
    staging = Path("test-music-federation/node-b/.imports/federation") / request_id
    if staging.exists():
        raise RuntimeError("Completed import left staging files behind")

    track = next(iter(after.get("tracks") or []), None)
    if not track:
        raise RuntimeError("Imported album has no locally playable tracks")
    resolve_and_probe_global_playback(b, track)
    log("Federation remote import E2E complete.")


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "e2e"
    try:
        if mode in {"all", "--all"}:
            run_e2e()
            run_global_catalog_e2e()
            run_import_e2e()
            return 0
        if mode == "pair":
            pair_nodes()
            return 0
        if mode == "e2e":
            run_e2e()
            return 0
        if mode == "global-catalog":
            run_global_catalog_e2e()
            return 0
        if mode == "import":
            run_import_e2e()
            return 0
        if mode in {"singleton", "singleton-parity"}:
            run_singleton_e2e()
            return 0
        if mode == "zero-downtime":
            run_zero_downtime_e2e()
            return 0
        print(
            "Usage: federation-dev-e2e.py "
            "[--all|singleton|singleton-parity|zero-downtime|pair|e2e|global-catalog|import]",
            file=sys.stderr,
        )
        return 2
    except Exception as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
