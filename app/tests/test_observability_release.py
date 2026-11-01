from __future__ import annotations

import hashlib
import gzip
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import zlib
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/observability_release.py"
FILES = (
    "deploy/observability/compose.standalone.yaml",
    "deploy/observability/compose.observability.yaml",
    "deploy/observability/compose.containerd.yaml",
    "deploy/observability/prometheus.yml",
    "deploy/observability/docker-proxy.haproxy.cfg",
    "deploy/observability/runtime-proxy.haproxy.cfg",
    "deploy/observability/grafana/provisioning/datasources/prometheus.yaml",
    "deploy/observability/grafana/provisioning/dashboards/infrastructure.yaml",
    "deploy/observability/grafana/dashboards/infra-runtime.json",
    "deploy/observability/grafana/dashboards/infra-data.json",
)


def _release():
    assert SCRIPT.is_file(), "Independent observability release builder is required"
    spec = importlib.util.spec_from_file_location("_observability_release_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _git(repository, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repository), *args],
        check=check,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "GIT_AUTHOR_DATE": "2026-10-31T12:00:00+00:00",
            "GIT_COMMITTER_DATE": "2026-10-31T12:00:00+00:00",
        },
    )


@pytest.fixture
def committed_source(tmp_path):
    repository = tmp_path / "source"
    repository.mkdir()
    payloads = {}
    for name in FILES:
        source = ROOT / name
        payload = (
            source.read_bytes()
            if source.is_file()
            else b"name: crate-observability\nservices: {}\n"
        )
        destination = repository / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        payloads[name] = payload
    (repository / ".env").write_text("PRIVATE_APP_CREDENTIAL=never-bundle\n")
    _git(repository, "init", "--quiet")
    _git(repository, "config", "user.name", "Fixture Author")
    _git(repository, "config", "user.email", "fixture@example.invalid")
    _git(repository, "config", "commit.gpgsign", "false")
    _git(repository, "add", ".")
    _git(
        repository,
        "commit",
        "--quiet",
        "-m",
        "test: create observability release fixture",
    )
    sha = _git(repository, "rev-parse", "HEAD").stdout.strip()
    return repository, sha, payloads


def test_bundle_builds_and_verifies_exact_committed_configuration(
    tmp_path, committed_source
):
    repository, sha, payloads = committed_source
    release = _release()
    destination = tmp_path / "bundle.tar.gz"

    manifest = release.build_bundle(repository, sha, destination)

    assert manifest["schema_version"] == 1
    assert manifest["stack_id"] == "crate-observability"
    assert manifest["release_sha"] == sha
    assert manifest["files"] == {
        name: hashlib.sha256(payload).hexdigest() for name, payload in payloads.items()
    }
    assert manifest["images"] == sorted(set(manifest["images"]))
    assert manifest["images"]
    assert all(
        "@sha256:" in image and ":latest" not in image for image in manifest["images"]
    )
    with tarfile.open(destination, "r:gz") as archive:
        members = archive.getmembers()
        assert {member.name for member in members} == {*FILES, "manifest.json"}
        assert len(members) == 11
        assert all(member.isfile() for member in members)
        assert json.load(archive.extractfile("manifest.json")) == manifest
        for name, payload in payloads.items():
            assert archive.extractfile(name).read() == payload
    assert release.verify_bundle(destination) == manifest


def _archive(path, entries):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, content, kind, linkname in sorted(entries, key=lambda item: item[0]):
            member = tarfile.TarInfo(name)
            member.mode = 0o644
            member.type = kind
            member.linkname = linkname
            member.size = len(content) if kind == tarfile.REGTYPE else 0
            archive.addfile(member, io.BytesIO(content) if member.isfile() else None)
    path.write_bytes(gzip.compress(raw.getvalue(), mtime=0))


def _entries(payloads, manifest):
    return [
        (name, payload, tarfile.REGTYPE, "") for name, payload in payloads.items()
    ] + [("manifest.json", json.dumps(manifest).encode(), tarfile.REGTYPE, "")]


def test_bundle_is_deterministic_across_destinations(tmp_path, committed_source):
    repository, sha, _payloads = committed_source
    release = _release()
    first, second = tmp_path / "first.tar.gz", tmp_path / "second.tar.gz"

    assert release.build_bundle(repository, sha, first) == release.build_bundle(
        repository, sha, second
    )
    assert first.read_bytes() == second.read_bytes()


