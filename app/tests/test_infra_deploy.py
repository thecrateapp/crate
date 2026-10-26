"""Regression gates for actual host trust closure and immutable config transitions."""

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from deploy.operator.infra_deploy import (
    REQUIRED,
    configured_inputs,
    environment_versions,
    host_inputs,
    staged_inputs,
    validate_host,
)
from deploy.operator.infra_executor import Executor, HealthCoverageError, Runner
from tests import test_infra_bridge as shared_fixtures
from tests.test_infra_bridge import FakeCommands, confirm, prepare, release

lab = shared_fixtures.lab


@pytest.mark.parametrize(
    "relative",
    [
        ".env",
        ".deploy/crate-operator.compose.yaml",
        "deploy/hermes/activate_context.py",
        ".deploy/release.env.candidate",
    ],
)
def test_consumed_input_drift_after_review_starts_no_deployment(lab, relative):
    _, manifest = release(lab)
    server = Path(lab.config["server_path"])
    path = server / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("original\n")
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    confirm(lab, plan)
    path.write_text(path.read_text() + "# changed after review\n")
    lab.bridge.tick()
    outcome = lab.bridge.read(lab.keys["read"], plan_id=plan["id"])
    assert outcome["state"] == "invalidated"
    assert not [args for args, _ in lab.runner.calls if args[0] == "/bin/bash"]
    assert "never-return-this" not in json.dumps(plan)


def test_expected_staging_and_env_transition_is_not_rebased(lab):
    root, manifest = release(lab)
    server = Path(lab.config["server_path"])
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    original = plan["document"]["preconditions"]["host_inputs"]
    expected_env = environment_versions((server / ".env").read_bytes(), manifest)[-1]
    result = lab.executor.execute(plan["document"])
    expected = configured_inputs(
        staged_inputs(original, plan["document"]["preconditions"]["assets"]),
        plan["document"]["preconditions"]["assets"],
        expected_env,
    )
    assert result["host_inputs"] == expected == host_inputs(server, provisioned=False)
    assert (server / ".env").read_bytes() == expected_env
    assert (server / ".deploy/release-manifest.json").read_bytes() == (
        root / "release-manifest.json"
    ).read_bytes()
    assert [args[-1] for args, _ in lab.runner.calls if args[0] == "/bin/bash"] == [
        "release-preflight",
        "backup",
        "preflight",
        "config",
        "pull",
        "up",
        "verify",
    ]


def test_external_change_between_stages_stops_without_unreviewed_rollback(lab):
    _, manifest = release(lab)
    server = Path(lab.config["server_path"])
    (server / ".deploy").mkdir()
    overlay = server / ".deploy/crate-operator.compose.yaml"
    overlay.write_text("original")
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    run = lab.runner.run

    def changed(argv, **kwargs):
        result = run(argv, **kwargs)
        if argv[0] == "/bin/bash" and argv[-1] == "config":
            overlay.write_text("unreviewed")
        return result

    lab.runner.run = changed
    confirm(lab, plan)
    lab.bridge.tick()
    assert (
        lab.bridge.read(lab.keys["read"], plan_id=plan["id"])["state"]
        == "indeterminate"
    )
    steps = [args[-1] for args, _ in lab.runner.calls if args[0] == "/bin/bash"]
    assert steps == ["release-preflight", "backup", "preflight", "config"]


@pytest.mark.parametrize(
    "raw",
    [
        b"X=keep\n",
        b"CRATE_IMAGE_TAG=old\nCRATE_IMAGE_TAG=duplicate\nX=keep",
        b"CRATE_IMAGE_OWNER=old\r\nX=keep\r\n",
        b"",
    ],
)
def test_environment_prediction_matches_existing_real_shell_setter(lab, raw):
    _, manifest = release(lab)
    server = Path(lab.config["server_path"])
    (server / ".env").write_bytes(raw)
    script = (
        Path(__file__).resolve().parents[2] / "scripts/deploy-remote.sh"
    ).read_text()
    functions = script[
        script.index("set_env_file_value() {") : script.index("is_release_env_key() {")
    ]
    from scripts.release_manifest import render_release_env

    values = {
        "CRATE_IMAGE_TAG": manifest["release_sha"],
        "CRATE_IMAGE_OWNER": "thecrateapp",
        "CRATE_IMAGE_REGISTRY": "ghcr.io",
        **dict(
            line.split("=", 1) for line in render_release_env(manifest).splitlines()
        ),
    }
    import shlex

    program = (
        functions
        + "\n"
        + "\n".join(
            "set_env_value " + shlex.quote(key) + " " + shlex.quote(value)
            for key, value in values.items()
        )
    )
    subprocess.run(
        ["/bin/bash", "-eu", "-c", program], cwd=server, check=True, capture_output=True
    )
    assert (server / ".env").read_bytes() == environment_versions(raw, manifest)[-1]


