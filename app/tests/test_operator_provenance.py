"""Stable reviewed identity plus fresh evidence; no mutable caller flag."""

import json
import sys
import time
from pathlib import Path

import pytest
from crate import operator_provenance as provenance
from crate.agent_diagnostics import DiagnosticError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


@pytest.fixture(autouse=True)
def instance(monkeypatch):
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "test-instance")


def evidence(root, *, principal="operator"):
    root.mkdir(exist_ok=True)
    identity = {
        "instance_id": "test-instance",
        "release_sha": "a" * 40,
        "context_sha256": "b" * 64,
        "images": {
            "crate-api": {
                "reference": "ghcr.io/thecrateapp/crate-api@sha256:" + "c" * 64,
                "source_sha": "a" * 40,
                "image_id": "sha256:" + "d" * 64,
            }
        },
    }
    for name, value in {
        "target.json": identity,
        "observation.json": {
            "state": "verified",
            "observed_at": time.time(),
            "identity": identity,
        },
        "deployment.json": {
            "state": "verified",
            "release_sha": identity["release_sha"],
        },
        "context.json": {"context_sha256": identity["context_sha256"]},
    }.items():
        (root / name).write_text(json.dumps(value))
    return identity


def drift(root, mode):
    path = root / "observation.json"
    value = json.loads(path.read_text())
    if mode == "missing":
        path.unlink()
        return
    if mode == "stale":
        value["observed_at"] -= 1000
    elif mode in {"rollback", "deploying", "unverified"}:
        path = root / "deployment.json"
        value = {"state": mode, "release_sha": "a" * 40}
    elif mode == "context":
        path = root / "context.json"
        value = {"context_sha256": "f" * 64}
    elif mode == "identity":
        value["identity"]["release_sha"] = "f" * 40
    path.write_text(json.dumps(value))


@pytest.mark.parametrize(
    "mode",
    ["missing", "stale", "rollback", "deploying", "unverified", "context", "identity"],
)
def test_current_evidence_drift_denies_without_disabling_legacy(
    tmp_path, monkeypatch, mode
):
    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    monkeypatch.setattr(provenance, "EVIDENCE", tmp_path)
    monkeypatch.setenv("CRATE_OPERATOR_PRINCIPAL_IDS", "operator")
    reviewed = evidence(tmp_path)
    assert provenance.capture("operator") == reviewed
    drift(tmp_path, mode)
    with pytest.raises(DiagnosticError):
        provenance.validate("operator", reviewed)
    assert provenance.capture("legacy") is None
    provenance.validate("legacy", None)
    assert provenance.observation()["availability"] == "unavailable"


def test_timestamp_refresh_is_not_identity_and_bound_plans_survive_principal_removal(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    monkeypatch.setattr(provenance, "EVIDENCE", tmp_path)
    monkeypatch.setenv("CRATE_OPERATOR_PRINCIPAL_IDS", "operator")
    reviewed = evidence(tmp_path)
    assert provenance.observation()["availability"] == "available"
    time.sleep(0.01)
    evidence(tmp_path)
    provenance.validate("operator", reviewed)
    monkeypatch.delenv("CRATE_OPERATOR_PRINCIPAL_IDS")
    drift(tmp_path, "identity")
    with pytest.raises(DiagnosticError):
        provenance.validate("operator", reviewed)


def test_public_identity_cannot_belong_to_another_server(tmp_path, monkeypatch):
    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    monkeypatch.setattr(provenance, "EVIDENCE", tmp_path)
    evidence(tmp_path)
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "other-instance")
    with pytest.raises(DiagnosticError):
        provenance.current_identity()


@pytest.mark.parametrize(
    "malformed",
    [
        [],
        {"crate-api": {}},
        {
            "crate-api": {
                "reference": "other:latest",
                "image_id": "sha256:" + "a" * 64,
                "source_sha": "b" * 40,
            }
        },
    ],
)
def test_malformed_public_image_evidence_is_unavailable(
    tmp_path, monkeypatch, malformed
):
    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    monkeypatch.setattr(provenance, "EVIDENCE", tmp_path)
    evidence(tmp_path)
    for name in ("target.json", "observation.json"):
        value = json.loads((tmp_path / name).read_text())
        (value.get("identity") or value)["images"] = malformed
        (tmp_path / name).write_text(json.dumps(value))
    assert provenance.observation()["availability"] == "unavailable"
    with pytest.raises(DiagnosticError):
        provenance.current_identity()


