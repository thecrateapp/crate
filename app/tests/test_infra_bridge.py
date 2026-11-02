"""Independent host boundary tests; all production command execution is fake."""

import asyncio
import hashlib
import hmac
import http.client
import json
import os
import socket
import sys
import threading
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from deploy.operator import infra_mcp
from deploy.operator.infra_executor import CommandError, Executor, Runner
from deploy.operator.infra_plans import NATIVE_PATH, Bridge
from deploy.operator.infra_policy import (
    SERVICES,
    Policy,
    canonical,
    trusted_file,
)
from deploy.operator.infra_server import UnixServer, handler
from deploy.operator.state import State
from scripts.release_manifest import IMAGE_SPECS, assemble_manifest, render_release_env

BASE = 1800000000


class FakeCommands:
    def __init__(self):
        self.calls = []
        self.started = "before"
        self.healthy = True
        self.project = "crate"
        self.healthcheck = True
        self.candidate_health = True
        self.fail = None
        self.block = None
        self.images = {}

    def run(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        if self.fail and self.fail in argv:
            raise CommandError("synthetic-secret-must-not-escape")
        if "restart" in argv:
            if self.block:
                self.block.wait(3)
            self.started = "after"
        if argv[1:3] == ["image", "inspect"]:
            return json.dumps(
                [
                    self.images.get(
                        argv[3],
                        {"Id": argv[3], "RepoDigests": [], "Config": {"Labels": {}}},
                    )
                ]
            ).encode()
        if argv[1] == "inspect":
            service = argv[-1]
            return json.dumps(
                [
                    {
                        "Id": "id-" + service,
                        "Image": "sha256:old",
                        "Config": {
                            "Healthcheck": {"Test": ["CMD", "true"]}
                            if self.healthcheck
                            else {},
                            "Labels": {
                                "com.docker.compose.project": self.project,
                                "com.docker.compose.service": service,
                            },
                        },
                        "State": {
                            "StartedAt": self.started,
                            "Running": True,
                            "Health": {
                                "Status": "healthy" if self.healthy else "unhealthy"
                            },
                        },
                    }
                ]
            ).encode()
        if argv[1] == "compose":
            return json.dumps(
                {
                    "services": {
                        service: {
                            "healthcheck": {"test": ["CMD", "true"]}
                            if self.candidate_health
                            else {}
                        }
                        for service in SERVICES
                    }
                }
            ).encode()
        if "pg_dump" in argv:
            kwargs["output"].write(b"disposable-custom-dump")
        if "psql" in argv:
            if "pg_extension" in argv[-1]:
                return b'{"vector":"0.8.2","pg_trgm":"1.6","pgcrypto":"1.3"}'
            return b"7\n"
        if argv[0] == "/bin/bash" and argv[-1] == "backup":
            import shutil

            server = Path(kwargs["env"]["SERVER_PATH"])
            backup = server / ".deploy-backups" / kwargs["env"]["DEPLOY_ID"]
            backup.mkdir(parents=True)
            for name in (
                ".env",
                "docker-compose.yaml",
                "docker-compose.project.yaml",
                ".deploy/release-manifest.json",
                "deploy/traefik/federation-readplane.yml",
            ):
                source = server / name
                if source.exists():
                    (backup / name).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, backup / name)
            (backup / "rollback_tag").write_text(
                "rollback-" + kwargs["env"]["DEPLOY_ID"] + "\n"
            )
        if argv[0] == "/bin/bash" and argv[-1] == "config":
            from deploy.operator.infra_deploy import environment_versions

            server = Path(kwargs["env"]["SERVER_PATH"])
            manifest = json.loads(
                (server / ".deploy/release-manifest.json.candidate").read_bytes()
            )
            # Execute the actual repository's fixed selection function on this
            # disposable host fixture, without running any Docker command.
            import shutil
            import subprocess

            fake_bin = server / "test-bin"
            fake_bin.mkdir(exist_ok=True)
            docker = fake_bin / "docker"
            docker.write_text("#!/bin/sh\nexit 0\n")
            docker.chmod(0o755)
            bash = shutil.which("bash")
            assert bash is not None, "Bash 4 or newer is required for deploy tests"
            script = (
                Path(__file__).resolve().parents[2] / "scripts/deploy-remote.sh"
            ).read_text()
            prefix = script[: script.index('\ncase "${1:-}" in')]
            subprocess.run(
                [bash, "-c", prefix + "\nrecord_changed_release_services\n"],
                env={**kwargs["env"], "PATH": f"{fake_bin}:/usr/bin:/bin"},
                check=True,
                capture_output=True,
            )
            (server / ".env").write_bytes(
                environment_versions((server / ".env").read_bytes(), manifest)[-1]
            )
            (server / ".deploy/release-manifest.json").write_bytes(
                (server / ".deploy/release-manifest.json.candidate").read_bytes()
            )
        return b""


