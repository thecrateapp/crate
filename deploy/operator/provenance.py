"""Container release provenance publisher for Crate Operator.

Observes the images of the running Compose fleet through a Docker API filter that
only allows container listing and image inspection, and publishes bounded identity
evidence that crate-api and the workers read before every mutation boundary.

Release mode: a deployment marker exists in the host context (``make deploy``).
Every manifest service must run that manifest entry's exact digest and source SHA.

Image mode: no deployment marker (a new instance). Every running fleet image must
carry a digest that exists in its official ``ghcr.io/thecrateapp`` repository,
checked against the registry, and the identity is anchored on this publisher's own
official image and the release context baked into it.
"""

import argparse
import hashlib
import http.client
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from scripts.release_manifest import IMAGE_SPECS, validate_manifest

REGISTRY = "ghcr.io"
OWNER = "thecrateapp"
PUBLISHER = "crate-provenance"
CONTEXT = Path("/opt/crate-context")
BAKED_CONTEXT = Path("/opt/crate-hermes-context/active")
OUTPUT = Path("/opt/crate-provenance")
INTERVAL = 30
FRESHNESS = 90
SHA = re.compile(r"[a-f0-9]{40}")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}")
REPO_DIGEST = re.compile(r"[A-Za-z0-9./:_-]{1,240}@sha256:[a-f0-9]{64}")
REVISION = "org.opencontainers.image.revision"
# Services that prepare or execute operator mutations; they must be running.
EXECUTORS = (
    "crate-api",
    "crate-worker",
    "crate-fast-worker",
    "crate-maintenance-worker",
    "crate-analysis-worker",
)
FLEET = {
    service: spec.repository
    for spec in IMAGE_SPECS.values()
    for service in spec.services
} | {"crate-fast-worker": IMAGE_SPECS["worker"].repository}


class Unverified(ValueError):
    pass


def atomic(path, value):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as output:
        json.dump(value, output, sort_keys=True)
        os.fchmod(output.fileno(), 0o644)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


class DockerAPI:
    """Read-only client for the filtered Docker API (list containers, inspect images)."""

    def __init__(self, url):
        match = re.fullmatch(r"http://([a-z0-9.-]+):([0-9]{1,5})", url)
        if not match:
            raise ValueError("CRATE_DOCKER_API must be http://<host>:<port>")
        self.host, self.port = match.group(1), int(match.group(2))

    def get(self, path, limit=4 * 1024 * 1024):
        connection = http.client.HTTPConnection(self.host, self.port, timeout=10)
        try:
            connection.request("GET", path)
            response = connection.getresponse()
            body = response.read(limit + 1)
        except (OSError, http.client.HTTPException):
            raise Unverified("docker_unavailable") from None
        finally:
            connection.close()
        if response.status != 200 or len(body) > limit:
            raise Unverified("docker_unavailable")
        return json.loads(body)


class Registry:
    """Proves a digest exists in an official GHCR repository; positive results are cached."""

    def __init__(self, opener=urllib.request.urlopen):
        self.opener, self.known = opener, set()

    def has(self, repository, digest):
        if (repository, digest) in self.known:
            return True
        scope = f"repository:{OWNER}/{repository}:pull"
        try:
            with self.opener(
                f"https://{REGISTRY}/token?scope={scope}&service={REGISTRY}",
                timeout=10,
            ) as response:
                token = json.loads(response.read(65536))["token"]
            request = urllib.request.Request(
                f"https://{REGISTRY}/v2/{OWNER}/{repository}/manifests/{digest}",
                method="HEAD",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": ", ".join(
                        (
                            "application/vnd.oci.image.index.v1+json",
                            "application/vnd.oci.image.manifest.v1+json",
                            "application/vnd.docker.distribution.manifest.list.v2+json",
                            "application/vnd.docker.distribution.manifest.v2+json",
                        )
                    ),
                },
            )
            with self.opener(request, timeout=10) as response:
                found = (
                    response.status == 200
                    and response.headers.get("Docker-Content-Digest") == digest
                )
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return False
            raise Unverified("registry_unavailable") from None
        except (OSError, ValueError, KeyError):
            raise Unverified("registry_unavailable") from None
        if found and len(self.known) < 512:
            self.known.add((repository, digest))
        return found


def running_fleet(docker, hostname):
    """Image ID per running service of this publisher's own Compose project."""
    containers = docker.get("/containers/json")
    if not isinstance(containers, list) or len(containers) > 512:
        raise Unverified("docker_unavailable")
    own = [c for c in containers if str(c.get("Id", "")).startswith(hostname)]
    if len(own) != 1 or not hostname:
        raise Unverified("publisher_not_found")
    labels = own[0].get("Labels") or {}
    if labels.get("com.docker.compose.service") != PUBLISHER:
        raise Unverified("publisher_not_found")
    project = labels.get("com.docker.compose.project")
    services = {}
    for container in containers:
        labels = container.get("Labels") or {}
        if (
            labels.get("com.docker.compose.project") != project
            or container.get("State") != "running"
        ):
            continue
        service = labels.get("com.docker.compose.service")
        image = container.get("ImageID")
        if not isinstance(image, str) or not IMAGE_ID.fullmatch(image):
            raise Unverified("docker_unavailable")
        if services.setdefault(service, image) != image:
            raise Unverified(f"ambiguous_service:{service}")
    return services


