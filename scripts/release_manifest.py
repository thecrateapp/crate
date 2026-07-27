#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SCHEMA_VERSION = 1
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
GLOBAL_BUILD_PATTERNS = (
    ".github/workflows/build-images.yml",
    ".github/actions/**",
)


@dataclass(frozen=True)
class ImageSpec:
    repository: str
    environment: str
    services: tuple[str, ...]
    patterns: tuple[str, ...]


BACKEND_PATTERNS = (
    "app/crate/**",
    "app/scripts/**",
    "app/bin/**",
    "app/alembic.ini",
    "app/requirements-api.txt",
    "app/Dockerfile",
    "app/.dockerignore",
)

IMAGE_SPECS: dict[str, ImageSpec] = {
    "api": ImageSpec(
        repository="crate-api",
        environment="CRATE_API_IMAGE",
        services=("crate-api",),
        patterns=BACKEND_PATTERNS,
    ),
    "readplane": ImageSpec(
        repository="crate-readplane",
        environment="CRATE_READPLANE_IMAGE",
        services=("crate-readplane",),
        patterns=("app/readplane/**",),
    ),
    "worker": ImageSpec(
        repository="crate-worker",
        environment="CRATE_WORKER_IMAGE",
        services=("crate-worker", "crate-projector", "crate-maintenance-worker"),
        patterns=(
            *BACKEND_PATTERNS,
            "app/requirements-worker-core.txt",
            "tools/crate-cli/**",
        ),
    ),
    "analysis-worker": ImageSpec(
        repository="crate-analysis-worker",
        environment="CRATE_ANALYSIS_WORKER_IMAGE",
        services=("crate-analysis-worker",),
        patterns=(
            *BACKEND_PATTERNS,
            "app/requirements-worker-core.txt",
            "app/requirements-worker-analysis.txt",
            "tools/crate-cli/**",
        ),
    ),
    "playback-worker": ImageSpec(
        repository="crate-playback-worker",
        environment="CRATE_PLAYBACK_WORKER_IMAGE",
        services=("crate-playback-worker",),
        patterns=BACKEND_PATTERNS,
    ),
    "media-worker": ImageSpec(
        repository="crate-media-worker",
        environment="CRATE_MEDIA_WORKER_IMAGE",
        services=("crate-media-worker",),
        patterns=("app/media-worker/**", "app/Dockerfile", "app/.dockerignore"),
    ),
    "ui": ImageSpec(
        repository="crate-ui",
        environment="CRATE_UI_IMAGE",
        services=("crate-ui",),
        patterns=("app/ui/**", "app/shared/**"),
    ),
    "listen": ImageSpec(
        repository="crate-listen",
        environment="CRATE_LISTEN_IMAGE",
        services=("crate-listen",),
        patterns=("app/listen/**", "app/shared/**"),
    ),
    "site": ImageSpec(
        repository="crate-site",
        environment="CRATE_SITE_IMAGE",
        services=("crate-site",),
        patterns=("app/site/**", "app/shared/**", "install.sh"),
    ),
    "docs": ImageSpec(
        repository="crate-docs",
        environment="CRATE_DOCS_IMAGE",
        services=("crate-docs",),
        patterns=("app/docs/**", "app/shared/**", "docs/**"),
    ),
}

REQUEST_ALIASES = {
    "all": frozenset(IMAGE_SPECS),
    "backend": frozenset({"api", "worker", "analysis-worker", "playback-worker"}),
}


class ManifestError(ValueError):
    pass


def _matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def detect_changed_images(
    paths: Iterable[str], *, requested: str | None = None
) -> set[str]:
    if requested:
        selected: set[str] = set()
        for raw_name in requested.split(","):
            name = raw_name.strip()
            if not name:
                continue
            if name in REQUEST_ALIASES:
                selected.update(REQUEST_ALIASES[name])
                continue
            if name not in IMAGE_SPECS:
                raise ManifestError(f"unknown image selection: {name}")
            selected.add(name)
        return selected

    normalized_paths = [
        path.strip()[2:] if path.strip().startswith("./") else path.strip()
        for path in paths
        if path.strip()
    ]
    if any(_matches(path, GLOBAL_BUILD_PATTERNS) for path in normalized_paths):
        return set(IMAGE_SPECS)
    return {
        name
        for name, spec in IMAGE_SPECS.items()
        if any(_matches(path, spec.patterns) for path in normalized_paths)
    }


