"""Docker container management via Unix socket API."""

import json
import logging
import socket
from urllib.parse import quote

log = logging.getLogger(__name__)

DOCKER_SOCKET = "/var/run/docker.sock"


class DockerUnavailableError(RuntimeError):
    """The Docker API could not be reached or returned an unreadable response."""


def _call(
    method: str, path: str, body: bytes | None = None
) -> tuple[int, dict | list | None]:
    """Send one request and return its HTTP status with the decoded JSON body."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(30)
        sock.connect(DOCKER_SOCKET)

        headers = f"{method} {path} HTTP/1.1\r\nHost: localhost\r\n"
        if body:
            headers += (
                f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n"
            )
        headers += "Connection: close\r\n\r\n"

        sock.sendall(headers.encode())
        if body:
            sock.sendall(body)

        response = b""
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            response += chunk
        sock.close()
    except OSError as error:
        raise DockerUnavailableError(f"{method} {path}: {error}") from error

    head, separator, body_data = response.partition(b"\r\n\r\n")
    try:
        status = int(head.split(b"\r\n", 1)[0].split()[1])
    except (IndexError, ValueError) as error:
        raise DockerUnavailableError(f"{method} {path}: malformed response") from error
    if "Transfer-Encoding: chunked" in head.decode(errors="replace"):
        body_data = _decode_chunked(body_data)
    if not separator or not body_data.strip():
        return status, None
    try:
        return status, json.loads(body_data)
    except ValueError as error:
        raise DockerUnavailableError(f"{method} {path}: unreadable body") from error


def _request(method: str, path: str, body: bytes | None = None) -> dict | list | None:
    """Legacy helper: the decoded body, or None for empty bodies and failures."""
    try:
        return _call(method, path, body)[1]
    except DockerUnavailableError as error:
        log.warning("Docker API request failed: %s", error)
        return None


def _decode_chunked(data: bytes) -> bytes:
    """Decode chunked transfer encoding."""
    result = b""
    while data:
        line_end = data.find(b"\r\n")
        if line_end < 0:
            break
        size_str = data[:line_end].decode().strip()
        if not size_str:
            data = data[line_end + 2 :]
            continue
        try:
            chunk_size = int(size_str, 16)
        except ValueError:
            break
        if chunk_size == 0:
            break
        start = line_end + 2
        result += data[start : start + chunk_size]
        data = data[start + chunk_size + 2 :]
    return result


def is_available() -> bool:
    """Check if Docker socket is accessible."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2)
        sock.connect(DOCKER_SOCKET)
        sock.close()
        return True
    except Exception:
        return False


def _detect_project_name() -> str:
    """Detect the compose project name from this container's own labels."""
    data = _request(
        "GET",
        "/containers/json?filters=%7B%22label%22%3A%5B%22com.docker.compose.service%22%5D%7D",
    )
    if isinstance(data, list):
        import os

        hostname = os.environ.get("HOSTNAME", "")
        for c in data:
            cid = c.get("Id", "")
            if hostname and cid.startswith(hostname):
                labels = c.get("Labels", {})
                return labels.get("com.docker.compose.project", "")
    return ""


def application_project() -> str:
    """The Compose project of this deployment, detected first, then configured."""
    import os

    return (
        _detect_project_name()
        or os.environ.get("CRATE_COMPOSE_PROJECT", "").strip()
        or "crate"
    )


def _health(status_text: str) -> str:
    if "(healthy)" in status_text:
        return "healthy"
    if "(unhealthy)" in status_text:
        return "unhealthy"
    if "(health: starting)" in status_text:
        return "starting"
    return "none"


def list_compose_containers(projects: list[str]) -> list[dict]:
    """Every container of the given Compose projects. Failures raise, never empty."""
    label_filter = quote(json.dumps({"label": ["com.docker.compose.project"]}), safe="")
    status, data = _call("GET", f"/containers/json?all=true&filters={label_filter}")
    if status != 200 or not isinstance(data, list):
        raise DockerUnavailableError("Docker could not list containers")
    wanted = set(projects)
    containers = []
    for item in data:
        labels = item.get("Labels") or {}
        project = labels.get("com.docker.compose.project", "")
        if project not in wanted:
            continue
        status_text = item.get("Status", "")
        containers.append(
            {
                "id": item.get("Id", ""),
                "name": (item.get("Names") or ["/unknown"])[0].lstrip("/"),
                "image": item.get("Image", ""),
                "state": item.get("State", "unknown"),
                "status": status_text,
                "health": _health(status_text),
                "project": project,
                "service": labels.get("com.docker.compose.service", ""),
            }
        )
    containers.sort(key=lambda container: (container["project"], container["name"]))
    return containers