def test_atomic_replacement_failure_preserves_previous_artifact_and_cleans_temporary_file(
    tmp_path, committed_source, monkeypatch
):
    repository, sha, _payloads = committed_source
    release = _release()
    destination = tmp_path / "preserved.tar.gz"
    destination.write_bytes(b"previous valid artifact")
    before = set(tmp_path.iterdir())

    def denied_replace(*_args, **_kwargs):
        raise PermissionError("Injected atomic replacement failure")

    monkeypatch.setattr(release.os, "replace", denied_replace)

    with pytest.raises(PermissionError, match="Injected atomic replacement failure"):
        release.build_bundle(repository, sha, destination)

    assert destination.read_bytes() == b"previous valid artifact"
    assert set(tmp_path.iterdir()) == before


def test_requested_commit_ignores_newer_head_and_dirty_or_symlinked_worktree_files(
    tmp_path, committed_source
):
    repository, original_sha, payloads = committed_source
    changed = repository / FILES[0]
    changed.write_bytes(payloads[FILES[0]] + b"\n# later committed configuration\n")
    _git(repository, "add", FILES[0])
    _git(repository, "commit", "--quiet", "-m", "test: newer configuration fixture")
    secret = tmp_path / "private-source"
    secret.write_text("NEVER_INCLUDE_DIRTY_WORKTREE_SECRET")
    changed.unlink()
    changed.symlink_to(secret)
    (repository / FILES[3]).unlink()
    release = _release()
    destination = tmp_path / "original.tar.gz"

    manifest = release.build_bundle(repository, original_sha, destination)

    assert manifest["release_sha"] == original_sha
    assert manifest["files"] == {
        name: hashlib.sha256(value).hexdigest() for name, value in payloads.items()
    }
    with tarfile.open(destination, "r:gz") as archive:
        assert archive.extractfile(FILES[0]).read() == payloads[FILES[0]]
        assert archive.extractfile(FILES[3]).read() == payloads[FILES[3]]
        assert "NEVER_INCLUDE_DIRTY_WORKTREE_SECRET" not in repr(
            [member.name for member in archive]
        )


@pytest.mark.parametrize("replacement", ["commit", "blob_same_size"])
def test_git_replace_cannot_change_configuration_at_the_requested_commit(
    tmp_path, committed_source, replacement
):
    repository, sha, payloads = committed_source
    name = FILES[3]
    original = payloads[name]
    modified = bytes([original[0] ^ 1]) + original[1:]
    if replacement == "commit":
        (repository / name).write_bytes(modified)
        _git(repository, "add", name)
        _git(repository, "commit", "--quiet", "-m", "test: replacement commit fixture")
        substitute = _git(repository, "rev-parse", "HEAD").stdout.strip()
        _git(repository, "replace", sha, substitute)
    else:
        original_blob = _git(repository, "rev-parse", f"{sha}:{name}").stdout.strip()
        replacement_path = repository / "replacement-fixture"
        replacement_path.write_bytes(modified)
        substitute = _git(
            repository, "hash-object", "-w", str(replacement_path)
        ).stdout.strip()
        _git(repository, "replace", original_blob, substitute)
    destination = tmp_path / "replacement.tar.gz"

    try:
        manifest = _release().build_bundle(repository, sha, destination)
    except ValueError:
        return

    assert manifest["release_sha"] == sha
    with tarfile.open(destination, "r:gz") as archive:
        assert archive.extractfile(name).read() == original


@pytest.mark.parametrize("sha", ["HEAD", "a" * 39, "A" * 40, "a" * 40, "--help"])
def test_invalid_or_missing_commit_cannot_replace_an_existing_artifact(
    tmp_path, committed_source, sha
):
    repository, _sha, _payloads = committed_source
    destination = tmp_path / "output.tar.gz"
    destination.write_bytes(b"existing artifact")
    release = _release()

    with pytest.raises(ValueError):
        release.build_bundle(repository, sha, destination)

    assert destination.read_bytes() == b"existing artifact"