@pytest.fixture
def lab(tmp_path):
    config = json.loads(
        (
            Path(__file__).resolve().parents[2] / "deploy/operator/infra.example.json"
        ).read_text()
    )
    config.update(
        instance="lab",
        enabled=True,
        postgres_image="pgvector/pgvector:pg15@sha256:" + "a" * 64,
        humans={"123": ["restart", "backup", "deploy", "restore"]},
        services=["crate-api"],
        cooldown_seconds=10,
        plan_ttl_seconds=900,
    )
    for name in (
        "server_path",
        "approved_releases",
        "state_directory",
        "backup_directory",
    ):
        config[name] = str(tmp_path / name)
        Path(config[name]).mkdir()
    config["socket"] = str(tmp_path / "bridge.sock")
    keys = {}
    for index, role in enumerate(("read", "prepare", "apply", "native")):
        path = tmp_path / (role + ".key")
        keys[role] = str(index).encode() * 32
        path.write_bytes(keys[role])
        if role == "native":
            config["native_key_file"] = str(path)
        else:
            config["tokens"][role] = str(path)
    path = tmp_path / "policy.json"
    path.write_text(json.dumps(config))
    policy = Policy(path, provisioned=False)
    state = State(config["state_directory"])
    runner = FakeCommands()
    executor = Executor(policy, runner=runner)
    executor.sleep = lambda _: None
    now = [BASE]
    bridge = Bridge(policy, state, executor, clock=lambda: now[0])
    value = SimpleNamespace(
        config=config,
        path=path,
        policy=policy,
        state=state,
        runner=runner,
        executor=executor,
        bridge=bridge,
        keys=keys,
        now=now,
    )
    yield value
    state.close()


def native(lab, kind, *, nonce=None, key=None, stamp=None, **payload):
    body = canonical({"kind": kind, "instance_id": "lab", **payload})
    timestamp, nonce = (
        str(lab.now[0] if stamp is None else stamp),
        nonce or uuid.uuid4().hex,
    )
    signature = hmac.new(
        key or lab.keys["native"],
        b"POST\n"
        + NATIVE_PATH.encode()
        + b"\n"
        + timestamp.encode()
        + b"\n"
        + nonce.encode()
        + b"\n"
        + body,
        hashlib.sha256,
    ).hexdigest()
    return lab.bridge.native(
        body,
        {
            "X-Crate-Timestamp": timestamp,
            "X-Crate-Nonce": nonce,
            "X-Crate-Signature": signature,
        },
    )


def prepare(lab, **kwargs):
    return lab.bridge.prepare(
        lab.keys["prepare"],
        operation=kwargs.pop("operation", "restart"),
        target=kwargs.pop("target", "crate-api"),
        human_id=123,
        **kwargs,
    )


def confirm(lab, plan, action="approve"):
    identity = plan["id"]
    while True:
        row = lab.state.snapshot()["infra_plans"][identity]
        page = row["page"]
        native(
            lab,
            "delivered",
            confirmation_id=identity,
            chat_id=123,
            message_id=page + 100,
            page_index=page,
        )
        last = page == len(row["pages"]) - 1
        result = native(
            lab,
            "callback",
            confirmation_id=identity,
            chat_id=123,
            message_id=page + 100,
            user_id=123,
            chat_type="private",
            update_id=int(uuid.uuid4().hex[:8], 16),
            query_id=uuid.uuid4().hex,
            action=action if last else "next",
        )
        if last:
            return result


def test_native_full_flow_and_separate_authority(lab):
    plan = prepare(lab)
    with pytest.raises(PermissionError):
        lab.bridge.apply(lab.keys["apply"], plan_id=plan["id"], plan_hash=plan["hash"])
    with pytest.raises(PermissionError):
        lab.bridge.read(lab.keys["prepare"], plan_id=plan["id"])
    assert native(lab, "pending")["text"].endswith(canonical(plan["document"]).decode())
    assert confirm(lab, plan)["state"] == "accepted"
    assert (
        lab.bridge.apply(lab.keys["apply"], plan_id=plan["id"], plan_hash=plan["hash"])[
            "state"
        ]
        == "accepted"
    )
    assert lab.bridge.tick()
    assert lab.bridge.read(lab.keys["read"], plan_id=plan["id"])["state"] == "succeeded"
    assert not lab.bridge.tick()
    assert len([args for args, _ in lab.runner.calls if "restart" in args]) == 1
    assert native(lab, "pending")["state"] == "outcome"
    native(
        lab,
        "outcome_delivered",
        confirmation_id=plan["id"],
        chat_id=123,
        message_id=500,
    )
    assert native(lab, "pending")["state"] == "idle"