def test_inventory_publishes_only_fresh_actual_image_identity_with_source_time(
    tmp_path, monkeypatch
):
    pytest.importorskip("mcp_types")
    from crate import agent_observability

    monkeypatch.setattr(provenance, "ROOT", tmp_path)
    monkeypatch.setattr(provenance, "EVIDENCE", tmp_path)
    identity = evidence(tmp_path)
    monkeypatch.setattr(agent_observability, "_load", lambda: ({}, None))
    data = agent_observability.get_instance_inventory()["data"]
    assert data["release_sha"] == identity["release_sha"]
    assert data["context_version"] == identity["context_sha256"]
    image = data["services"]["crate-api"]
    assert image["live_image_verified"] is True
    assert image["image_id"] == identity["images"]["crate-api"]["image_id"]
    assert image["image_provenance_observed_at"]
    assert (
        image["image_digest_reference"] == identity["images"]["crate-api"]["reference"]
    )
    # No stored fleet/service health is fabricated by live image provenance.
    assert image["availability"] == "unavailable"
    drift(tmp_path, "rollback")
    data = agent_observability.get_instance_inventory()["data"]
    assert data["release_sha"] is None
    assert data["services"]["crate-api"]["live_image_verified"] is False


SELF = "f" * 64
AGENT_SHA = "1" * 40
SERVICE_SHA = "2" * 40


class FakeDocker:
    """The filtered Docker API: container listing and image inspection only."""

    def __init__(self, project="crate"):
        self.containers, self.images, self.paths = [], {}, []
        self.run(
            "crate-provenance",
            "crate-agent",
            AGENT_SHA,
            container=SELF,
            project=project,
        )

    def run(
        self,
        service,
        repository,
        source,
        *,
        container=None,
        project="crate",
        refs=None,
        state="running",
    ):
        index = len(self.containers) + 1
        image = f"sha256:{index:064x}"
        digest = f"sha256:{index + 100:064x}"
        self.containers.append(
            {
                "Id": container or f"{index:064x}",
                "ImageID": image,
                "State": state,
                "Labels": {
                    "com.docker.compose.project": project,
                    "com.docker.compose.service": service,
                },
            }
        )
        self.images[image] = {
            "Id": image,
            "RepoDigests": (
                [f"ghcr.io/thecrateapp/{repository}@{digest}"] if refs is None else refs
            ),
            "Config": {"Labels": {"org.opencontainers.image.revision": source}},
        }
        return image, f"ghcr.io/thecrateapp/{repository}@{digest}"

    def get(self, path, limit=None):
        self.paths.append(path)
        if path == "/containers/json":
            return self.containers
        return self.images[path.removeprefix("/images/").removesuffix("/json")]


class FakeRegistry:
    def __init__(self):
        self.official = set()

    def has(self, repository, digest):
        return (repository, digest) in self.official


def _fleet(docker, registry, **overrides):
    """A new instance: every executor plus the UI, all pulled from GHCR."""
    from deploy.operator.provenance import EXECUTORS, FLEET

    for service in (*EXECUTORS, "crate-ui"):
        options = dict(overrides.get(service, {}))
        source = options.pop("source", SERVICE_SHA)
        image, reference = docker.run(service, FLEET[service], source, **options)
        repository, digest = reference.removeprefix("ghcr.io/thecrateapp/").split("@")
        registry.official.add((repository, digest))
    agent = docker.images[docker.containers[0]["ImageID"]]["RepoDigests"][0]
    registry.official.add(tuple(agent.removeprefix("ghcr.io/thecrateapp/").split("@")))


def _baked(tmp_path, release=AGENT_SHA):
    baked = tmp_path / "baked"
    baked.mkdir(exist_ok=True)
    (baked / "context-manifest.json").write_text(
        json.dumps({"release_sha": release, "deployment": {"release_sha": release}})
    )
    return baked


def _publish(tmp_path, docker, registry, **kwargs):
    from deploy.operator.provenance import publish

    (tmp_path / "context/public").mkdir(parents=True, exist_ok=True)
    return publish(
        docker,
        tmp_path / "evidence",
        instance_id="test-instance",
        hostname=SELF[:12],
        registry=registry,
        context_root=tmp_path / "context",
        baked_context=kwargs.pop("baked", None) or _baked(tmp_path),
        **kwargs,
    )


@pytest.fixture
def verifier(tmp_path, monkeypatch):
    monkeypatch.setattr(provenance, "ROOT", tmp_path / "context/public")
    monkeypatch.setattr(provenance, "EVIDENCE", tmp_path / "evidence")
    monkeypatch.setenv("CRATE_OPERATOR_PRINCIPAL_IDS", "operator")
    return provenance