@pytest.mark.parametrize(
    "invalid_source", ["missing", "symlink", "oversized", "unpinned_image"]
)
def test_invalid_committed_source_is_rejected_before_artifact_replacement(
    tmp_path, committed_source, invalid_source
):
    repository, _sha, payloads = committed_source
    target = repository / FILES[3]
    if invalid_source == "missing":
        target.unlink()
    elif invalid_source == "symlink":
        target.unlink()
        target.symlink_to("docker-proxy.haproxy.cfg")
    elif invalid_source == "oversized":
        target.write_bytes(b"#" * (2 * 1024 * 1024 + 1))
    else:
        compose = repository / FILES[1]
        first_image = next(
            line
            for line in payloads[FILES[1]].decode().splitlines()
            if line.strip().startswith("image:")
        )
        compose.write_text(
            payloads[FILES[1]]
            .decode()
            .replace(first_image, "    image: prom/prometheus:latest", 1)
        )
    _git(repository, "add", "-A")
    _git(
        repository,
        "commit",
        "--quiet",
        "-m",
        f"test: {invalid_source} configuration fixture",
    )
    sha = _git(repository, "rev-parse", "HEAD").stdout.strip()
    destination = tmp_path / "release.tar.gz"
    destination.write_bytes(b"preserved artifact")

    with pytest.raises(ValueError):
        _release().build_bundle(repository, sha, destination)

    assert destination.read_bytes() == b"preserved artifact"


def test_directory_at_allowlisted_path_is_rejected_without_listing_descendants(
    tmp_path, committed_source, monkeypatch
):
    repository, _sha, _payloads = committed_source
    name = FILES[3]
    directory = repository / name
    directory.unlink()
    directory.mkdir()
    for index in range(64):
        (directory / f"descendant-{index:03d}").write_text("private child metadata\n")
    _git(repository, "add", "-A")
    _git(repository, "commit", "--quiet", "-m", "test: directory source fixture")
    sha = _git(repository, "rev-parse", "HEAD").stdout.strip()
    release = _release()
    real_git = release._git
    listed_paths = []

    def observe_git(root, *args):
        output = real_git(root, *args)
        if args[0] == "ls-tree":
            listed_paths.extend(
                entry.split(b"\t", 1)[1].decode()
                for entry in output.split(b"\0")
                if entry
            )
        return output

    monkeypatch.setattr(release, "_git", observe_git)

    with pytest.raises(ValueError):
        release.build_bundle(repository, sha, tmp_path / "directory.tar.gz")

    assert listed_paths
    assert len(listed_paths) <= len(FILES)
    assert not any(path.startswith(name + "/") for path in listed_paths)


@pytest.mark.parametrize("compose_file", [FILES[0], FILES[2]])
def test_mutable_image_override_with_inline_comment_cannot_hide_from_manifest(
    tmp_path, committed_source, compose_file
):
    repository, _sha, _payloads = committed_source
    path = repository / compose_file
    text = path.read_text()
    override = "    image: nginx:latest # valid mutable override\n"
    if compose_file == FILES[0]:
        marker = "  crate-grafana:\n"
        assert marker in text
        text = text.replace(marker, marker + override, 1)
    else:
        text += "\n  crate-grafana:\n" + override
    assert yaml.safe_load(text)["services"]["crate-grafana"]["image"] == "nginx:latest"
    path.write_text(text)
    _git(repository, "add", compose_file)
    _git(repository, "commit", "--quiet", "-m", "test: mutable image override fixture")
    sha = _git(repository, "rev-parse", "HEAD").stdout.strip()

    with pytest.raises(ValueError):
        _release().build_bundle(repository, sha, tmp_path / "mutable.tar.gz")


@pytest.mark.parametrize(
    "configuration",
    [
        'services:\n  crate-grafana:\n    "image": nginx:latest\n',
        "services: {crate-grafana: {image: nginx:latest}}\n",
        "x-image: &mutable\n  image: nginx:latest\n"
        "services:\n  crate-grafana:\n    <<: *mutable\n",
    ],
    ids=["quoted-key", "flow-mapping", "merged-alias"],
)
def test_mutable_image_cannot_hide_in_valid_yaml_representations(
    tmp_path, committed_source, configuration
):
    repository, _sha, _payloads = committed_source
    assert yaml.safe_load(configuration)["services"]["crate-grafana"]["image"] == (
        "nginx:latest"
    )
    (repository / FILES[2]).write_text(configuration)
    _git(repository, "add", FILES[2])
    _git(repository, "commit", "--quiet", "-m", "test: YAML image fixture")
    sha = _git(repository, "rev-parse", "HEAD").stdout.strip()

    with pytest.raises(ValueError):
        _release().build_bundle(repository, sha, tmp_path / "mutable-yaml.tar.gz")