@pytest.mark.parametrize(
    "target",
    [
        "crate-postgres",
        "crate-redis",
        "hermes",
        "--help",
        "crate-api;touch /tmp/x",
        "../crate-api",
    ],
)
def test_forbidden_service_and_injection(lab, target):
    with pytest.raises(ValueError):
        prepare(lab, target=target)
    assert not lab.runner.calls


@pytest.mark.parametrize(
    "operation,target,version",
    [
        ("shell", "crate", None),
        ("deploy", "crate", "x;true"),
        ("restore", "/etc", "a" * 64),
        ("restore", "crate-infra-disposable", "../../x"),
        ("restart", "crate-api", "any"),
    ],
)
def test_closed_operation_contract(lab, operation, target, version):
    with pytest.raises((ValueError, PermissionError)):
        prepare(lab, operation=operation, target=target, version=version)


def test_forged_stale_duplicate_and_foreign_native(lab):
    plan = prepare(lab)
    for key in (lab.keys["prepare"], lab.keys["apply"], b"domain-key" * 4):
        with pytest.raises(PermissionError):
            native(lab, "pending", key=key)
    with pytest.raises(PermissionError):
        native(lab, "pending", stamp=BASE - 61)
    nonce = uuid.uuid4().hex
    native(lab, "pending", nonce=nonce)
    with pytest.raises(PermissionError):
        native(lab, "pending", nonce=nonce)
    native(
        lab,
        "delivered",
        confirmation_id=plan["id"],
        chat_id=123,
        message_id=1,
        page_index=0,
    )
    payload = {
        "confirmation_id": plan["id"],
        "chat_id": 123,
        "message_id": 1,
        "user_id": 123,
        "chat_type": "private",
        "update_id": 10,
        "query_id": "q",
        "action": "approve",
    }
    for change in ({"user_id": 456}, {"chat_type": "group"}, {"message_id": 999}):
        with pytest.raises(PermissionError):
            native(lab, "callback", **{**payload, **change})
    native(lab, "callback", **payload)
    with pytest.raises(PermissionError):
        native(lab, "callback", **payload)


@pytest.mark.parametrize("change", ["expiry", "policy", "state", "hash"])
def test_current_approval_and_host_preconditions(lab, change):
    plan = prepare(lab)
    confirm(lab, plan)
    if change == "expiry":
        lab.now[0] += 901
    elif change == "policy":
        lab.config["humans"]["123"] = []
        lab.path.write_text(json.dumps(lab.config))
    elif change == "state":
        lab.runner.started = "changed"
    else:
        with lab.state.transaction() as data:
            data["infra_plans"][plan["id"]]["document"]["target"] = "crate-readplane"
    lab.bridge.tick()
    assert lab.state.snapshot()["infra_plans"][plan["id"]]["state"] == "invalidated"
    assert not [a for a, _ in lab.runner.calls if "restart" in a]


def test_concurrent_effect_lock_cooldown_and_health(lab):
    plan = prepare(lab)
    confirm(lab, plan)
    lab.runner.block = threading.Event()
    worker = threading.Thread(target=lab.bridge.tick)
    worker.start()
    for _ in range(100):
        if lab.state.snapshot()["infra_plans"][plan["id"]]["state"] == "effect_started":
            break
        threading.Event().wait(0.005)
    assert not lab.bridge.tick()
    lab.runner.block.set()
    worker.join(5)
    second = prepare(lab)
    confirm(lab, second)
    assert not lab.bridge.tick()
    lab.now[0] += 11
    lab.runner.healthy = False
    # Health is part of immutable precondition; preparing unhealthy is allowed for recovery.
    third = prepare(lab)
    confirm(lab, third)
    lab.bridge.tick()  # invalidates second due to observed health drift
    lab.bridge.tick()
    assert lab.state.snapshot()["infra_plans"][third["id"]]["state"] == "indeterminate"


