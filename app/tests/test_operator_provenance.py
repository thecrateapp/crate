"""Stable reviewed identity plus fresh evidence; no mutable caller flag."""

import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

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
    evidence(tmp_path)
    monkeypatch.setenv("CRATE_AGENT_INSTANCE_ID", "other-instance")
    with pytest.raises(DiagnosticError):
        provenance.current_identity()


def test_host_publisher_accepts_mixed_source_release_and_denies_actual_digest_mismatch(
    tmp_path, monkeypatch
):
    from deploy.operator.provenance import publish
    from scripts.release_manifest import IMAGE_SPECS, assemble_manifest

    sha = "a" * 40
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
        release_sha=sha,
        changed_digests={"api": "sha256:" + "c" * 64},
        previous=previous,
        registry="ghcr.io",
        owner="thecrateapp",
    )
    context = tmp_path / "context"
    (context / "active").mkdir(parents=True)
    (context / "deployment.json").write_text(
        json.dumps({**manifest, "state": "verified"})
    )
    (context / "active/context-manifest.json").write_text(
        json.dumps({"release_sha": sha, "deployment": manifest})
    )
    mapping = {}
    for name, entry in manifest["images"].items():
        for service in set(entry["services"]) | (
            {"crate-fast-worker"} if name == "worker" else set()
        ):
            mapping[service] = {
                "image": "sha256:" + "c" * 64,
                "image_provenance": {
                    "availability": "available",
                    "repo_digests": [entry["repository"] + "@" + entry["digest"]],
                    "source_sha": entry["source_sha"],
                },
            }
    executor = SimpleNamespace(
        c={"instance": "test-instance"}, inspect=lambda service, **kw: mapping[service]
    )
    result = publish(executor, context, tmp_path / "public")
    assert result["state"] == "verified"
    assert (
        result["identity"]["images"]["crate-fast-worker"]
        == result["identity"]["images"]["crate-worker"]
    )
    mapping["crate-api"]["image_provenance"]["repo_digests"] = ["unexpected"]
    assert publish(executor, context, tmp_path / "public")["state"] == "unverified"


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