@pytest.mark.parametrize(
    "configuration",
    ["services: [\n", "services:\n  crate-grafana: nginx:latest\n"],
    ids=["malformed-yaml", "service-not-mapping"],
)
def test_invalid_compose_yaml_is_rejected_as_a_validation_error(
    tmp_path, committed_source, configuration
):
    repository, _sha, _payloads = committed_source
    (repository / FILES[2]).write_text(configuration)
    _git(repository, "add", FILES[2])
    _git(repository, "commit", "--quiet", "-m", "test: invalid YAML fixture")
    sha = _git(repository, "rev-parse", "HEAD").stdout.strip()

    with pytest.raises(ValueError):
        _release().build_bundle(repository, sha, tmp_path / "invalid-yaml.tar.gz")


@pytest.mark.parametrize(
    "defect",
    [
        "extra",
        "missing",
        "duplicate",
        "traversal",
        "absolute",
        "dot_prefix",
        "symlink",
        "hardlink",
        "directory",
        "payload_tampered",
        "schema",
        "stack",
        "sha",
        "files",
        "images",
        "duplicate_manifest_key",
        "oversized_manifest",
    ],
)
def test_verifier_rejects_hostile_or_tampered_archives_without_extraction(
    tmp_path, committed_source, defect
):
    repository, sha, payloads = committed_source
    release = _release()
    manifest = release.build_bundle(repository, sha, tmp_path / "valid.tar.gz")
    entries = _entries(payloads, manifest)
    if defect == "extra":
        entries.append((".env", b"PRIVATE_APP_CREDENTIAL=secret", tarfile.REGTYPE, ""))
    elif defect == "missing":
        entries.pop(0)
    elif defect == "duplicate":
        entries.append(entries[0])
    elif defect in {"traversal", "absolute", "dot_prefix"}:
        name = {
            "traversal": "../outside",
            "absolute": "/outside",
            "dot_prefix": "./" + FILES[0],
        }[defect]
        entries[0] = (name, entries[0][1], tarfile.REGTYPE, "")
    elif defect in {"symlink", "hardlink", "directory"}:
        kind = {
            "symlink": tarfile.SYMTYPE,
            "hardlink": tarfile.LNKTYPE,
            "directory": tarfile.DIRTYPE,
        }[defect]
        entries[0] = (FILES[0], b"", kind, "../outside")
    elif defect == "payload_tampered":
        entries[0] = (FILES[0], entries[0][1] + b"# altered\n", tarfile.REGTYPE, "")
    else:
        if defect == "schema":
            manifest["schema_version"] = 2
        elif defect == "stack":
            manifest["stack_id"] = "crate"
        elif defect == "sha":
            manifest["release_sha"] = "HEAD"
        elif defect == "files":
            manifest["files"][FILES[0]] = "0" * 64
        elif defect == "images":
            manifest["images"] = ["prom/prometheus:v1@sha256:" + "0" * 64]
        content = json.dumps(manifest).encode()
        if defect == "duplicate_manifest_key":
            content = content.replace(
                b'"schema_version": 1', b'"schema_version": 1, "schema_version": 1'
            )
        elif defect == "oversized_manifest":
            content += b" " * (64 * 1024 + 1 - len(content))
        entries[-1] = ("manifest.json", content, tarfile.REGTYPE, "")
    hostile = tmp_path / "hostile.tar.gz"
    _archive(hostile, entries)
    before = set(tmp_path.iterdir())

    with pytest.raises(ValueError):
        release.verify_bundle(hostile)

    assert set(tmp_path.iterdir()) == before