def test_crash_boundary_does_not_replay_and_reconciliation_is_read_only(lab):
    plan = prepare(lab)
    confirm(lab, plan)
    with lab.state.transaction() as data:
        data["infra_plans"][plan["id"]]["state"] = "effect_started"
    lab.state.close()
    lab.state = State(lab.config["state_directory"])
    lab.bridge = Bridge(lab.policy, lab.state, lab.executor, clock=lambda: lab.now[0])
    assert not lab.bridge.tick()
    assert (
        lab.bridge.reconcile(lab.keys["read"], plan_id=plan["id"])["state"]
        == "indeterminate"
    )
    lab.runner.started = "after"
    assert (
        lab.bridge.reconcile(lab.keys["read"], plan_id=plan["id"])["state"]
        == "succeeded"
    )
    assert not [args for args, _ in lab.runner.calls if "restart" in args]
    with pytest.raises(RuntimeError, match="writer"):
        State(lab.config["state_directory"])


def test_paginated_exact_review_reject_and_expiry(lab):
    lab.runner.started = "x" * 9000
    plan = prepare(lab)
    assert len(lab.state.snapshot()["infra_plans"][plan["id"]]["pages"]) > 1
    native(
        lab,
        "delivered",
        confirmation_id=plan["id"],
        chat_id=123,
        message_id=1,
        page_index=0,
    )
    payload = {
        "confirmation_id": plan["id"],
        "chat_id": 123,
        "message_id": 1,
        "user_id": 123,
        "chat_type": "private",
        "update_id": 1,
        "query_id": "q",
        "action": "approve",
    }
    with pytest.raises(ValueError, match="paginated"):
        native(lab, "callback", **payload)
    native(lab, "callback", **{**payload, "action": "reject"})
    assert not lab.bridge.tick()
    plan2 = prepare(lab)
    lab.now[0] += 901
    native(lab, "pending")
    assert lab.state.snapshot()["infra_plans"][plan2["id"]]["state"] == "expired"


def test_backup_restore_scope_checksums_actual_job_contract(lab):
    plan = prepare(lab, operation="backup", target="postgresql")
    assert "redis" in plan["document"]["preconditions"]["excludes"]
    confirm(lab, plan)
    lab.bridge.tick()
    outcome = lab.bridge.read(lab.keys["read"], plan_id=plan["id"])
    assert outcome["state"] == "succeeded"
    sha = outcome["result"]["backup_digest"]
    args = [args for args, _ in lab.runner.calls]
    assert any(
        "pg_restore" in a and "--exit-on-error" in a and "--list" not in a for a in args
    )
    assert any("psql" in a and "crate_restore" in a for a in args)
    assert next(a for a in args if "pg_dump" in a)[2] == "id-crate-postgres"
    restore = prepare(
        lab, operation="restore", target="crate-infra-disposable", version=sha
    )
    confirm(lab, restore)
    lab.now[0] += 11
    lab.bridge.tick()
    assert (
        lab.bridge.read(lab.keys["read"], plan_id=restore["id"])["result"]["coverage"]
        == "postgresql-only"
    )
    (Path(lab.config["backup_directory"]) / sha / "postgres.dump").write_bytes(
        b"tampered"
    )
    with pytest.raises(ValueError, match="checksum"):
        prepare(lab, operation="restore", target="crate-infra-disposable", version=sha)


def test_restore_failure_is_not_verified_and_disposable_is_cleaned(lab):
    lab.runner.fail = "pg_restore"
    plan = prepare(lab, operation="backup", target="postgresql")
    confirm(lab, plan)
    lab.bridge.tick()
    assert (
        lab.bridge.read(lab.keys["read"], plan_id=plan["id"])["state"]
        == "indeterminate"
    )
    assert not list(Path(lab.config["backup_directory"]).glob("*/manifest.json"))
    assert ["/usr/bin/docker", "rm", "-f", "crate-infra-disposable"] in [
        a for a, _ in lab.runner.calls
    ]
    assert "synthetic-secret" not in lab.state.path.read_text()