def _expected_repository(registry: str, owner: str, spec: ImageSpec) -> str:
    return f"{registry.rstrip('/')}/{owner.strip('/')}/{spec.repository}"


def validate_manifest(
    manifest: dict,
    *,
    expected_release_sha: str | None = None,
    registry: str | None = None,
    owner: str | None = None,
) -> None:
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ManifestError("unsupported manifest schema_version")
    release_sha = manifest.get("release_sha")
    if not isinstance(release_sha, str) or not SHA_RE.fullmatch(release_sha):
        raise ManifestError("release_sha must be a full lowercase commit SHA")
    if expected_release_sha is not None and release_sha != expected_release_sha:
        raise ManifestError(
            f"release_sha {release_sha} does not match {expected_release_sha}"
        )
    images = manifest.get("images")
    if not isinstance(images, dict):
        raise ManifestError("images must be an object")
    missing = set(IMAGE_SPECS).difference(images)
    extra = set(images).difference(IMAGE_SPECS)
    if missing:
        raise ManifestError(f"missing image entries: {', '.join(sorted(missing))}")
    if extra:
        raise ManifestError(f"unknown image entries: {', '.join(sorted(extra))}")

    repository_prefix: str | None = None
    for name, spec in IMAGE_SPECS.items():
        entry = images[name]
        if not isinstance(entry, dict):
            raise ManifestError(f"{name} image entry must be an object")
        repository = entry.get("repository")
        if not isinstance(repository, str):
            raise ManifestError(f"{name} repository is missing")
        expected_repository = (
            _expected_repository(registry, owner, spec)
            if registry is not None and owner is not None
            else None
        )
        if expected_repository is not None and repository != expected_repository:
            raise ManifestError(f"{name} repository does not match release registry")
        if repository.rsplit("/", 1)[-1] != spec.repository:
            raise ManifestError(f"{name} repository is invalid")
        prefix = repository.rsplit("/", 1)[0]
        if repository_prefix is None:
            repository_prefix = prefix
        elif prefix != repository_prefix:
            raise ManifestError(f"{name} repository uses a different registry owner")
        digest = entry.get("digest")
        if not isinstance(digest, str) or not DIGEST_RE.fullmatch(digest):
            raise ManifestError(f"{name} digest must be a sha256 OCI digest")
        source_sha = entry.get("source_sha")
        if not isinstance(source_sha, str) or not SHA_RE.fullmatch(source_sha):
            raise ManifestError(f"{name} source_sha is invalid")
        if entry.get("environment") != spec.environment:
            raise ManifestError(f"{name} environment mapping is invalid")
        if entry.get("services") != list(spec.services):
            raise ManifestError(f"{name} service mapping is invalid")


def assemble_manifest(
    *,
    release_sha: str,
    registry: str,
    owner: str,
    previous: dict | None,
    changed_digests: dict[str, str],
) -> dict:
    if not SHA_RE.fullmatch(release_sha):
        raise ManifestError("release_sha must be a full lowercase commit SHA")
    unknown = set(changed_digests).difference(IMAGE_SPECS)
    if unknown:
        raise ManifestError(f"unknown changed images: {', '.join(sorted(unknown))}")
    if previous is not None:
        validate_manifest(previous, registry=registry, owner=owner)

    images: dict[str, dict] = {}
    for name, spec in IMAGE_SPECS.items():
        digest = changed_digests.get(name)
        if digest is not None:
            if not DIGEST_RE.fullmatch(digest):
                raise ManifestError(f"{name} digest must be a sha256 OCI digest")
            images[name] = {
                "repository": _expected_repository(registry, owner, spec),
                "digest": digest,
                "source_sha": release_sha,
                "environment": spec.environment,
                "services": list(spec.services),
            }
            continue
        if previous is None or name not in previous["images"]:
            raise ManifestError(f"missing image entry for {name}")
        images[name] = deepcopy(previous["images"][name])

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "release_sha": release_sha,
        "images": images,
    }
    validate_manifest(
        manifest,
        expected_release_sha=release_sha,
        registry=registry,
        owner=owner,
    )
    return manifest