def image_evidence(docker, image_id, repository, expected, registry, service):
    image = docker.get(f"/images/{image_id}/json", limit=1024 * 1024)
    if not isinstance(image, dict) or image.get("Id") != image_id:
        raise Unverified(f"image_changed:{service}")
    refs = image.get("RepoDigests") or []
    if (
        not isinstance(refs, list)
        or len(refs) > 32
        or any(not isinstance(r, str) or not REPO_DIGEST.fullmatch(r) for r in refs)
    ):
        raise Unverified(f"unofficial_image:{service}")
    source = ((image.get("Config") or {}).get("Labels") or {}).get(REVISION)
    if not isinstance(source, str) or not SHA.fullmatch(source):
        raise Unverified(f"unofficial_image:{service}")
    if expected is not None:
        reference = expected["repository"] + "@" + expected["digest"]
        if reference not in refs or source != expected["source_sha"]:
            raise Unverified(f"release_mismatch:{service}")
    else:
        prefix = f"{REGISTRY}/{OWNER}/{repository}@"
        candidates = [r for r in refs if r.startswith(prefix)]
        reference = next(
            (r for r in candidates if registry.has(repository, r[len(prefix) :])),
            None,
        )
        if reference is None:
            raise Unverified(f"unofficial_image:{service}")
    return {"reference": reference, "source_sha": source, "image_id": image_id}


def _release(context_root):
    """Exact expected entries from a verified make deploy, or None for image mode."""
    try:
        marker_raw = (context_root / "deployment.json").read_bytes()
    except FileNotFoundError:
        return None
    marker = json.loads(marker_raw)
    if marker.get("state") != "verified":
        raise Unverified("deployment_not_verified")
    validate_manifest(
        marker,
        expected_release_sha=marker.get("release_sha"),
        registry=REGISTRY,
        owner=OWNER,
    )
    raw = (context_root / "active/context-manifest.json").read_bytes()
    context = json.loads(raw)
    if (
        context["release_sha"] != marker["release_sha"]
        or context["deployment"]["images"] != marker["images"]
    ):
        raise Unverified("context_mismatch")
    return marker_raw, marker, raw


def publish(
    docker,
    output,
    *,
    instance_id,
    hostname,
    registry,
    context_root=CONTEXT,
    baked_context=BAKED_CONTEXT,
    now=None,
):
    output.mkdir(parents=True, exist_ok=True)
    observed = time.time() if now is None else now
    try:
        if (context_root / "deployment.json").exists():
            for name in ("deployment.json", "context.json"):
                (output / name).unlink(missing_ok=True)
        release = _release(context_root)
        fleet = running_fleet(docker, hostname)
        if release is not None:
            marker_raw, manifest, raw = release
            expected = {
                service: entry
                for name, entry in manifest["images"].items()
                for service in (
                    set(entry["services"])
                    | ({"crate-fast-worker"} if name == "worker" else set())
                )
            }
            own_expected = manifest.get("agent_images", {}).get("agent")
        else:
            expected = {
                service: None for service in fleet if service in FLEET
            } | dict.fromkeys(EXECUTORS)
            own_expected = None
            raw = (baked_context / "context-manifest.json").read_bytes()
        publisher = image_evidence(
            docker, fleet[PUBLISHER], "crate-agent", own_expected, registry, PUBLISHER
        )
        images = {}
        for service in sorted(expected):
            if service not in fleet:
                raise Unverified(f"service_not_running:{service}")
            images[service] = image_evidence(
                docker,
                fleet[service],
                FLEET[service],
                expected[service],
                registry,
                service,
            )
        if release is not None:
            release_sha = manifest["release_sha"]
        else:
            release_sha = publisher["source_sha"]
            if json.loads(raw).get("release_sha") != release_sha:
                raise Unverified("context_mismatch")
        identity = {
            "instance_id": instance_id,
            "release_sha": release_sha,
            "context_sha256": hashlib.sha256(raw).hexdigest(),
            "images": images,
        }
        # Re-read after observing: a concurrent deployment cannot borrow the
        # previous marker. API/workers also read the deploy marker directly.
        if release is not None:
            if (context_root / "deployment.json").read_bytes() != marker_raw or (
                context_root / "active/context-manifest.json"
            ).read_bytes() != raw:
                raise Unverified("deployment_changed")
        else:
            if (context_root / "deployment.json").exists():
                raise Unverified("deployment_changed")
            atomic(
                output / "deployment.json",
                {"release_sha": release_sha, "state": "verified"},
            )
            atomic(
                output / "context.json", {"context_sha256": identity["context_sha256"]}
            )
        atomic(output / "target.json", identity)
        result = {
            "state": "verified",
            "mode": "image" if release is None else "release",
            "observed_at": observed,
            "identity": identity,
        }
    except Unverified as error:
        result = {"state": "unverified", "reason": str(error)}
    except (OSError, ValueError, TypeError, KeyError) as error:
        result = {"state": "unverified", "reason": type(error).__name__}
    if result["state"] != "verified":
        result.update(observed_at=observed, identity=None)
    atomic(output / "observation.json", result)
    return result


def healthy(output=OUTPUT, now=None):
    try:
        observed = json.loads((output / "observation.json").read_bytes())["observed_at"]
        return 0 <= (time.time() if now is None else now) - observed <= FRESHNESS
    except (OSError, ValueError, TypeError, KeyError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    if args.health:
        raise SystemExit(0 if healthy() else 1)
    instance = os.environ.get("CRATE_AGENT_INSTANCE_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", instance):
        raise SystemExit("CRATE_AGENT_INSTANCE_ID is required")
    docker = DockerAPI(os.environ.get("CRATE_DOCKER_API", ""))
    registry, previous = Registry(), None
    while True:
        result = publish(
            docker,
            OUTPUT,
            instance_id=instance,
            hostname=socket.gethostname(),
            registry=registry,
        )
        summary = (result["state"], result.get("reason"), result.get("mode"))
        if summary != previous:
            print(
                json.dumps(dict(zip(("state", "reason", "mode"), summary))), flush=True
            )
            previous = summary
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