def release(lab):
    old = assemble_manifest(
        release_sha="a" * 40,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=None,
        changed_digests={name: "sha256:" + "a" * 64 for name in IMAGE_SPECS},
    )
    manifest = assemble_manifest(
        release_sha="b" * 40,
        registry="ghcr.io",
        owner="thecrateapp",
        previous=old,
        changed_digests={"api": "sha256:" + "b" * 64},
    )
    root = Path(lab.config["approved_releases"]) / manifest["release_sha"]
    root.mkdir()
    assets = {
        "release-manifest.json": json.dumps(manifest),
        "release.env": render_release_env(manifest),
        "docker-compose.yaml": "services: {}\n",
        "docker-compose.project.yaml": "name: crate\n",
    }
    for name, text in assets.items():
        (root / name).write_text(text)
    (root / "approved.json").write_text(
        json.dumps(
            {
                name: hashlib.sha256(text.encode()).hexdigest()
                for name, text in assets.items()
            }
        )
    )
    scripts = Path(lab.config["server_path"]) / "scripts"
    scripts.mkdir()
    (scripts / "deploy-remote.sh").write_text(
        "#!/bin/bash\npython3 -I deploy/hermes/activate_context.py --root /tmp\n"
    )
    server = Path(lab.config["server_path"])
    (server / "deploy/hermes").mkdir(parents=True)
    (server / "deploy/hermes/activate_context.py").write_text("import json\n")
    (server / "docker-compose.yaml").write_text("services: {}\n")
    (server / "docker-compose.project.yaml").write_text("name: crate\n")
    (server / ".env").write_text(
        "CRATE_IMAGE_TAG=old\nDATA_DIR=./data\nSYNTHETIC_PASSWORD=never-return-this\n"
    )
    lab.config["services"] = sorted(SERVICES)
    lab.path.write_text(json.dumps(lab.config))
    return root, manifest


def test_incremental_release_approval_and_local_deploy_rollback_contract(lab):
    root, manifest = release(lab)
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    assert (
        plan["document"]["preconditions"]["manifest"]["images"]["worker"]["source_sha"]
        == "a" * 40
    )
    lab.runner.fail = "up"
    confirm(lab, plan)
    lab.bridge.tick()
    steps = [a[-1] for a, _ in lab.runner.calls if a[0] == "/bin/bash"]
    assert steps == [
        "host-lock",
        "release-preflight",
        "backup",
        "preflight",
        "config",
        "pull",
        "up",
        "rollback",
        "host-unlock",
    ]
    assert all("make" not in a and "ssh" not in a for a, _ in lab.runner.calls)
    (root / "release.env").write_text("CRATE_API_IMAGE=forged")
    with pytest.raises(ValueError):
        prepare(
            lab, operation="deploy", target="crate", version=manifest["release_sha"]
        )


def test_release_image_verification_uses_entry_source_and_digest(lab):
    _, manifest = release(lab)
    plan = prepare(
        lab, operation="deploy", target="crate", version=manifest["release_sha"]
    )
    result = lab.executor.execute(plan["document"])
    for entry in manifest["images"].values():
        ref = entry["repository"] + "@" + entry["digest"]
        lab.runner.images[ref] = {
            "Id": "sha256:old",
            "RepoDigests": [ref],
            "Config": {
                "Labels": {"org.opencontainers.image.revision": entry["source_sha"]}
            },
        }
    assert lab.executor.verify(
        plan["document"],
        result,
    )
    next(iter(lab.runner.images.values()))["RepoDigests"] = [
        "ghcr.io/thecrateapp/crate-api@sha256:" + "f" * 64
    ]
    assert not lab.executor.verify(
        plan["document"],
        result,
    )


def test_fail_closed_provisioning_and_default_executor(lab, tmp_path):
    with pytest.raises(ValueError):
        Executor(lab.policy, real=True)
    with pytest.raises(PermissionError):
        Executor(lab.policy).inspect("crate-api")
    with pytest.raises(ValueError):
        trusted_file(lab.path)
    lab.config["tokens"]["apply"] = lab.config["tokens"]["prepare"]
    lab.path.write_text(json.dumps(lab.config))
    with pytest.raises(ValueError):
        lab.policy.load()


def test_runner_bounds_timeout_output_and_never_surfaces_stderr(tmp_path):
    runner = Runner()
    assert runner.run([sys.executable, "-c", "print('ok')"]) == b"ok\n"
    with pytest.raises(CommandError, match="output exceeded"):
        runner.run([sys.executable, "-c", "print('x'*10000)"], limit=100)
    with pytest.raises(CommandError, match="timed out"):
        runner.run([sys.executable, "-c", "import time; time.sleep(2)"], timeout=0.1)
    with pytest.raises(CommandError, match="^Command failed$"):
        runner.run(
            [
                sys.executable,
                "-c",
                "import sys; print('secret',file=sys.stderr); sys.exit(1)",
            ]
        )
    with open(tmp_path / "dump", "wb") as output:
        runner.run([sys.executable, "-c", "print('dump')"], output=output)
    assert (tmp_path / "dump").read_bytes() == b"dump\n"