def test_container_evidence_for_official_ghcr_images_opens_changes(tmp_path, verifier):
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry)
    docker.run("crate-api", "crate-api", SERVICE_SHA, project="other-stack")
    docker.run("crate-postgres", "postgres", SERVICE_SHA, refs=[])
    result = _publish(tmp_path, docker, registry)
    assert result["state"] == "verified" and result["mode"] == "image"
    identity = verifier.capture("operator")
    assert identity == result["identity"]
    assert identity["release_sha"] == AGENT_SHA
    assert set(identity["images"]) == {
        "crate-api",
        "crate-worker",
        "crate-fast-worker",
        "crate-maintenance-worker",
        "crate-analysis-worker",
        "crate-ui",
    }
    assert identity["images"]["crate-api"]["source_sha"] == SERVICE_SHA
    assert verifier.observation()["availability"] == "available"
    # Container inspection (environment, secrets) is never requested.
    assert all(
        path == "/containers/json" or path.startswith("/images/sha256:")
        for path in docker.paths
    )
    verifier.validate("operator", identity)


@pytest.mark.parametrize(
    "local",
    [
        {"crate-api": {"refs": []}},
        {
            "crate-worker": {
                "refs": ["ghcr.io/thecrateapp/crate-worker@sha256:" + "e" * 64]
            }
        },
        {"crate-api": {"refs": ["ghcr.io/someone/crate-api@sha256:" + "e" * 64]}},
        {"crate-analysis-worker": {"state": "exited"}},
    ],
    ids=["no-registry-digest", "unknown-digest", "foreign-repo", "executor-down"],
)
def test_container_evidence_refuses_local_builds(tmp_path, verifier, local):
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry, **local)
    if "unknown-digest" in str(local):
        registry.official.discard(("crate-worker", "sha256:" + "e" * 64))
    result = _publish(tmp_path, docker, registry)
    assert result["state"] == "unverified" and result["identity"] is None
    assert verifier.observation()["availability"] == "unavailable"
    with pytest.raises(DiagnosticError) as error:
        verifier.capture("operator")
    assert error.value.code == "EVIDENCE_STALE"


def test_a_locally_built_publisher_or_unlabelled_image_keeps_changes_closed(
    tmp_path, verifier
):
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry)
    registry.official = {item for item in registry.official if item[0] != "crate-agent"}
    assert _publish(tmp_path, docker, registry)["reason"] == (
        "unofficial_image:crate-provenance"
    )
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry, **{"crate-ui": {"source": None}})
    assert _publish(tmp_path, docker, registry)["state"] == "unverified"
    with pytest.raises(DiagnosticError):
        verifier.current_identity()


def test_a_baked_context_from_another_release_is_refused(tmp_path, verifier):
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry)
    result = _publish(tmp_path, docker, registry, baked=_baked(tmp_path, "9" * 40))
    assert result["reason"] == "context_mismatch"


def test_stale_container_evidence_closes_changes_and_fails_health(tmp_path, verifier):
    from deploy.operator.provenance import healthy

    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry)
    reviewed = _publish(tmp_path, docker, registry)["identity"]
    assert healthy(tmp_path / "evidence")
    stale = _publish(tmp_path, docker, registry, now=time.time() - 91)
    assert stale["state"] == "verified"
    with pytest.raises(DiagnosticError):
        verifier.validate("operator", reviewed)
    assert not healthy(tmp_path / "evidence")
    _publish(tmp_path, docker, registry)
    verifier.validate("operator", reviewed)


def test_an_image_change_invalidates_plans_bound_to_the_previous_fleet(
    tmp_path, verifier
):
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry)
    reviewed = _publish(tmp_path, docker, registry)["identity"]
    api = next(
        c
        for c in docker.containers
        if c["Labels"]["com.docker.compose.service"] == "crate-api"
    )
    image, reference = docker.run("crate-api", "crate-api", "3" * 40, project="spare")
    registry.official.add(
        tuple(reference.removeprefix("ghcr.io/thecrateapp/").split("@"))
    )
    api["ImageID"] = image
    assert _publish(tmp_path, docker, registry)["state"] == "verified"
    with pytest.raises(DiagnosticError):
        verifier.validate("operator", reviewed)


def test_a_deploy_marker_closes_image_mode_evidence_immediately(tmp_path, verifier):
    docker, registry = FakeDocker(), FakeRegistry()
    _fleet(docker, registry)
    reviewed = _publish(tmp_path, docker, registry)["identity"]
    verifier.validate("operator", reviewed)
    public = tmp_path / "context/public"
    (public / "deployment.json").write_text(
        json.dumps({"release_sha": AGENT_SHA, "state": "deploying"})
    )
    with pytest.raises(DiagnosticError):
        verifier.validate("operator", reviewed)
    (tmp_path / "context/deployment.json").write_text(
        json.dumps({"release_sha": AGENT_SHA, "state": "deploying"})
    )
    result = _publish(tmp_path, docker, registry)
    assert result["reason"] == "deployment_not_verified"
    assert not (tmp_path / "evidence/deployment.json").exists()