@pytest.mark.skipif(
    os.geteuid() != 0,
    reason="Root-owned disposable filesystem fixture in network-none test container",
)
@pytest.mark.parametrize(
    "relative",
    [
        "deploy/hermes/activate_context.py",
        ".deploy/crate-operator.compose.yaml",
        ".deploy/release.env.candidate",
        ".deploy/release-manifest.json",
        ".deploy-backups",
        "data/crate-agent/context/deployment.json",
    ],
)
@pytest.mark.parametrize("bad_kind", ["owner", "writable", "symlink"])
def test_real_startup_rejects_untrusted_descendant_with_trusted_ancestors(
    relative, bad_kind
):
    root = Path("/root") / ("crate-infra-trust-" + uuid.uuid4().hex)
    root.mkdir(mode=0o700)
    try:
        for name in REQUIRED:
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("{}\n")
        (root / "scripts/deploy-remote.sh").write_text(
            "python3 -I deploy/hermes/activate_context.py --root test\n"
        )
        (root / "deploy/hermes/activate_context.py").write_text("import json\n")
        (root / ".env").write_text("DATA_DIR=./data\n")
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative == ".deploy-backups":
            target.mkdir()
        else:
            target.write_text("{}\n")
        assert all(
            path.stat().st_uid == 0 and not path.stat().st_mode & 0o022
            for path in target.parents
        )
        validate_host(root)
        if bad_kind == "owner":
            os.chown(target, 1000, 1000)
        elif bad_kind == "writable":
            target.chmod(0o777 if target.is_dir() else 0o666)
        else:
            if target.is_dir():
                target.rmdir()
            else:
                target.unlink()
            target.symlink_to(root / ".env")
        runner = FakeCommands()
        policy = SimpleNamespace(
            provisioned=True, config={"enabled": True, "server_path": str(root)}
        )
        with pytest.raises(ValueError, match="Root-owned"):
            Executor(policy, runner=runner, real=True)
        assert not runner.calls
    finally:
        shutil.rmtree(root)


def test_isolated_helper_imports_cannot_load_writable_local_shadow(tmp_path):
    helper = tmp_path / "activate_context.py"
    helper.write_text("import json\nprint(json.dumps({'isolated': True}))\n")
    (tmp_path / "json.py").write_text(
        "raise RuntimeError('untrusted local import executed')\n"
    )
    assert json.loads(Runner().run([sys.executable, "-I", str(helper)])) == {
        "isolated": True
    }
    script = (
        Path(__file__).resolve().parents[2] / "scripts/deploy-remote.sh"
    ).read_text()
    assert "python3 deploy/hermes/activate_context.py" not in script
    assert script.count("python3 -I deploy/hermes/activate_context.py") == 4


@pytest.mark.skipif(
    os.environ.get("CRATE_INFRA_DISPOSABLE_TEST") != "1",
    reason="Explicit local compose-config fixture opt-in",
)
def test_real_compose_resolution_uses_host_directory_env_and_active_overlay(lab):
    root, manifest = release(lab)
    server = Path(lab.config["server_path"])
    (server / ".deploy").mkdir()
    overlay = server / ".deploy/crate-operator.compose.yaml"
    overlay.write_text(
        json.dumps(
            {
                "services": {
                    "crate-api": {
                        "environment": {"OVERLAY": "${SYNTHETIC_PASSWORD}"},
                        "volumes": ["./data:/data"],
                    }
                }
            }
        )
    )
    services = {
        service: {
            "image": entry["repository"] + "@" + entry["digest"],
            "healthcheck": {"test": ["CMD", "true"]},
        }
        for entry in manifest["images"].values()
        for service in entry["services"]
    }
    services["crate-fast-worker"] = services["crate-worker"]
    (root / "docker-compose.yaml").write_text(json.dumps({"services": services}))
    (root / "docker-compose.project.yaml").write_text("name: crate\n")
    output = []
    actual = Runner()

    def compose(argv, **kwargs):
        assert argv[:2] == ["/usr/bin/docker", "compose"]
        raw = actual.run(argv, **kwargs)
        output.append(json.loads(raw))
        return raw

    lab.executor.runner = SimpleNamespace(run=compose)
    before = lab.executor._candidate_health(root, manifest)
    assert (
        output[-1]["services"]["crate-api"]["environment"]["OVERLAY"]
        == "never-return-this"
    )
    assert output[-1]["services"]["crate-api"]["volumes"][0]["source"] == str(
        server / "data"
    )
    (server / ".env").write_bytes(
        environment_versions((server / ".env").read_bytes(), manifest)[-1]
    )
    assert lab.executor._candidate_health(root, manifest) == before
    overlay.write_text(
        json.dumps({"services": {"crate-api": {"healthcheck": {"disable": True}}}})
    )
    with pytest.raises(HealthCoverageError) as error:
        lab.executor._candidate_health(root, manifest)
    assert error.value.services == ["crate-api"]