def test_unix_http_routes_closed_and_mcp_adapter(lab, monkeypatch):
    path = lab.config["socket"]
    with UnixServer(path, handler(lab.bridge)) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        conn = http.client.HTTPConnection("localhost")
        conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        conn.sock.connect(path)
        conn.request(
            "POST",
            "/v1/read",
            json.dumps({"service": "crate-api"}),
            {"Authorization": "Bearer " + lab.keys["read"].decode()},
        )
        response = conn.getresponse()
        assert response.status == 200 and json.loads(response.read())["healthy"]
        conn.close()
        server.shutdown()
        worker.join(2)
    assert len(infra_mcp.dispatch({"method": "tools/list"})["tools"]) == 4
    assert (
        infra_mcp.dispatch({"method": "initialize"})["serverInfo"]["name"]
        == "crate-infrastructure"
    )
    assert infra_mcp.dispatch({"method": "ping"}) == {}
    with pytest.raises(ValueError):
        infra_mcp.call("infra_prepare", {"command": "rm"})
    with pytest.raises(ValueError):
        infra_mcp.dispatch({"method": "approve"})


def test_infra_provider_independent_key_namespace_and_fixed_relay(lab, monkeypatch):
    from deploy.hermes.plugins.crate_confirmation import infra

    identity = lab.path.parent / "identity.json"
    identity.write_text(json.dumps({"instance_id": "lab", "allowed_users": [123]}))
    monkeypatch.setattr(infra, "KEY_FILE", Path(lab.config["native_key_file"]))
    monkeypatch.setattr(infra, "IDENTITY_FILE", identity)
    provider = infra.InfraProvider()
    calls = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            return b'{"state":"idle"}'

    def open_request(request, timeout):
        calls.append(request)
        return Response()

    provider.opener = SimpleNamespace(open=open_request)
    assert asyncio.run(provider.event({"kind": "pending"})) == {"state": "idle"}
    assert provider.prefix == "ct:i:" and provider.allowed == {123}
    assert calls[0].full_url == "http://crate-infra-relay:8788/v1/native/events"
    assert b"instance_id" in calls[0].data
    assert not calls[0].has_header("Authorization")


