"""Offline candidate/scaffold and strict consumed managed context path closure."""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator.infra_deploy import _context_root
from scripts.operator_candidate import build
from tests import test_hermes_context as context_fixtures

repo = context_fixtures.repo


def test_candidate_is_exact_committed_sha_and_never_claims_image_verification(
    repo, tmp_path
):
    root, sha = repo
    result = build(root, sha, tmp_path / "candidate")
    assert result["state"] == "source_candidate_only" and result["activated"] is False
    assert result["release_sha"] == sha
    assert set(result["sha256"]) == {
        "source.tar",
        "context.tar.gz",
        "context-manifest.json",
    }
    with pytest.raises(ValueError):
        build(root, sha, tmp_path / "candidate")


@pytest.mark.parametrize(
    "value", ['"/opt/crate-operator"', "/opt/crate-operator", "'/opt/crate-operator'"]
)
def test_root_managed_context_matches_shell_selection(tmp_path, value):
    (tmp_path / ".env").write_bytes(
        (
            "DATA_DIR=/home/user/data\nCRATE_OPERATOR_ROOT=/ignored\nCRATE_OPERATOR_ROOT="
            + value
            + "\n"
        ).encode()
    )
    assert _context_root(tmp_path) == Path("/opt/crate-operator/context")


@pytest.mark.parametrize("value", ["../unsafe", "/opt/bad\r", "/opt/bad\v"])
def test_root_managed_context_rejects_ambiguous_or_relative_configuration(
    tmp_path, value
):
    (tmp_path / ".env").write_bytes(("CRATE_OPERATOR_ROOT=" + value + "\n").encode())
    with pytest.raises(ValueError):
        _context_root(tmp_path)


@pytest.mark.skipif(os.geteuid() != 0, reason="Disposable root container only")
def test_root_scaffold_is_executable_but_never_activates(monkeypatch):
    import tempfile

    from deploy.operator import provision

    with tempfile.TemporaryDirectory(
        prefix="crate-scaffold-", dir="/root"
    ) as temporary:
        root = Path(temporary)
        source = root / "source"
        source.mkdir()
        repository = Path(__file__).resolve().parents[2]
        for name in provision.SOURCE_FILES:
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(repository / name, target)
        for name in ("deploy/hermes", "deploy/operator"):
            shutil.copytree(
                repository / name,
                source / name,
                ignore=shutil.ignore_patterns("__pycache__"),
            )
        monkeypatch.setattr(provision, "ROOT", root / "operator")
        monkeypatch.setattr(provision, "HOST", root / "host")
        result = provision.provision(source)
        assert result["activated"] is False
        assert not (root / "host/.env").exists()
        assert (root / "operator/context/public").is_dir()
        assert (root / "host/.deploy/hermes.compose.yaml").is_file()
        assert not list((root / "operator/secrets").rglob("*token*"))
        with pytest.raises(ValueError):
            provision.provision(source)