def _release(tmp_path, docker, registry):
    from scripts.release_manifest import IMAGE_SPECS, assemble_manifest

    previous = assemble_manifest(
        release_sha="b" * 40,
        changed_digests={
            name: "sha256:" + str(i % 10) * 64 for i, name in enumerate(IMAGE_SPECS)
        },
        previous=None,
        registry="ghcr.io",
        owner="thecrateapp",
    )
    manifest = assemble_manifest(
        release_sha="a" * 40,
        changed_digests={"api": "sha256:" + "c" * 64},
        previous=previous,
        registry="ghcr.io",
        owner="thecrateapp",
    )
    context = tmp_path / "context"
    (context / "public").mkdir(parents=True)
    (context / "releases/a").mkdir(parents=True)
    (context / "active").symlink_to("releases/a")
    (context / "deployment.json").write_text(
        json.dumps({**manifest, "state": "verified"})
    )
    (context / "active/context-manifest.json").write_text(
        json.dumps({"release_sha": "a" * 40, "deployment": manifest})
    )
    (context / "public/deployment.json").write_text(
        json.dumps({"release_sha": "a" * 40, "state": "verified"})
    )
    import hashlib

    (context / "public/context.json").write_text(
        json.dumps(
            {
                "context_sha256": hashlib.sha256(
                    (context / "active/context-manifest.json").read_bytes()
                ).hexdigest()
            }
        )
    )
    for name, entry in manifest["images"].items():
        for service in set(entry["services"]) | (
            {"crate-fast-worker"} if name == "worker" else set()
        ):
            docker.run(
                service,
                entry["repository"].rsplit("/", 1)[1],
                entry["source_sha"],
                refs=[entry["repository"] + "@" + entry["digest"]],
            )
    agent = docker.images[docker.containers[0]["ImageID"]]["RepoDigests"][0]
    registry.official.add(tuple(agent.removeprefix("ghcr.io/thecrateapp/").split("@")))
    return manifest


def test_release_mode_requires_the_exact_manifest_digest_of_every_service(
    tmp_path, verifier
):
    docker, registry = FakeDocker(), FakeRegistry()
    manifest = _release(tmp_path, docker, registry)
    result = _publish(tmp_path, docker, registry)
    assert result["state"] == "verified" and result["mode"] == "release"
    identity = verifier.capture("operator")
    assert identity["release_sha"] == manifest["release_sha"]
    assert (
        identity["images"]["crate-fast-worker"]["reference"]
        == (identity["images"]["crate-worker"]["reference"])
    )
    api = next(
        image
        for image in docker.images.values()
        if image["RepoDigests"][0].endswith("c" * 64)
    )
    api["RepoDigests"] = ["ghcr.io/thecrateapp/crate-api@sha256:" + "e" * 64]
    assert _publish(tmp_path, docker, registry)["reason"] == (
        "release_mismatch:crate-api"
    )
    with pytest.raises(DiagnosticError):
        verifier.capture("operator")


def test_registry_proves_digests_and_fails_closed(monkeypatch):
    import io
    import urllib.error

    from deploy.operator.provenance import Registry, Unverified

    calls = []

    class Response(io.BytesIO):
        def __init__(self, body=b"", status=200, digest=None):
            super().__init__(body)
            self.status, self.headers = status, {"Docker-Content-Digest": digest}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    digest = "sha256:" + "a" * 64
    answers = {"present": digest}

    def opener(request, timeout):
        url = request if isinstance(request, str) else request.full_url
        calls.append(url)
        if "/token?" in url:
            return Response(json.dumps({"token": "anonymous"}).encode())
        if answers.get("mode") == "offline":
            raise urllib.error.URLError("offline")
        if url.endswith(digest):
            return Response(digest=digest)
        raise urllib.error.HTTPError(url, 404, "missing", {}, None)

    registry = Registry(opener)
    assert registry.has("crate-api", digest)
    assert calls[-1] == f"https://ghcr.io/v2/thecrateapp/crate-api/manifests/{digest}"
    assert not registry.has("crate-api", "sha256:" + "b" * 64)
    answers["mode"] = "offline"
    count = len(calls)
    assert registry.has("crate-api", digest)  # content-addressed, cached
    assert len(calls) == count
    with pytest.raises(Unverified):
        registry.has("crate-worker", digest)


def test_an_unreachable_docker_filter_publishes_unverified_evidence(tmp_path):
    from deploy.operator.provenance import DockerAPI

    with pytest.raises(ValueError):
        DockerAPI("unix:///var/run/docker.sock")
    docker = DockerAPI("http://127.0.0.1:9")
    result = _publish(tmp_path, docker, FakeRegistry())
    assert result == {
        "state": "unverified",
        "reason": "docker_unavailable",
        "observed_at": result["observed_at"],
        "identity": None,
    }
