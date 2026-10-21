#!/usr/bin/env python3
"""Export an allowlisted, immutable operator context from an exact Git release."""

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path, PurePosixPath

SOURCE_FILES = (
    "AGENTS.md",
    "README.md",
    "docs/manifest.json",
    "docker-compose.yaml",
    "docker-compose.project.yaml",
    "docker-compose.home.yaml",
    "docker-compose.dev.yaml",
    "app/crate/worker.py",
    "app/crate/task_registry.py",
    "app/crate/agent_access.py",
    "app/crate/agent_discovery.py",
    "app/crate/agent_instance_operations.py",
    "app/crate/mcp/tools.py",
    "app/crate/mcp/contract.py",
    "app/crate/mcp/schemas.py",
    "app/crate/mcp/operation_schemas.py",
    "app/crate/agent_diagnostics.py",
    "app/crate/runtime_policy_contract.py",
    "Makefile",
)
SOURCE_ROOTS = (
    "app/crate/",
    "app/readplane/",
    "app/media-worker/src/",
    "app/listen/src/",
    "app/listen/android/app/src/main/java/",
    "app/listen/ios/App/App/",
    "app/ui/src/",
    "app/shared/",
    "app/site/src/",
    "app/docs/src/",
    "app/listen-desktop/src-tauri/src/",
    "app/cast-receiver/src/",
    "tools/crate-cli/src/",
    "tools/vdj-plugin/src/",
    "tools/vdj-plugin/include/",
    "scripts/",
)
SOURCE_SUFFIXES = {
    ".py",
    ".go",
    ".rs",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".css",
    ".toml",
    ".sh",
    ".md",
    ".java",
    ".swift",
    ".cpp",
    ".hpp",
    ".h",
}


def _git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def _regular_blob(repo, revision, path):
    entry = _git(repo, "ls-tree", revision, "--", path).decode().strip()
    if not entry:
        raise ValueError(f"Context source is missing: {path}")
    if not entry.startswith("100644 blob ") and not entry.startswith("100755 blob "):
        raise ValueError(f"Context source is not a regular file: {path}")
    data = _git(repo, "show", f"{revision}:{path}")
    if len(data) > 1_000_000:
        raise ValueError(f"Context source exceeds the size limit: {path}")
    data.decode("utf-8")
    return data


def build_context(
    repo: Path, revision: str, destination: Path, deployment: dict
) -> dict:
    """Package committed sources, never working-tree files or arbitrary host paths."""
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Context requires a full release SHA")
    if deployment.get("release_sha") != revision:
        raise ValueError("Deployment release does not match context release")
    if destination.exists():
        raise ValueError("Context destination must not already exist")
    tracked = _git(repo, "ls-tree", "-r", "--name-only", revision).decode().splitlines()
    canonical = (
        json.loads(_regular_blob(repo, revision, "docs/manifest.json"))
        if "docs/manifest.json" in tracked
        else []
    )
    sources = set(SOURCE_FILES)
    for entry in canonical:
        path = entry["sourcePath"]
        parts = PurePosixPath(path)
        if (
            not path.startswith("docs/")
            or not path.endswith(".md")
            or ".." in parts.parts
            or str(parts) != path
        ):
            raise ValueError("Unsafe context document path")
        sources.add(path)
    if "docs/manifest.json" not in tracked:
        sources.update(
            path
            for path in tracked
            if path.startswith("docs/") and path.endswith(".md")
        )
    sources.update(
        path
        for path in tracked
        if path.startswith("app/") and path.endswith("/AGENTS.md")
    )
    sources.update(
        path
        for path in tracked
        if path.startswith(SOURCE_ROOTS)
        and PurePosixPath(path).suffix in SOURCE_SUFFIXES
    )
    # Optional code references permit fixtures/minimal distributions with only docs.
    required = {entry["sourcePath"] for entry in canonical}
    blobs = {}
    for path in sorted(sources):
        if path not in tracked and path not in required:
            continue
        blobs[path] = _regular_blob(repo, revision, path)
    manifest = {
        "schema_version": 1,
        "release_sha": revision,
        "deployment": deployment,
        "entrypoints": [entry["sourcePath"] for entry in canonical],
        "files": {
            path: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            for path, data in blobs.items()
        },
    }
    destination.mkdir(parents=True)
    for path, data in blobs.items():
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (destination / "context-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--deployment-manifest", type=Path, required=True)
    args = parser.parse_args()
    result = build_context(
        args.repo,
        args.revision,
        args.destination,
        json.loads(args.deployment_manifest.read_text()),
    )
    print(
        json.dumps(
            {"release_sha": result["release_sha"], "documents": len(result["files"])}
        )
    )


if __name__ == "__main__":
    main()