def test_resolved_operator_compose_keeps_fast_worker_gate_and_independent_startup(
    tmp_path,
):
    if not shutil.which("docker"):
        pytest.skip(
            "Host Docker Compose parser required; covered by host packaging gate"
        )
    repository = Path(__file__).resolve().parents[2]
    environment = tmp_path / "synthetic.env"
    environment.write_text("""PUID=1000
PGID=1000
TZ=Europe/Madrid
DOMAIN=example.invalid
DATA_DIR=/tmp/crate-task7-data
MEDIA_DIR=/tmp/crate-task7-media
MUSIC_DIR=/tmp/crate-task7-media/music
TRAEFIK_HTTP_PORT=8080
TRAEFIK_HTTPS_PORT=8443
TIDARR_PORT=8484
NGINX_PORT=8081
SLSKD_PORT=5030
SLSKD_LISTEN_PORT=50300
CRATE_FEDERATION_SUBJECT_SECRET=synthetic-federation
CRATE_READPLANE_SERVICE_TOKEN=synthetic-readplane
CRATE_POSTGRES_USER=crate
CRATE_POSTGRES_PASSWORD=synthetic-postgres
CRATE_POSTGRES_DB=crate
REDIS_PASSWORD=synthetic-redis
REDIS_DURABLE_PASSWORD=synthetic-durable
JWT_SECRET=synthetic-jwt
DEFAULT_ADMIN_PASSWORD=synthetic-admin
CRATE_OPERATOR_ROOT=/opt/crate-operator
CRATE_OPERATOR_PRINCIPAL_IDS=00000000-0000-0000-0000-000000000001
CRATE_AGENT_INSTANCE_ID=lab
""")
    known = {line.partition("=")[0] for line in environment.read_text().splitlines()}
    required = set()
    for compose in (
        "docker-compose.yaml",
        "docker-compose.project.yaml",
        "deploy/operator/compose.operator.yaml",
    ):
        required.update(
            re.findall(r"\$\{([A-Z0-9_]+):\?", (repository / compose).read_text())
        )
    with environment.open("a") as output:
        for key in sorted(required - known):
            output.write(key + "=synthetic-value\n")
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(environment),
            "-f",
            "docker-compose.yaml",
            "-f",
            "docker-compose.project.yaml",
            "-f",
            "deploy/operator/compose.operator.yaml",
            "--profile",
            "crate-operator",
            "config",
            "--format",
            "json",
        ],
        cwd=repository,
        env={"PATH": os.environ["PATH"]},
        check=True,
        capture_output=True,
        text=True,
    )
    services = json.loads(result.stdout)["services"]
    for name in ("crate-worker", "crate-fast-worker", "crate-maintenance-worker"):
        service = services[name]
        assert service["environment"]["CRATE_READINESS_ROLE"] == "worker"
        assert service["environment"]["CRATE_OPERATOR_PRINCIPAL_IDS"]
        assert service["healthcheck"]["test"] == [
            "CMD",
            "python3",
            "-m",
            "crate.role_readiness",
        ]
        assert any(
            v["target"] == "/run/crate-provenance" and v["read_only"]
            for v in service["volumes"]
        )
    assert (
        services["crate-fast-worker"]["environment"]["CRATE_READINESS_QUEUES"] == "fast"
    )
    for name in (
        "crate-hermes-operator",
        "crate-infra-relay",
        "crate-operator-supervisor",
    ):
        assert not services[name].get("depends_on")
        assert not services[name].get("ports")


@pytest.mark.parametrize(
    "mode",
    ["valid", "hash", "release", "deployment", "images", "unindexed", "traversal"],
)
def test_approved_context_archive_is_exact_bounded_version_and_file_index(
    tmp_path, mode
):
    import hashlib
    import io
    import tarfile

    from deploy.operator.infra_deploy import validate_context_archive

    raw = b"reviewed source"
    expected = {"release_sha": "a" * 40, "images": {"api": {"source_sha": "b" * 40}}}
    context = {
        "release_sha": expected["release_sha"],
        "deployment": dict(expected),
        "files": {
            "source.txt": {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        },
    }
    if mode == "hash":
        context["files"]["source.txt"]["sha256"] = "0" * 64
    if mode == "release":
        context["release_sha"] = "c" * 40
    if mode == "deployment":
        context["deployment"]["release_sha"] = "c" * 40
    if mode == "images":
        context["deployment"]["images"] = {}
    files = {"context-manifest.json": json.dumps(context).encode(), "source.txt": raw}
    if mode == "unindexed":
        files["extra.txt"] = b"unindexed"
    if mode == "traversal":
        files["../extra.txt"] = b"unsafe"
    path = tmp_path / "bundle.tar.gz"
    with tarfile.open(path, "w:gz") as archive:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    if mode == "valid":
        validate_context_archive(path, expected)
    else:
        with pytest.raises(ValueError):
            validate_context_archive(path, expected)
