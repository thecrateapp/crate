"""Root host publisher: immutable expected entries versus actual Docker evidence."""

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

from scripts.release_manifest import validate_manifest

from .infra_deploy import _context_root
from .infra_executor import Executor
from .infra_policy import Policy, trusted_file


def atomic(path, value):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as output:
        json.dump(value, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def publish(executor, context_root, public_root, *, now=None):
    public_root.mkdir(parents=True, exist_ok=True)
    observed = time.time() if now is None else now
    try:
        marker = json.loads((context_root / "deployment.json").read_bytes())
        manifest = marker
        validate_manifest(
            manifest,
            expected_release_sha=manifest["release_sha"],
            registry="ghcr.io",
            owner="thecrateapp",
        )
        raw = (context_root / "active/context-manifest.json").read_bytes()
        context = json.loads(raw)
        if (
            marker["state"] != "verified"
            or context["release_sha"] != manifest["release_sha"]
            or context["deployment"]["images"] != manifest["images"]
        ):
            raise ValueError("Deployment/context is not verified")
        images = {}
        for name, entry in manifest["images"].items():
            services = set(entry["services"]) | (
                {"crate-fast-worker"} if name == "worker" else set()
            )
            for service in sorted(services):
                actual = executor.inspect(service, provenance=True)
                evidence = actual["image_provenance"]
                reference = entry["repository"] + "@" + entry["digest"]
                if (
                    evidence["availability"] != "available"
                    or reference not in evidence["repo_digests"]
                    or evidence["source_sha"] != entry["source_sha"]
                ):
                    raise ValueError("Actual immutable image evidence mismatch")
                images[service] = {
                    "reference": reference,
                    "source_sha": entry["source_sha"],
                    "image_id": actual["image"],
                }
        identity = {
            "instance_id": executor.c["instance"],
            "release_sha": manifest["release_sha"],
            "context_sha256": hashlib.sha256(raw).hexdigest(),
            "images": images,
        }
        # Re-read after observations: a concurrent deployment cannot borrow the
        # previous verified marker. Domain callers also read the direct marker.
        if json.loads((context_root / "deployment.json").read_bytes()) != marker:
            raise ValueError("Deployment changed during observation")
        if (context_root / "active/context-manifest.json").read_bytes() != raw:
            raise ValueError("Context changed during observation")
        atomic(public_root / "target.json", identity)
        result = {"state": "verified", "observed_at": observed, "identity": identity}
    except (OSError, ValueError, TypeError, KeyError, PermissionError):
        result = {"state": "unverified", "observed_at": observed, "identity": None}
    atomic(public_root / "observation.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    policy = Policy(args.config)
    context = _context_root(Path(policy.config["server_path"]))
    trusted_file(context)
    executor = Executor(policy, real=True)
    while True:
        policy.load()
        publish(executor, context, context / "public")
        time.sleep(30)


if __name__ == "__main__":
    main()
