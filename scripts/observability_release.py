#!/usr/bin/env python3
"""Build and verify the independently deployed observability configuration."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import tarfile
import tempfile
import zlib
from pathlib import Path

PREFIX = "deploy/observability/"
BUNDLE_FILES = tuple(
    PREFIX + name
    for name in (
        "compose.standalone.yaml",
        "compose.observability.yaml",
        "compose.containerd.yaml",
        "prometheus.yml",
        "docker-proxy.haproxy.cfg",
        "runtime-proxy.haproxy.cfg",
        "grafana/provisioning/dashboards/infrastructure.yaml",
        "grafana/provisioning/datasources/prometheus.yaml",
        "grafana/dashboards/infra-runtime.json",
        "grafana/dashboards/infra-data.json",
    )
)
MAX_BYTES = 8 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
GZIP_HEADER = bytes.fromhex("1f8b08000000000002ff")
_SHA = re.compile(r"[0-9a-f]{40}")
_HASH = re.compile(r"[0-9a-f]{64}")
_IMAGE = re.compile(r"[^\s\"'@]+:[^\s\"'@:/]+@sha256:[0-9a-f]{64}")


def _revision(value):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        raise ValueError("Release revision must be a full lowercase commit SHA")
    return value


def _git(root: Path, *args) -> bytes:
    try:
        return subprocess.run(
            ["git", "--no-replace-objects", "-C", str(root), *args],
            check=True,
            capture_output=True,
            timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("Cannot read the requested observability commit") from error


def _committed_files(root: Path, revision: str) -> dict[str, bytes]:
    if (
        _git(root, "rev-parse", "--verify", f"{revision}^{{commit}}").strip().decode()
        != revision
    ):
        raise ValueError("Release revision is not a commit")
    tree = _git(root, "ls-tree", "-lz", revision, "--", *BUNDLE_FILES)
    payloads = {}
    total = 0
    for entry in tree.split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        mode, kind, blob, size_raw = metadata.split()
        name = path.decode()
        if name not in BUNDLE_FILES or mode != b"100644" or kind != b"blob":
            raise ValueError("Bundle sources must be regular allowlisted Git files")
        size = int(size_raw)
        total += size
        if size > MAX_FILE_BYTES or total > MAX_BYTES:
            raise ValueError("Bundle source size limit exceeded")
        content = _git(root, "cat-file", "blob", blob.decode())
        if len(content) != size:
            raise ValueError("Committed file size mismatch")
        payloads[name] = content
    if set(payloads) != set(BUNDLE_FILES):
        raise ValueError("The commit is missing required observability files")
    return payloads


def _images(payloads: dict[str, bytes]) -> list[str]:
    try:
        import yaml
    except ImportError as error:
        raise ValueError(
            "PyYAML is required; select a prepared OBS_PYTHON interpreter"
        ) from error
    images = []
    for name in BUNDLE_FILES:
        if not name.endswith(".yaml") or "/compose." not in name:
            continue
        try:
            document = yaml.safe_load(payloads[name].decode("utf-8"))
        except (UnicodeError, yaml.YAMLError) as error:
            raise ValueError("Invalid Compose YAML") from error
        if not isinstance(document, dict) or not isinstance(
            document.get("services"), dict
        ):
            raise ValueError("Compose services must be a mapping")
        references = []
        for service in document["services"].values():
            if not isinstance(service, dict):
                raise ValueError("Each Compose service must be a mapping")
            if "image" in service:
                if not isinstance(service["image"], str):
                    raise ValueError("Compose image references must be strings")
                references.append(service["image"])
        if name.endswith("/compose.observability.yaml") and len(references) != 8:
            raise ValueError("Expected eight explicit monitoring image references")
        images.extend(references)
    if any(
        not _IMAGE.fullmatch(value) or value.split("@")[0].endswith(":latest")
        for value in images
    ):
        raise ValueError("Monitoring images must have a version and immutable digest")
    return sorted(set(images))


def _manifest(payloads, revision):
    return {
        "schema_version": 1,
        "stack_id": "crate-observability",
        "release_sha": _revision(revision),
        "files": {
            name: hashlib.sha256(payloads[name]).hexdigest() for name in BUNDLE_FILES
        },
        "images": _images(payloads),
    }


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate manifest key")
        result[key] = value
    return result


def _verified_manifest(content, payloads):
    try:
        manifest = json.loads(content, object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid observability manifest JSON") from error
    if not isinstance(manifest, dict) or set(manifest) != {
        "schema_version",
        "stack_id",
        "release_sha",
        "files",
        "images",
    }:
        raise ValueError("Invalid observability manifest fields")
    if type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1:
        raise ValueError("Unsupported observability manifest schema")
    if manifest["stack_id"] != "crate-observability":
        raise ValueError("Unsupported deployment stack")
    files = manifest["files"]
    if (
        not isinstance(files, dict)
        or set(files) != set(BUNDLE_FILES)
        or any(
            not isinstance(value, str) or not _HASH.fullmatch(value)
            for value in files.values()
        )
    ):
        raise ValueError("Invalid manifest file checksums")
    if manifest != _manifest(payloads, manifest["release_sha"]):
        raise ValueError("Bundle checksum or image metadata mismatch")
    return manifest


def _regular_archive_headers(raw: bytes) -> None:
    # tarfile iteration consumes GNU/PAX headers before yielding regular members.
    offset = 0
    count = 0
    while offset + tarfile.BLOCKSIZE <= len(raw):
        header = raw[offset : offset + tarfile.BLOCKSIZE]
        if not any(header):
            if any(raw[offset:]):
                raise ValueError("Unexpected trailing archive data")
            return
        member = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
        if member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE):
            raise ValueError(
                "Physical archive members must be regular files without metadata headers"
            )
        count += 1
        if count > len(BUNDLE_FILES) + 1:
            raise ValueError("Bundle member count limit exceeded")
        if member.size < 0 or member.size > MAX_FILE_BYTES:
            raise ValueError("Bundle member size limit exceeded")
        offset += tarfile.BLOCKSIZE * (
            1 + (member.size + tarfile.BLOCKSIZE - 1) // tarfile.BLOCKSIZE
        )
    raise ValueError("Missing archive terminator")


def _single_gzip_member(compressed: bytes) -> bytes:
    if compressed[: len(GZIP_HEADER)] != GZIP_HEADER:
        raise ValueError("Noncanonical gzip header")
    inflater = zlib.decompressobj(-zlib.MAX_WBITS)
    raw = inflater.decompress(compressed[len(GZIP_HEADER) :], MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Decompressed bundle size limit exceeded")
    if not inflater.eof:
        raise ValueError("Truncated gzip member")
    if len(inflater.unused_data) != 8:
        raise ValueError("Exactly one gzip member without trailing data is required")
    checksum, size = struct.unpack("<II", inflater.unused_data)
    if checksum != zlib.crc32(raw) or size != len(raw):
        raise ValueError("gzip member checksum or size mismatch")
    return raw


def verify_bundle(bundle_path: str | Path, *, expected_sha: str | None = None) -> dict:
    """Verify bounded archive contents without extracting into the filesystem."""
    if expected_sha is not None:
        _revision(expected_sha)
    with Path(bundle_path).open("rb") as source:
        compressed = source.read(MAX_BYTES + 1)
    if len(compressed) > MAX_BYTES:
        raise ValueError("Compressed bundle size limit exceeded")
    try:
        raw = _single_gzip_member(compressed)
        _regular_archive_headers(raw)
        payloads = {}
        expected_names = sorted((*BUNDLE_FILES, "manifest.json"))
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
            for member in archive:
                if len(payloads) >= len(BUNDLE_FILES) + 1:
                    raise ValueError("Bundle member count limit exceeded")
                if (
                    member.name not in (*BUNDLE_FILES, "manifest.json")
                    or member.name in payloads
                ):
                    raise ValueError("Unexpected or duplicate bundle member")
                if member.name != expected_names[len(payloads)]:
                    raise ValueError("Noncanonical bundle member order")
                if not member.isfile() or member.pax_headers:
                    raise ValueError(
                        "Bundle members must be regular files without extended metadata"
                    )
                if (
                    member.mode != 0o644
                    or member.uid != 0
                    or member.gid != 0
                    or member.mtime != 0
                    or member.uname
                    or member.gname
                    or member.linkname
                ):
                    raise ValueError("Noncanonical bundle member metadata")
                limit = (
                    MAX_MANIFEST_BYTES
                    if member.name == "manifest.json"
                    else MAX_FILE_BYTES
                )
                if member.size < 0 or member.size > limit:
                    raise ValueError("Bundle member size limit exceeded")
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("Missing bundle member content")
                payloads[member.name] = stream.read(limit + 1)
                if len(payloads[member.name]) != member.size:
                    raise ValueError("Truncated bundle member")
            if any(raw[archive.offset :]):
                raise ValueError("Unexpected trailing archive data")
    except (OSError, EOFError, tarfile.TarError, zlib.error) as error:
        raise ValueError("Invalid observability archive") from error
    if set(payloads) != {*BUNDLE_FILES, "manifest.json"}:
        raise ValueError("Bundle is missing required members")
    manifest = _verified_manifest(payloads.pop("manifest.json"), payloads)
    if expected_sha is not None and manifest["release_sha"] != expected_sha:
        raise ValueError("Bundle revision does not match the expected revision")
    return manifest


def build_bundle(
    source_root: str | Path, release_sha: str, destination: str | Path
) -> dict:
    """Atomically package only allowlisted files from the exact Git commit."""
    payloads = _committed_files(Path(source_root), _revision(release_sha))
    manifest = _manifest(payloads, release_sha)
    payloads["manifest.json"] = (
        json.dumps(manifest, sort_keys=True, indent=2) + "\n"
    ).encode()
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, content in sorted(payloads.items()):
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(content), 0o644
            archive.addfile(member, io.BytesIO(content))
    if len(raw.getvalue()) > MAX_BYTES:
        raise ValueError("Decompressed bundle size limit exceeded")
    compressed = gzip.compress(raw.getvalue(), mtime=0)
    if len(compressed) > MAX_BYTES:
        raise ValueError("Compressed bundle size limit exceeded")
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(compressed)
        verify_bundle(temporary)
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    bundle = commands.add_parser("bundle")
    bundle.add_argument("--source-root", type=Path, required=True)
    bundle.add_argument("--sha", required=True)
    bundle.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("archive", type=Path)
    verify.add_argument("--expected-sha")
    args = parser.parse_args(argv)
    try:
        manifest = (
            build_bundle(args.source_root, args.sha, args.output)
            if args.command == "bundle"
            else verify_bundle(args.archive, expected_sha=args.expected_sha)
        )
    except (ValueError, OSError) as error:
        print(f"Observability bundle rejected: {error}", file=sys.stderr)
        return 1
    print(json.dumps(manifest, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
