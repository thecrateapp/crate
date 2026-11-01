from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _module():
    path = ROOT / "scripts/application_orphans.py"
    assert path.is_file(), "Explicit orphan review tool is required"
    spec = importlib.util.spec_from_file_location("application_orphans_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _container(service, *, project="crate", oneoff=False, identity="a" * 64):
    return {
        "Id": identity,
        "Name": "/" + service,
        "Config": {
            "Image": "fixture:old",
            "Labels": {
                "com.docker.compose.project": project,
                "com.docker.compose.service": service,
                "com.docker.compose.oneoff": str(oneoff),
            },
        },
        "State": {"Running": True},
    }


def test_orphan_review_excludes_declared_foreign_unmanaged_and_protected_services():
    module = _module()
    containers = [
        _container("crate-old-service"),
        _container("crate-api"),
        _container("foreign", project="other"),
        _container("unmanaged", project=""),
        _container("one-off", oneoff=True),
        *[
            _container(name)
            for name in (
                "crate-prometheus",
                "crate-grafana",
                "crate-cadvisor",
                "crate-node-exporter",
                "crate-postgres-exporter",
                "crate-redis-exporter",
                "crate-redis-durable-exporter",
                "crate-observability-docker-proxy",
                "crate-agent",
                "crate-operator",
                "crate-infra-relay",
            )
        ],
    ]
    result = module.classify_orphans(
        {"name": "crate", "services": {"crate-api": {}}}, containers
    )
    assert [item["service"] for item in result] == ["crate-old-service"]
    assert result[0]["id"] == "a" * 64


@pytest.mark.parametrize(
    "configuration",
    [{}, {"name": "", "services": {}}, {"name": "crate", "services": []}],
)
def test_invalid_inventory_does_not_become_an_empty_application(configuration):
    with pytest.raises(ValueError):
        _module().classify_orphans(configuration, [_container("crate-api")])


@pytest.mark.parametrize(
    "requested,confirmed,success",
    [
        (None, False, True),
        ("a" * 64, True, True),
        ("a" * 64, False, False),
        ("a" * 12, True, False),
        ("b" * 64, True, False),
    ],
)
def test_orphan_cli_is_read_only_until_exact_current_ids_are_confirmed(
    tmp_path, monkeypatch, capsys, requested, confirmed, success
):
    module = _module()
    calls = []
    (tmp_path / "docker-compose.yaml").write_text("fixture")

    def run(command, **kwargs):
        calls.append(command)
        if "config" in command:
            value = {"name": "crate", "services": {"crate-api": {}}}
        elif "ps" in command:
            return subprocess.CompletedProcess(command, 0, "a" * 64 + "\n", "")
        elif "inspect" in command:
            value = [_container("crate-old-service")]
        else:
            value = []
        return subprocess.CompletedProcess(command, 0, json.dumps(value), "")

    monkeypatch.setattr(module.subprocess, "run", run)
    arguments = [
        "--project-directory",
        str(tmp_path),
        "--compose-file",
        "docker-compose.yaml",
    ]
    arguments += (
        ["audit"]
        if requested is None
        else ["retire", requested] + (["--confirm-retirement"] if confirmed else [])
    )
    if requested is not None:
        arguments += [
            "--expected-config-sha256",
            hashlib.sha256(
                json.dumps(
                    {"name": "crate", "services": {"crate-api": {}}},
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest(),
        ]
    assert (module.main(arguments) == 0) is success
    removals = [call for call in calls if "rm" in call]
    assert bool(removals) is (requested is not None and success)
    if removals:
        assert removals == [["docker", "rm", "-f", "--", "a" * 64]]
    assert "Labels" not in capsys.readouterr().out


@pytest.mark.parametrize(
    "defect", ["changed-config", "wrong-digest", "inventory-failure", "changed-labels"]
)
def test_retirement_rejects_changed_authority_and_failed_inventory(
    tmp_path, monkeypatch, defect
):
    module = _module()
    calls = []
    (tmp_path / "docker-compose.yaml").write_text("fixture")
    configuration = {"name": "crate", "services": {"crate-api": {}}}
    config_reads = 0
    inspect_reads = 0

    def run(command, **kwargs):
        nonlocal config_reads, inspect_reads
        calls.append(command)
        if "config" in command:
            config_reads += 1
            value = (
                configuration
                if config_reads == 1 or defect != "changed-config"
                else {**configuration, "services": {"crate-api": {}, "other": {}}}
            )
        elif "ps" in command:
            return subprocess.CompletedProcess(command, 0, "a" * 64 + "\n", "")
        else:
            inspect_reads += 1
            if defect == "inventory-failure":
                return subprocess.CompletedProcess(
                    command, 1, "", "private failure details"
                )
            value = [
                _container(
                    "crate-old-service",
                    project="foreign"
                    if defect == "changed-labels" and inspect_reads == 2
                    else "crate",
                )
            ]
        return subprocess.CompletedProcess(command, 0, json.dumps(value), "")

    monkeypatch.setattr(module.subprocess, "run", run)
    digest = hashlib.sha256(
        json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    if defect == "wrong-digest":
        digest = "0" * 64
    assert (
        module.main(
            [
                "--project-directory",
                str(tmp_path),
                "--compose-file",
                "docker-compose.yaml",
                "retire",
                "a" * 64,
                "--confirm-retirement",
                "--expected-config-sha256",
                digest,
            ]
        )
        == 1
    )
    assert not any("rm" in command for command in calls)