@pytest.mark.parametrize(
    "cap", ["compressed", "member", "total", "raw_gzip", "pax", "gnu"]
)
def test_verifier_enforces_size_caps_before_parsing_or_extracting_payloads(
    tmp_path, committed_source, cap
):
    repository, sha, payloads = committed_source
    release = _release()
    manifest = release.build_bundle(repository, sha, tmp_path / "valid.tar.gz")
    oversized = tmp_path / "oversized.tar.gz"
    if cap == "compressed":
        oversized.write_bytes(b"x" * (8 * 1024 * 1024 + 1))
    elif cap == "raw_gzip":
        oversized.write_bytes(gzip.compress(b"\0" * (8 * 1024 * 1024 + 1), mtime=0))
    elif cap in {"pax", "gnu"}:
        raw = io.BytesIO()
        with tarfile.open(
            fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT
        ) as archive:
            header = tarfile.TarInfo("extended-header")
            header.type = tarfile.XHDTYPE if cap == "pax" else tarfile.GNUTYPE_LONGNAME
            header.size = 8 * 1024 * 1024 + 1
            archive.addfile(header, io.BytesIO(b"\0" * header.size))
        oversized.write_bytes(gzip.compress(raw.getvalue(), mtime=0))
    else:
        if cap == "member":
            payloads[FILES[3]] = b"#" * (2 * 1024 * 1024 + 1)
        else:
            for name in FILES[3:]:
                payloads[name] = b"#" * (1280 * 1024)
        manifest["files"] = {
            name: hashlib.sha256(value).hexdigest() for name, value in payloads.items()
        }
        _archive(oversized, _entries(payloads, manifest))

    with pytest.raises(ValueError, match="(?i)(size|limit|large|budget)"):
        release.verify_bundle(oversized)