def test_optional_overlay_appearing_after_approval_is_drift(lab):
    _, manifest = release(lab)
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    confirm(lab, plan)
    overlay = Path(lab.config["server_path"]) / ".deploy/crate-operator.compose.yaml"
    overlay.parent.mkdir()
    overlay.write_text("services: {}\n")
    lab.bridge.tick()
    assert (
        lab.bridge.read(lab.keys["read"], plan_id=plan["id"])["state"] == "invalidated"
    )
    assert not [args for args, _ in lab.runner.calls if args[0] == "/bin/bash"]


def test_generated_selection_drift_cannot_be_used_by_up_or_rollback(lab):
    _, manifest = release(lab)
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    run = lab.runner.run

    def changed(argv, **kwargs):
        result = run(argv, **kwargs)
        if argv[0] == "/bin/bash" and argv[-1] == "config":
            path = (
                Path(lab.config["server_path"])
                / ".deploy-backups"
                / ("infra-" + plan["id"])
                / "changed_services"
            )
            path.write_text("unreviewed-service\n")
        return result

    lab.runner.run = changed
    confirm(lab, plan)
    lab.bridge.tick()
    assert (
        lab.bridge.read(lab.keys["read"], plan_id=plan["id"])["state"]
        == "indeterminate"
    )
    assert not [
        args
        for args, _ in lab.runner.calls
        if args[0] == "/bin/bash" and args[-1] in {"up", "rollback"}
    ]


@pytest.mark.parametrize(
    "image",
    [
        "postgres:15@sha256:" + "a" * 64,
        "pgvector/pgvector:pg16@sha256:" + "a" * 64,
        "untrusted/pgvector:pg15@sha256:" + "a" * 64,
        "pgvector/pgvector:pg15",
    ],
)
def test_restore_policy_rejects_incompatible_or_mutable_images(lab, image):
    lab.config["postgres_image"] = image
    lab.path.write_text(json.dumps(lab.config))
    with pytest.raises(ValueError, match="Pinned pgvector"):
        lab.policy.load()


def test_host_helper_import_closure_and_isolated_invocation_are_enforced(
    lab, monkeypatch
):
    from deploy.operator import infra_deploy

    release(lab)
    root = Path(lab.config["server_path"])
    # Ownership has separate actual-root tests; isolate this dependency-closure gate.
    monkeypatch.setattr(infra_deploy, "trusted_file", lambda path: Path(path))
    helper = root / "deploy/hermes/activate_context.py"
    helper.write_text("import unreviewed_local_helper\n")
    with pytest.raises(ValueError, match="import dependency"):
        validate_host(root)
    helper.write_text("import json\n")
    (root / "scripts/deploy-remote.sh").write_text(
        "python3 deploy/hermes/activate_context.py --root test\n"
    )
    with pytest.raises(ValueError, match="isolated Python"):
        validate_host(root)

    (root / "scripts/deploy-remote.sh").write_text(
        "python3 -I deploy/hermes/activate_context.py --root test\n"
        "python3 - marker.json <<'PY'\nimport json\nPY\n"
    )
    with pytest.raises(ValueError, match="isolated Python"):
        validate_host(root)


def _shell_data_dir(root):
    """Execute only the repository's actual selector, never a deployment step."""
    script = (
        Path(__file__).resolve().parents[2] / "scripts/deploy-remote.sh"
    ).read_text()
    function = script.split("env_file_value() {", 1)[1].split("\n}\n", 1)[0]
    return subprocess.run(
        [
            "/bin/bash",
            "-eu",
            "-c",
            "env_file_value() {" + function + "\n}\nenv_file_value .env DATA_DIR",
        ],
        cwd=root,
        check=True,
        capture_output=True,
        env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
    ).stdout


@pytest.mark.parametrize(
    "raw",
    [
        b"DATA_DIR=./data\n",
        b'DATA_DIR="./data with spaces"\n',
        b"DATA_DIR='./single'\n",
        b"DATA_DIR=./first\nDATA_DIR='./last'\n",
        b"DATA_DIR=./no-final-newline",
        "DATA_DIR=./unicode\u0085separator\u2028path\n".encode(),
        b"OTHER=value\n",
    ],
)
def test_context_destination_matches_actual_shell_normal_values(tmp_path, raw):
    from deploy.operator.infra_deploy import _context_root

    (tmp_path / ".env").write_bytes(raw)
    selected = _shell_data_dir(tmp_path).decode("utf-8")
    expected = Path(selected + "/crate-agent/context")
    if not expected.is_absolute():
        expected = tmp_path / expected
    assert _context_root(tmp_path) == expected