@pytest.mark.skipif(
    os.environ.get("CRATE_INFRA_DISPOSABLE_TEST") != "1",
    reason="Explicit local disposable PostgreSQL fixture opt-in",
)
def test_real_pg15_dump_restore_and_live_row_evidence(lab, tmp_path):
    """Only new networkless fixtures; no existing application container is touched."""
    image = "pgvector/pgvector:pg15@sha256:47af0b65960b14f1c6945aa4ccae37836c632e9a6fe0eea9160936e616e5b2e9"
    source = "crate-infra-test-source-" + uuid.uuid4().hex[:12]
    real = Runner()
    real.run(
        [
            "/usr/bin/docker",
            "run",
            "-d",
            "--name",
            source,
            "--network",
            "none",
            "--label",
            "com.docker.compose.project=crate",
            "--label",
            "com.docker.compose.service=crate-postgres",
            "--tmpfs",
            "/var/lib/postgresql/data",
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            image,
            "postgres",
            "-c",
            "shared_preload_libraries=pg_stat_statements",
        ],
        timeout=60,
    )
    evidence = []
    try:
        for attempt in range(30):
            try:
                real.run(
                    ["/usr/bin/docker", "exec", source, "pg_isready", "-U", "postgres"],
                    timeout=2,
                )
                break
            except CommandError:
                if attempt == 29:
                    raise
                threading.Event().wait(1)
        real.run(
            [
                "/usr/bin/docker",
                "exec",
                source,
                "psql",
                "-U",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                "CREATE EXTENSION vector; CREATE EXTENSION pg_trgm; CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_stat_statements; CREATE TABLE fixture_proof (id integer PRIMARY KEY, value text NOT NULL, embedding vector(20)); CREATE INDEX fixture_vector_idx ON fixture_proof USING hnsw (embedding vector_l2_ops); CREATE INDEX fixture_trgm_idx ON fixture_proof USING gin (value gin_trgm_ops); INSERT INTO fixture_proof VALUES (1, 'restored-task6-proof', '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]');",
            ],
            timeout=15,
        )
        lab.config.update(
            postgres_image=image, postgres_user="postgres", postgres_database="postgres"
        )
        lab.path.write_text(json.dumps(lab.config))
        fake = lab.runner

        class DisposableRunner:
            def run(self, argv, **kwargs):
                if argv[1] == "inspect" and argv[-1] == "crate-api":
                    return fake.run(argv, **kwargs)
                if argv[1] == "inspect" and argv[-1] == "crate-postgres":
                    argv = [*argv[:-1], source]
                result = real.run(argv, **kwargs)
                if (
                    "psql" in argv
                    and "crate_restore" in argv
                    and "pg_class" in argv[-1]
                ):
                    value = real.run(
                        [
                            "/usr/bin/docker",
                            "exec",
                            "crate-infra-disposable",
                            "psql",
                            "-X",
                            "-A",
                            "-t",
                            "-v",
                            "ON_ERROR_STOP=1",
                            "-U",
                            "postgres",
                            "-d",
                            "crate_restore",
                            "-c",
                            "SELECT value || '|' || vector_dims(embedding) || '|' || (embedding <-> embedding)::text || '|' || (SELECT count(*) FROM pg_indexes WHERE indexname IN ('fixture_vector_idx','fixture_trgm_idx')) FROM fixture_proof WHERE id=1;",
                        ],
                        timeout=15,
                    )
                    evidence.append(
                        {
                            "restored_catalog_tables": int(result.strip()),
                            "restored_row": value.decode().strip(),
                            "image": image,
                            "network": "none",
                        }
                    )
                return result

        lab.executor.runner = DisposableRunner()
        plan = prepare(lab, operation="backup", target="postgresql")
        confirm(lab, plan)
        assert lab.bridge.tick()
        outcome = lab.bridge.read(lab.keys["read"], plan_id=plan["id"])
        assert outcome["state"] == "succeeded", outcome
        assert {"vector", "pg_trgm", "pgcrypto", "pg_stat_statements"} <= set(
            outcome["result"]["restore_test"]["extensions"]
        )
        assert evidence == [
            {
                "restored_catalog_tables": 1,
                "restored_row": "restored-task6-proof|20|0|2",
                "image": image,
                "network": "none",
            }
        ]
        sha = outcome["result"]["backup_digest"]
        backup = Path(lab.config["backup_directory"]) / sha
        assert (backup / "postgres.dump").read_bytes().startswith(b"PGDMP")
        restore = prepare(
            lab, operation="restore", target="crate-infra-disposable", version=sha
        )
        confirm(lab, restore)
        lab.now[0] += 11
        lab.bridge.tick()
        assert (
            lab.bridge.read(lab.keys["read"], plan_id=restore["id"])["state"]
            == "succeeded"
        )
        corrupt = tmp_path / "corrupt.dump"
        corrupt.write_bytes(b"not-a-postgresql-dump")
        with pytest.raises(CommandError):
            lab.executor._drill(corrupt)
        evidence.append(
            {
                "corrupt_restore_rejected": True,
                "backup_digest": sha,
                "extensions": outcome["result"]["restore_test"]["extensions"],
                "coverage": "postgresql-only",
                "excludes": outcome["result"]["excludes"],
            }
        )
        Path("/tmp/task6-fix1-pgvector-restore-evidence.json").write_text(
            json.dumps(evidence, indent=2)
        )
    finally:
        real.run(["/usr/bin/docker", "rm", "-f", source], timeout=30)


def test_inspect_provenance_is_actual_bounded_and_omits_config_secrets(lab):
    ref = "ghcr.io/thecrateapp/crate-api@sha256:" + "f" * 64
    lab.runner.images["sha256:old"] = {
        "Id": "sha256:old",
        "RepoDigests": [ref],
        "Config": {
            "Env": ["PASSWORD=private"],
            "Labels": {
                "org.opencontainers.image.revision": "d" * 40,
                "private": "secret",
            },
        },
    }
    value = lab.bridge.read(lab.keys["read"], service="crate-api")
    assert value["image_provenance"] == {
        "repo_digests": [ref],
        "source_sha": "d" * 40,
        "availability": "available",
    }
    assert "secret" not in json.dumps(value) and "PASSWORD" not in json.dumps(value)
    lab.runner.images["sha256:old"]["RepoDigests"] = ["x"] * 33
    with pytest.raises(ValueError):
        lab.bridge.read(lab.keys["read"], service="crate-api")