def test_bundle_cli_builds_verifies_and_rejects_invalid_revision_without_effects(
    tmp_path, committed_source
):
    repository, sha, _payloads = committed_source
    destination = tmp_path / "cli.tar.gz"
    built = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "bundle",
            "--source-root",
            str(repository),
            "--sha",
            sha,
            "--output",
            str(destination),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert built.returncode == 0, built.stderr
    expected = destination.read_bytes()
    verified = subprocess.run(
        [sys.executable, str(SCRIPT), "verify", str(destination)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert verified.returncode == 0, verified.stderr
    invalid = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "bundle",
            "--source-root",
            str(repository),
            "--sha",
            "HEAD",
            "--output",
            str(destination),
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert invalid.returncode != 0
    assert destination.read_bytes() == expected
    malformed = tmp_path / "malformed.tar.gz"
    malformed.write_bytes(b"not a compressed release")
    rejected = subprocess.run(
        [sys.executable, str(SCRIPT), "verify", str(malformed)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert rejected.returncode != 0
    assert "never-bundle" not in built.stdout + verified.stdout + invalid.stderr


def test_make_bundle_targets_use_the_fixture_commit_and_preserve_output_path_spaces(
    tmp_path, committed_source
):
    repository, sha, _payloads = committed_source
    shutil.copy2(ROOT / "Makefile", repository / "Makefile")
    (repository / "scripts").mkdir()
    shutil.copy2(SCRIPT, repository / "scripts/observability_release.py")
    destination = tmp_path / "artifact directory" / "configuration bundle.tar.gz"
    arguments = [
        "make",
        "--no-print-directory",
        f"OBS_PYTHON={sys.executable}",
        f"OBS_BUNDLE={destination}",
        f"VERSION={sha}",
    ]

    built = subprocess.run(
        [*arguments, "observability-bundle"],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert built.returncode == 0, built.stderr
    assert _release().verify_bundle(destination)["release_sha"] == sha
    verified = subprocess.run(
        [*arguments, "observability-bundle-verify"],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert verified.returncode == 0, verified.stderr

    wrong_revision = subprocess.run(
        [*arguments, "VERSION=" + "a" * 40, "observability-bundle-verify"],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert wrong_revision.returncode != 0
    assert "revision" in wrong_revision.stderr.lower()


def test_verifier_checks_an_independently_supplied_revision(tmp_path, committed_source):
    repository, sha, _ = committed_source
    release = _release()
    destination = tmp_path / "bundle.tar.gz"
    manifest = release.build_bundle(repository, sha, destination)
    assert release.verify_bundle(destination, expected_sha=sha) == manifest
    with pytest.raises(ValueError, match="revision"):
        release.verify_bundle(destination, expected_sha="a" * 40)


def test_corrupt_deflate_is_a_normal_cli_rejection(tmp_path):
    destination = tmp_path / "corrupt.tar.gz"
    destination.write_bytes(bytes.fromhex("1f8b0800000000000003") + b"\xff" * 30)
    with pytest.raises(zlib.error):
        gzip.decompress(destination.read_bytes())
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "verify", str(destination)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 1
    assert "Observability bundle rejected" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "attribute,value", [("mode", 0o755), ("uid", 17), ("mtime", 3), ("uname", "other")]
)
def test_verifier_rejects_noncanonical_member_metadata(
    tmp_path, committed_source, attribute, value
):
    repository, sha, _ = committed_source
    release = _release()
    destination = tmp_path / "bundle.tar.gz"
    release.build_bundle(repository, sha, destination)
    raw = io.BytesIO()
    with (
        tarfile.open(destination, "r:gz") as source,
        tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as target,
    ):
        for index, member in enumerate(source):
            if index == 0:
                setattr(member, attribute, value)
            target.addfile(member, source.extractfile(member))
    destination.write_bytes(gzip.compress(raw.getvalue(), mtime=0))
    with pytest.raises(ValueError, match="metadata"):
        release.verify_bundle(destination)


def test_verifier_rejects_noncanonical_member_order(tmp_path, committed_source):
    repository, sha, _ = committed_source
    release = _release()
    destination = tmp_path / "bundle.tar.gz"
    release.build_bundle(repository, sha, destination)
    raw = io.BytesIO()
    with (
        tarfile.open(destination, "r:gz") as source,
        tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as target,
    ):
        for member in reversed(source.getmembers()):
            target.addfile(member, source.extractfile(member))
    destination.write_bytes(gzip.compress(raw.getvalue(), mtime=0))
    with pytest.raises(ValueError, match="order"):
        release.verify_bundle(destination)


@pytest.mark.parametrize("position", [0, 1, 10, 11])
def test_hidden_gnu_headers_cannot_evade_exact_regular_member_contract(
    tmp_path, committed_source, position
):
    repository, sha, _ = committed_source
    release = _release()
    destination = tmp_path / "bundle.tar.gz"
    release.build_bundle(repository, sha, destination)
    raw = io.BytesIO()
    with (
        tarfile.open(destination, "r:gz") as source,
        tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as target,
    ):
        members = source.getmembers()
        for index in range(len(members) + 1):
            if index == position:
                metadata = tarfile.TarInfo("././@LongLink")
                metadata.type = tarfile.GNUTYPE_LONGNAME
                metadata.mode, metadata.uid, metadata.mtime = 0o777, 42, 123
                content = members[min(index, len(members) - 1)].name.encode() + b"\0"
                metadata.size = len(content)
                target.addfile(metadata, io.BytesIO(content))
            if index < len(members):
                member = members[index]
                target.addfile(member, source.extractfile(member))
    destination.write_bytes(gzip.compress(raw.getvalue(), mtime=0))
    with pytest.raises(ValueError):
        release.verify_bundle(destination)


@pytest.mark.parametrize(
    "defect",
    [
        "mtime",
        "fname",
        "fcomment",
        "second_member",
        "trailing_zeros",
        "trailing_garbage",
    ],
)
def test_verifier_requires_one_canonical_gzip_member(
    tmp_path, committed_source, defect
):
    repository, sha, _ = committed_source
    release = _release()
    destination = tmp_path / "bundle.tar.gz"
    release.build_bundle(repository, sha, destination)
    compressed = destination.read_bytes()
    assert compressed[:10] == bytes.fromhex("1f8b08000000000002ff")
    header, body = compressed[:10], compressed[10:]
    if defect == "mtime":
        compressed = header[:4] + (1).to_bytes(4, "little") + header[8:] + body
    elif defect == "fname":
        compressed = header[:3] + b"\x08" + header[4:] + b"bundle.tar\0" + body
    elif defect == "fcomment":
        compressed = header[:3] + b"\x10" + header[4:] + b"note\0" + body
    elif defect == "second_member":
        compressed += gzip.compress(b"", mtime=0)
    elif defect == "trailing_zeros":
        compressed += b"\0" * 8
    else:
        compressed += b"garbage"
    destination.write_bytes(compressed)
    with pytest.raises(ValueError, match="gzip"):
        release.verify_bundle(destination)