@pytest.mark.parametrize(
    "raw",
    [
        b"DATA_DIR=./data\r\n",
        b"DATA_DIR=./data\vother\n",
        b"DATA_DIR=./data\x1cother\n",
        b"OTHER=\0\nDATA_DIR=./data\n",
        b"DATA_DIR=./data\xff\n",
    ],
)
def test_context_destination_rejects_unsupported_bytes(tmp_path, raw):
    from deploy.operator.infra_deploy import _context_root

    (tmp_path / ".env").write_bytes(raw)
    with pytest.raises(ValueError):
        _context_root(tmp_path)


@pytest.mark.skipif(os.geteuid() != 0, reason="Disposable root filesystem fixture")
@pytest.mark.parametrize(
    "raw",
    [
        b"DATA_DIR=./data\r\n",
        b"DATA_DIR=./data\vother\n",
        b"DATA_DIR=./data\x1cother\n",
        b'DATA_DIR="./quoted data"\n',
        b"DATA_DIR=./ignored\nDATA_DIR='./last'\n",
        "DATA_DIR=./unicode\u0085separator\u2028path\n".encode(),
    ],
)
def test_startup_rejects_actual_shell_selected_untrusted_destination(raw):
    root = Path("/root") / ("crate-infra-context-" + uuid.uuid4().hex)
    root.mkdir(mode=0o700)
    try:
        for name in REQUIRED:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}\n")
        (root / "scripts/deploy-remote.sh").write_text(
            "python3 -I deploy/hermes/activate_context.py --root test\n"
        )
        (root / "deploy/hermes/activate_context.py").write_text("import json\n")
        (root / ".env").write_bytes(raw)
        selected = _shell_data_dir(root).decode("utf-8")
        target = root / selected / "crate-agent/context/deployment.json"
        target.parent.mkdir(parents=True)
        target.write_text("{}\n")
        assert all(path.stat().st_uid == 0 for path in target.parents)
        if not any(ord(character) < 32 for character in selected):
            validate_host(root)
        os.chown(target, 1000, 1000)
        runner = FakeCommands()
        policy = SimpleNamespace(
            provisioned=True, config={"enabled": True, "server_path": str(root)}
        )
        with pytest.raises(ValueError, match="Root-owned|control character"):
            Executor(policy, runner=runner, real=True)
        assert not runner.calls
    finally:
        shutil.rmtree(root)


def test_operator_deploy_seals_staged_bundle_and_activates_context_after_verify(lab):
    import hashlib
    import tarfile

    root, manifest = release(lab)
    server = Path(lab.config["server_path"])
    with (server / ".env").open("a") as stream:
        stream.write("\nCRATE_OPERATOR_ROOT=/opt/crate-operator\n")
    context = root / "context"
    context.mkdir()
    (context / "context-manifest.json").write_text(
        json.dumps(
            {
                "release_sha": manifest["release_sha"],
                "deployment": manifest,
                "files": {},
            }
        )
    )
    with tarfile.open(root / "agent-context.tar.gz", "w:gz") as archive:
        archive.add(context / "context-manifest.json", arcname="context-manifest.json")
    approval = json.loads((root / "approved.json").read_text())
    approval["agent-context.tar.gz"] = hashlib.sha256(
        (root / "agent-context.tar.gz").read_bytes()
    ).hexdigest()
    (root / "approved.json").write_text(json.dumps(approval))
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    result = lab.executor.execute(plan["document"])
    assert (
        result["host_inputs"][".deploy/agent-context.candidate.tar.gz"]
        == approval["agent-context.tar.gz"]
    )
    stages = [args[-1] for args, _ in lab.runner.calls if args[0] == "/bin/bash"]
    assert stages[-2:] == ["verify", "agent-context"]


def test_operator_deploy_rejects_missing_context_before_effects(lab):
    _root, manifest = release(lab)
    server = Path(lab.config["server_path"])
    with (server / ".env").open("a") as stream:
        stream.write("\nCRATE_OPERATOR_ROOT=/opt/crate-operator\n")
    with pytest.raises((OSError, ValueError)):
        prepare(
            lab, operation="deploy", target="crate", version=manifest["release_sha"]
        )
    assert not [args for args, _ in lab.runner.calls if args[0] == "/bin/bash"]