def render_release_env(manifest: dict) -> str:
    validate_manifest(manifest)
    lines = [f"CRATE_RELEASE_SHA={manifest['release_sha']}"]
    for name, spec in IMAGE_SPECS.items():
        entry = manifest["images"][name]
        lines.append(f"{spec.environment}={entry['repository']}@{entry['digest']}")
    return "\n".join(lines) + "\n"


def _load_manifest(path: str | None) -> dict | None:
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _git_changed_paths(base: str | None, head: str) -> list[str]:
    if not base:
        return []
    result = subprocess.run(
        ["git", "diff", "--name-only", base, head],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()


def _parse_digest_values(values: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for value in values:
        name, separator, digest = value.partition("=")
        if not separator:
            raise ManifestError(f"invalid digest assignment: {value}")
        if digest:
            parsed[name] = digest
    return parsed


def _write_or_print(value: str, output: str | None) -> None:
    if output:
        Path(output).write_text(value, encoding="utf-8")
    else:
        print(value, end="")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    detect_parser = subparsers.add_parser("detect")
    detect_parser.add_argument("--base")
    detect_parser.add_argument("--head", required=True)
    detect_parser.add_argument("--requested")

    assemble_parser = subparsers.add_parser("assemble")
    assemble_parser.add_argument("--release-sha", required=True)
    assemble_parser.add_argument("--registry", required=True)
    assemble_parser.add_argument("--owner", required=True)
    assemble_parser.add_argument("--previous")
    assemble_parser.add_argument("--digest", action="append", default=[])
    assemble_parser.add_argument("--output", required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--manifest", required=True)
    validate_parser.add_argument("--release-sha")
    validate_parser.add_argument("--registry")
    validate_parser.add_argument("--owner")

    env_parser = subparsers.add_parser("env")
    env_parser.add_argument("--manifest", required=True)
    env_parser.add_argument("--output")

    refs_parser = subparsers.add_parser("refs")
    refs_parser.add_argument("--manifest", required=True)

    base_parser = subparsers.add_parser("base-sha")
    base_parser.add_argument("--manifest", required=True)
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    if args.command == "detect":
        if args.requested:
            selected = detect_changed_images([], requested=args.requested)
        elif args.base:
            selected = detect_changed_images(_git_changed_paths(args.base, args.head))
        else:
            selected = set(IMAGE_SPECS)
        for name in IMAGE_SPECS:
            output_name = name.replace("-", "_")
            print(f"{output_name}={'true' if name in selected else 'false'}")
        print(f"any={'true' if selected else 'false'}")
        return 0
    if args.command == "assemble":
        manifest = assemble_manifest(
            release_sha=args.release_sha,
            registry=args.registry,
            owner=args.owner,
            previous=_load_manifest(args.previous),
            changed_digests=_parse_digest_values(args.digest),
        )
        _write_or_print(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", args.output
        )
        return 0
    if args.command == "validate":
        manifest = _load_manifest(args.manifest)
        assert manifest is not None
        validate_manifest(
            manifest,
            expected_release_sha=args.release_sha,
            registry=args.registry,
            owner=args.owner,
        )
        return 0
    if args.command == "env":
        manifest = _load_manifest(args.manifest)
        assert manifest is not None
        _write_or_print(render_release_env(manifest), args.output)
        return 0
    if args.command == "refs":
        manifest = _load_manifest(args.manifest)
        assert manifest is not None
        validate_manifest(manifest)
        for name in IMAGE_SPECS:
            entry = manifest["images"][name]
            print(f"{entry['repository']}@{entry['digest']}")
        return 0
    if args.command == "base-sha":
        manifest = _load_manifest(args.manifest)
        assert manifest is not None
        validate_manifest(manifest)
        print(manifest["release_sha"])
        return 0
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
