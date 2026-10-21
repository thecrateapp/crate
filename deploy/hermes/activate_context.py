"""Validate and atomically activate an operator context after release verification."""

import argparse
import hashlib
import json
import os
import re
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from uuid import uuid4


def record_deployment(root: Path, deployment: dict, state: str) -> None:
    if state not in {"deploying", "verified", "unverified", "rollback"}:
        raise ValueError("Unknown deployment state")
    root.mkdir(parents=True, exist_ok=True)
    marker = root / (".deployment-" + uuid4().hex)
    marker.write_text(json.dumps({**deployment, "state": state}) + "\n")
    os.replace(marker, root / "deployment.json")
    public = root / "public"
    public.mkdir(exist_ok=True)
    marker = public / (".deployment-" + uuid4().hex)
    marker.write_text(
        json.dumps({"release_sha": deployment.get("release_sha"), "state": state})
        + "\n"
    )
    os.replace(marker, public / "deployment.json")


def activate_context(root: Path, archive: Path | None, revision: str) -> None:
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("A full release SHA is required")
    # Keep the public mutation gate closed until both the active link and its
    # exact manifest hash have changed, including same-SHA context replacement.
    record_deployment(root, {"release_sha": revision}, "deploying")
    releases = root / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    target = None
    if archive is not None:
        with tempfile.TemporaryDirectory(
            prefix="candidate-", dir=releases
        ) as directory:
            candidate = Path(directory) / "content"
            candidate.mkdir()
            with tarfile.open(archive, "r:gz") as bundle:
                for member in bundle.getmembers():
                    path = PurePosixPath(member.name)
                    if (
                        path.is_absolute()
                        or ".." in path.parts
                        or not (member.isfile() or member.isdir())
                    ):
                        raise ValueError("Unsafe context archive member")
                bundle.extractall(candidate, filter="data")
            manifest = json.loads((candidate / "context-manifest.json").read_text())
            if (
                manifest["release_sha"] != revision
                or manifest["deployment"]["release_sha"] != revision
            ):
                raise ValueError("Archive belongs to another release")
            bundle_hash = hashlib.sha256(
                json.dumps(manifest, sort_keys=True).encode()
            ).hexdigest()[:16]
            target = releases / (revision + "-" + bundle_hash)
            for path, evidence in manifest["files"].items():
                file = candidate / path
                if (
                    not file.resolve().is_relative_to(candidate.resolve())
                    or file.is_symlink()
                ):
                    raise ValueError("Unsafe context path")
                data = file.read_bytes()
                if (
                    hashlib.sha256(data).hexdigest() != evidence["sha256"]
                    or len(data) != evidence["bytes"]
                ):
                    raise ValueError("Context integrity check failed")
            if target.exists():
                if (
                    json.loads((target / "context-manifest.json").read_text())
                    != manifest
                ):
                    raise ValueError("Existing release context has different content")
            else:
                candidate.rename(target)
    if target is None:
        matches = sorted(
            releases.glob(revision + "*"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        if not matches:
            raise ValueError("No context is cached for this release")
        target = matches[0]
    manifest = json.loads((target / "context-manifest.json").read_text())
    if manifest["release_sha"] != revision:
        raise ValueError("Stored context belongs to another release")
    link = root / (".active-" + uuid4().hex)
    link.symlink_to("releases/" + target.name)
    os.replace(link, root / "active")
    marker = root / "public" / (".context-" + uuid4().hex)
    marker.write_text(
        json.dumps(
            {
                "context_sha256": hashlib.sha256(
                    (target / "context-manifest.json").read_bytes()
                ).hexdigest()
            }
        )
        + "\n"
    )
    os.replace(marker, root / "public/context.json")
    record_deployment(root, manifest["deployment"], "verified")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--record-deployment", type=Path)
    parser.add_argument("--state", default="verified")
    args = parser.parse_args()
    if args.record_deployment:
        record_deployment(
            args.root, json.loads(args.record_deployment.read_text()), args.state
        )
        return
    activate_context(args.root, args.archive, args.revision)
    print(json.dumps({"context_release_sha": args.revision, "activated": True}))


if __name__ == "__main__":
    main()