def test_callback_after_current_policy_revocation_and_cross_plan_update_replay(lab):
    first = prepare(lab)
    native(
        lab,
        "delivered",
        confirmation_id=first["id"],
        chat_id=123,
        message_id=1,
        page_index=0,
    )
    payload = {
        "confirmation_id": first["id"],
        "chat_id": 123,
        "message_id": 1,
        "user_id": 123,
        "chat_type": "private",
        "update_id": 99,
        "query_id": "unique",
        "action": "reject",
    }
    native(lab, "callback", **payload)
    second = prepare(lab)
    native(
        lab,
        "delivered",
        confirmation_id=second["id"],
        chat_id=123,
        message_id=1,
        page_index=0,
    )
    with pytest.raises(PermissionError, match="replay"):
        native(lab, "callback", **{**payload, "confirmation_id": second["id"]})
    lab.config["humans"]["123"] = []
    lab.path.write_text(json.dumps(lab.config))
    with pytest.raises(PermissionError, match="current"):
        native(
            lab,
            "callback",
            **{
                **payload,
                "confirmation_id": second["id"],
                "update_id": 100,
                "query_id": "unique2",
            },
        )


def test_listener_rejects_native_bearer_and_unknown_or_injected_arguments(lab):
    with UnixServer(lab.config["socket"], handler(lab.bridge)) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            for route, body, expected in [
                ("/v1/native/events", {"kind": "pending"}, 403),
                ("/v1/prepare", {"command": "touch /tmp/pwn"}, 400),
                ("/v1/execute", {}, 400),
            ]:
                conn = http.client.HTTPConnection("localhost")
                conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                conn.sock.connect(lab.config["socket"])
                conn.request(
                    "POST",
                    route,
                    json.dumps(body),
                    {"Authorization": "Bearer " + lab.keys["prepare"].decode()},
                )
                response = conn.getresponse()
                assert response.status == expected
                assert b"secret" not in response.read()
                conn.close()
        finally:
            server.shutdown()
            worker.join(2)
    assert not lab.runner.calls


def test_disabled_policy_and_service_process_fail_closed(lab):
    from deploy.operator.infra_server import serve

    lab.config["enabled"] = False
    lab.path.write_text(json.dumps(lab.config))
    with pytest.raises(PermissionError):
        prepare(lab)
    with pytest.raises(ValueError, match="Root-owned"):
        serve(lab.path, real=True)
    assert not Path(lab.config["socket"]).exists()


def test_missing_healthchecks_reject_before_mutation_with_exact_gap(lab):
    from deploy.operator.infra_executor import HealthCoverageError

    lab.runner.healthcheck = False
    with pytest.raises(HealthCoverageError) as error:
        prepare(lab)
    assert error.value.services == ["crate-api"]
    _, manifest = release(lab)
    with pytest.raises(HealthCoverageError) as error:
        prepare(
            lab, operation="deploy", target="crate", version=manifest["release_sha"]
        )
    assert error.value.services == sorted(SERVICES)
    assert all(args[1] in {"inspect", "compose"} for args, _ in lab.runner.calls)
    assert not lab.state.snapshot()["infra_plans"]


def test_removed_healthcheck_after_approval_rejects_before_effect(lab):
    plan = prepare(lab)
    confirm(lab, plan)
    lab.runner.healthcheck = False
    lab.bridge.tick()
    assert (
        lab.bridge.read(lab.keys["read"], plan_id=plan["id"])["state"] == "invalidated"
    )
    assert not [args for args, _ in lab.runner.calls if "restart" in args]


def test_uncertain_effect_quarantines_other_accepted_plans(lab):
    first = prepare(lab)
    confirm(lab, first)
    with lab.state.transaction() as data:
        data["infra_plans"][first["id"]].update(
            state="indeterminate", reason="process_lost_after_effect_started"
        )
    second = prepare(lab)
    confirm(lab, second)
    assert not lab.bridge.tick()
    assert not [args for args, _ in lab.runner.calls if "restart" in args]
    lab.runner.started = "after"
    assert (
        lab.bridge.reconcile(lab.keys["read"], plan_id=first["id"])["state"]
        == "succeeded"
    )
    assert lab.bridge.tick()  # remaining accepted plan is invalidated by changed state
    assert not [args for args, _ in lab.runner.calls if "restart" in args]


def test_candidate_removing_healthchecks_rejected_while_current_healthy(lab):
    from deploy.operator.infra_executor import HealthCoverageError

    _, manifest = release(lab)
    lab.runner.candidate_health = False
    with pytest.raises(HealthCoverageError) as error:
        prepare(
            lab, operation="deploy", target="crate", version=manifest["release_sha"]
        )
    assert error.value.services == sorted(SERVICES)
    assert not [args for args, _ in lab.runner.calls if args[0] == "/bin/bash"]
    assert not lab.state.snapshot()["infra_plans"]