def list_containers(all_containers: bool = False) -> list[dict]:
    """List Docker containers from the same compose project."""
    project = _detect_project_name()
    if project:
        label_filter = quote(
            json.dumps({"label": [f"com.docker.compose.project={project}"]}), safe=""
        )
        path = (
            f"/containers/json?all=true&filters={label_filter}"
            if all_containers
            else f"/containers/json?filters={label_filter}"
        )
    else:
        path = "/containers/json?all=true" if all_containers else "/containers/json"
    data = _request("GET", path)
    if not isinstance(data, list):
        return []

    containers = []
    for c in data:
        name = (c.get("Names") or ["/unknown"])[0].lstrip("/")
        image = c.get("Image", "")
        state = c.get("State", "unknown")
        status = c.get("Status", "")
        created = c.get("Created", 0)

        # Extract ports
        ports = []
        for p in c.get("Ports") or []:
            if p.get("PublicPort"):
                ports.append(f"{p['PublicPort']}:{p['PrivatePort']}")

        containers.append(
            {
                "id": c.get("Id", "")[:12],
                "name": name,
                "image": image,
                "state": state,
                "status": status,
                "created": created,
                "ports": ports,
            }
        )

    containers.sort(key=lambda x: x["name"])
    return containers


def get_container(name: str) -> dict | None:
    """Get detailed info for a container by name."""
    data = _request("GET", f"/containers/{quote(name, safe='')}/json")
    if not isinstance(data, dict):
        return None

    state = data.get("State", {})
    config = data.get("Config", {})
    host_config = data.get("HostConfig", {})

    return {
        "id": data.get("Id", "")[:12],
        "name": data.get("Name", "").lstrip("/"),
        "image": config.get("Image", ""),
        "state": state.get("Status", "unknown"),
        "running": state.get("Running", False),
        "started_at": state.get("StartedAt", ""),
        "finished_at": state.get("FinishedAt", ""),
        "restart_count": data.get("RestartCount", 0),
        "env": [
            e.split("=", 1)[0] for e in config.get("Env", [])
        ],  # keys only, no values
        "mounts": [m.get("Destination", "") for m in data.get("Mounts", [])],
        "memory_limit": host_config.get("Memory", 0),
    }


_ACTION_PATHS = {
    "restart": "restart?t=10",
    "stop": "stop?t=10",
    "start": "start",
}


def container_action(name: str, action: str) -> str:
    """Run one action: done, unchanged, not_found or failed. Transport errors raise."""
    status, _body = _call(
        "POST", f"/containers/{quote(name, safe='')}/{_ACTION_PATHS[action]}"
    )
    if status == 204:
        return "done"
    if status == 304:
        return "unchanged"
    if status == 404:
        return "not_found"
    return "failed"


def _legacy_action(name: str, action: str) -> bool:
    try:
        return container_action(name, action) in {"done", "unchanged"}
    except DockerUnavailableError as error:
        log.warning("Docker %s failed for %s: %s", action, name, error)
        return False


def restart_container(name: str) -> bool:
    """Restart a container by name."""
    return _legacy_action(name, "restart")


def stop_container(name: str) -> bool:
    """Stop a container by name."""
    return _legacy_action(name, "stop")


def start_container(name: str) -> bool:
    """Start a stopped container by name."""
    return _legacy_action(name, "start")


def container_project(name: str) -> str | None:
    """Compose project label of one container, None when it does not exist."""
    status, data = _call("GET", f"/containers/{quote(name, safe='')}/json")
    if status == 404:
        return None
    if status != 200 or not isinstance(data, dict):
        raise DockerUnavailableError(f"Cannot inspect {name}")
    return ((data.get("Config") or {}).get("Labels") or {}).get(
        "com.docker.compose.project"
    )


def get_container_logs(name: str, tail: int = 50) -> str:
    """Get recent logs from a container."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(10)
        sock.connect(DOCKER_SOCKET)

        path = f"/containers/{quote(name, safe='')}/logs?stdout=true&stderr=true&tail={tail}"
        request = f"GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        sock.sendall(request.encode())

        response = b""
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            response += chunk
        sock.close()

        parts = response.split(b"\r\n\r\n", 1)
        if len(parts) < 2:
            return ""

        raw = parts[1]

        # Decode chunked transfer encoding first
        header_str = parts[0].decode()
        if "chunked" in header_str.lower():
            raw = _decode_chunked(raw)

        # Docker multiplexed stream: 8-byte header per frame
        # byte 0: stream type (1=stdout, 2=stderr)
        # bytes 4-7: frame size (big endian)
        lines = []
        i = 0
        while i + 8 <= len(raw):
            size = int.from_bytes(raw[i + 4 : i + 8], "big")
            if size == 0 or i + 8 + size > len(raw):
                break
            line = raw[i + 8 : i + 8 + size]
            lines.append(line.decode("utf-8", errors="replace").rstrip())
            i += 8 + size

        return "\n".join(lines)
    except Exception as e:
        log.warning("Failed to get logs for %s: %s", name, e)
        return ""


def check_image_updates(image: str) -> dict | None:
    """Check if a newer version of an image is available on the registry.
    Returns {current_id, update_available} or None on error."""
    # Get local image ID
    local = _request("GET", f"/images/{quote(image, safe='')}/json")
    if not isinstance(local, dict):
        return None

    local_id = local.get("Id", "")[:12]
    repo_digests = local.get("RepoDigests", [])

    return {
        "image": image,
        "local_id": local_id,
        "repo_digests": repo_digests,
    }
