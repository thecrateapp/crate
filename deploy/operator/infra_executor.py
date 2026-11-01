"""Bounded fixed host jobs. No shell, SSH, user argv, or model filesystem interface."""

import contextlib
import hashlib
import json
import os
import re
import selectors
import shutil
import signal
import subprocess
import time
from pathlib import Path

from scripts.release_manifest import render_release_env, validate_manifest

from .infra_deploy import (
    assert_backup_inputs,
    configured_inputs,
    environment_versions,
    generated_backup_inputs,
    host_inputs,
    staged_inputs,
    validate_context_archive,
    validate_host,
)
from .infra_policy import DIGEST, SERVICES, SHA, canonical, digest, trusted_file


class CommandError(RuntimeError):
    pass


class HealthCoverageError(ValueError):
    def __init__(self, services):
        self.services = sorted(services)
        super().__init__("Required Docker healthcheck missing")


class Runner:
    def run(
        self, argv, *, env=None, stdin=None, output=None, timeout=900, limit=1024 * 1024
    ):
        """Drain both pipes incrementally; never surface child text or secrets."""
        clean_env = {
            "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": "/root",
            "LANG": "C.UTF-8",
            **(env or {}),
        }
        with subprocess.Popen(
            argv,
            shell=False,
            stdin=stdin or subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=clean_env,
            start_new_session=True,
        ) as proc:
            selector = selectors.DefaultSelector()
            for stream in (proc.stdout, proc.stderr):
                selector.register(stream, selectors.EVENT_READ)
            result, total, start = bytearray(), 0, time.monotonic()
            output_bytes = 0
            try:
                while selector.get_map():
                    if time.monotonic() - start > timeout:
                        raise CommandError("Command timed out")
                    for key, _ in selector.select(0.1):
                        chunk = os.read(key.fd, 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        if key.fileobj is proc.stdout and output:
                            output_bytes += len(chunk)
                            if output_bytes > 8 * 1024**3:
                                raise CommandError("Backup output exceeded 8 GiB bound")
                            output.write(chunk)
                        else:
                            total += len(chunk)
                            if total > limit:
                                raise CommandError("Command output exceeded bound")
                            if key.fileobj is proc.stdout:
                                result.extend(chunk)
                if (
                    proc.wait(timeout=max(0.1, timeout - (time.monotonic() - start)))
                    != 0
                ):
                    raise CommandError("Command failed")
                if output:
                    output.flush()
                    os.fsync(output.fileno())
                return bytes(result)
            finally:
                selector.close()
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()


class Executor:
    def __init__(self, policy, *, runner=None, real=False):
        self.policy, self.runner, self.real = policy, runner or Runner(), real
        self.sleep = time.sleep
        if real and (not policy.provisioned or not policy.config["enabled"]):
            raise ValueError("Real execution requires enabled root provisioning")
        if real:
            validate_host(Path(policy.config["server_path"]))

    @property
    def c(self):
        return self.policy.config

    def _run(self, args, **kwargs):
        if not self.real and isinstance(self.runner, Runner):
            raise PermissionError("Real commands explicitly disabled")
        return self.runner.run(args, **kwargs)

    def inspect(self, service, *, provenance=False):
        if service not in self.c["services"]:
            raise ValueError("Forbidden service")
        result = self._inspect(service)
        if provenance:
            image = json.loads(
                self._run(
                    ["/usr/bin/docker", "image", "inspect", result["image"]], timeout=15
                )
            )[0]
            if image["Id"] != result["image"]:
                raise ValueError("Image identity changed")
            refs = image.get("RepoDigests", [])
            if (
                not isinstance(refs, list)
                or len(refs) > 32
                or any(
                    not isinstance(ref, str)
                    or not re.fullmatch(
                        r"[A-Za-z0-9./:_-]{1,240}@sha256:[a-f0-9]{64}", ref
                    )
                    for ref in refs
                )
            ):
                raise ValueError("Unbounded image provenance")
            source = (
                image.get("Config", {})
                .get("Labels", {})
                .get("org.opencontainers.image.revision")
            )
            result["image_provenance"] = {
                "repo_digests": refs,
                "source_sha": source
                if isinstance(source, str) and SHA.fullmatch(source)
                else None,
                "availability": "available"
                if refs and isinstance(source, str) and SHA.fullmatch(source)
                else "incomplete",
            }
        return result

    def _inspect(self, service):
        raw = self._run(
            ["/usr/bin/docker", "inspect", "--type", "container", service], timeout=15
        )
        value = json.loads(raw)[0]
        labels = value["Config"]["Labels"]
        if (
            labels.get("com.docker.compose.project") != "crate"
            or labels.get("com.docker.compose.service") != service
        ):
            raise ValueError("Container not in exact crate project")
        identity = {
            "container": value["Id"],
            "image": value["Image"],
            "started_at": value["State"]["StartedAt"],
        }
        return {
            "service": service,
            "healthcheck_configured": bool(
                value["Config"].get("Healthcheck", {}).get("Test")
            )
            and value["Config"]["Healthcheck"]["Test"][0] != "NONE",
            **identity,
            "fingerprint": digest(identity),
            "healthy": value["State"].get("Health", {}).get("Status") == "healthy"
            and value["State"].get("Running") is True,
        }

    def _fleet(self, *, require_health=False):
        states = {service: self.inspect(service) for service in self.c["services"]}
        missing = [
            service
            for service, state in states.items()
            if not state["healthcheck_configured"]
        ]
        if require_health and missing:
            raise HealthCoverageError(missing)
        return {service: state["fingerprint"] for service, state in states.items()}

    def _release(self, sha):
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError("Full lowercase release SHA required")
        root = Path(self.c["approved_releases"]) / sha
        files = {
            name: root / name
            for name in (
                "release-manifest.json",
                "release.env",
                "docker-compose.yaml",
                "docker-compose.project.yaml",
            )
        }
        environment = (
            (Path(self.c["server_path"]) / ".env").read_bytes().decode("utf-8")
        )
        managed = [
            line.partition("=")[2]
            for line in environment.split("\n")
            if line.startswith("CRATE_OPERATOR_ROOT=")
        ]
        if managed and managed[-1].strip("\"'"):
            files["agent-context.tar.gz"] = root / "agent-context.tar.gz"
        hashes = {}
        for name, path in files.items():
            if self.policy.provisioned:
                trusted_file(path)
            if path.is_symlink() or path.stat().st_size > (
                64 * 1024 * 1024 if name.endswith(".tar.gz") else 2 * 1024 * 1024
            ):
                raise ValueError("Invalid approved asset")
            hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest = json.loads(files["release-manifest.json"].read_bytes())
        validate_manifest(
            manifest, expected_release_sha=sha, registry="ghcr.io", owner="thecrateapp"
        )
        if "agent-context.tar.gz" in files:
            validate_context_archive(files["agent-context.tar.gz"], manifest)
        if files["release.env"].read_text() != render_release_env(manifest):
            raise ValueError("Release environment disagrees with immutable digests")
        # Explicit host approval binds every executable/configuration asset.
        approval = root / "approved.json"
        if self.policy.provisioned:
            trusted_file(approval)
        if json.loads(approval.read_bytes()) != hashes:
            raise ValueError("Release assets lack exact host approval")
        return root, hashes, manifest

    def _candidate_health(self, root, manifest):
        env = dict(
            line.split("=", 1) for line in render_release_env(manifest).splitlines()
        )
        env.update(
            CRATE_IMAGE_TAG=manifest["release_sha"],
            CRATE_IMAGE_OWNER="thecrateapp",
            CRATE_IMAGE_REGISTRY="ghcr.io",
        )
        server = Path(self.c["server_path"])
        overlay = server / ".deploy/crate-operator.compose.yaml"
        raw = self._run(
            [
                "/usr/bin/docker",
                "compose",
                "--project-directory",
                str(server),
                "--project-name",
                "crate",
                "--env-file",
                str(Path(self.c["server_path"]) / ".env"),
                "-f",
                str(root / "docker-compose.yaml"),
                "-f",
                str(root / "docker-compose.project.yaml"),
                *(["-f", str(overlay)] if overlay.exists() else []),
                "config",
                "--format",
                "json",
            ],
            env=env,
            timeout=30,
        )
        resolved = json.loads(raw)
        services = resolved["services"]
        missing = []
        for service in self.c["services"]:
            check = services.get(service, {}).get("healthcheck", {})
            test = check.get("test", [])
            if (
                check.get("disable")
                or not isinstance(test, list)
                or not test
                or test[0] == "NONE"
            ):
                missing.append(service)
        if missing:
            raise HealthCoverageError(missing)
        return digest(resolved)

    def _backup(self, sha):
        if not isinstance(sha, str) or not DIGEST.fullmatch(sha):
            raise ValueError("Exact backup manifest digest required")
        root = Path(self.c["backup_directory"]) / sha
        manifest = json.loads((root / "manifest.json").read_bytes())
        if (
            digest(manifest) != sha
            or manifest["instance"] != self.c["instance"]
            or manifest["coverage"] != "postgresql-only"
            or manifest["restore_test"]["verified"] is not True
            or not {"vector", "pg_trgm", "pgcrypto"}
            <= set(manifest["restore_test"].get("extensions", {}))
        ):
            raise ValueError("Unverified backup")
        if self._file_hash(root / "postgres.dump") != manifest["dump_sha256"]:
            raise ValueError("Backup checksum mismatch")
        return root, manifest

    @staticmethod
    def _file_hash(path):
        with open(path, "rb") as stream:
            return hashlib.file_digest(stream, "sha256").hexdigest()

    def preconditions(self, operation, target, version):
        if operation == "restart":
            if version is not None:
                raise ValueError("Restart takes no version")
            state = self.inspect(target)
            if not state["healthcheck_configured"]:
                raise HealthCoverageError([target])
            return state
        if operation == "deploy" and target == "crate":
            if set(self.c["services"]) != SERVICES:
                raise ValueError(
                    "Deploy requires explicit complete application fleet policy"
                )
            root, assets, manifest = self._release(version)
            inputs = host_inputs(
                self.c["server_path"], provisioned=self.policy.provisioned
            )
            effective = self._candidate_health(root, manifest)
            if (
                host_inputs(self.c["server_path"], provisioned=self.policy.provisioned)
                != inputs
            ):
                raise ValueError("Host changed during candidate resolution")
            return {
                "host_inputs": inputs,
                "configured_host_inputs": configured_inputs(
                    staged_inputs(inputs, assets),
                    assets,
                    environment_versions(
                        (Path(self.c["server_path"]) / ".env").read_bytes(), manifest
                    )[-1],
                ),
                "effective_compose_sha256": effective,
                "fleet": self._fleet(require_health=True),
                "assets": assets,
                "manifest": manifest,
                "host_script_sha256": self._file_hash(
                    Path(self.c["server_path"]) / "scripts/deploy-remote.sh"
                ),
            }
        if operation == "backup" and target == "postgresql" and version is None:
            return {
                "source": self._inspect("crate-postgres"),
                "coverage": "postgresql-only",
                "restore_image": self.c["postgres_image"],
                "excludes": [
                    "redis",
                    "audio",
                    "artwork",
                    "configuration",
                    "image rollback",
                ],
            }
        if operation == "restore" and target == self.c["restore_target"]:
            _, manifest = self._backup(version)
            return {"backup": manifest, "target": target, "isolated": True}
        raise ValueError("Invalid closed operation/target/version")

    def _remote(self, step, plan):
        root, _, _ = self._release(plan["version"])
        script = Path(self.c["server_path"]) / "scripts/deploy-remote.sh"
        if self.policy.provisioned:
            validate_host(Path(self.c["server_path"]), backup_id=plan["id"])
        env = {
            "SERVER_PATH": self.c["server_path"],
            "DEPLOY_ID": "infra-" + plan["id"],
            "DEPLOY_IMAGE_TAG": plan["version"],
            "DEPLOY_RELEASE_SHA": plan["version"],
            "DEPLOY_CANDIDATE_DIR": str(root),
            "COMPOSE_PROJECT_NAME": "crate",
            "DEPLOY_PUBLIC_CHECKS": "0",
            "CRATE_DEPLOY_PRUNE_UNUSED_IMAGES": "0",
        }
        return self._run(["/bin/bash", str(script), step], env=env, timeout=1200)

    def _assert_deploy_inputs(self, plan, expected):
        root, assets, manifest = self._release(plan["version"])
        if (
            assets != plan["preconditions"]["assets"]
            or host_inputs(self.c["server_path"], provisioned=self.policy.provisioned)
            != expected
        ):
            raise ValueError("Effective deployment inputs changed")
        if (
            self._candidate_health(root, manifest)
            != plan["preconditions"]["effective_compose_sha256"]
        ):
            raise ValueError("Resolved deployment configuration changed")

    def _drill(self, dump):
        """Fresh networkless PostgreSQL; restore exit status plus live catalog query."""
        name = self.c["restore_target"]
        # Do not remove any pre-existing target. docker run fails on a name clash.
        self._run(
            [
                "/usr/bin/docker",
                "run",
                "-d",
                "--name",
                name,
                "--label",
                "crate.infra.disposable=true",
                "--network",
                "none",
                "--memory",
                "10g",
                "--cpus",
                "2",
                "--pids-limit",
                "128",
                "--read-only",
                "--tmpfs",
                "/var/lib/postgresql/data:rw,size=8g",
                "--tmpfs",
                "/var/run/postgresql",
                "--tmpfs",
                "/tmp",
                "-e",
                "POSTGRES_HOST_AUTH_METHOD=trust",
                self.c["postgres_image"],
                "postgres",
                "-c",
                "shared_preload_libraries=pg_stat_statements",
            ],
            timeout=60,
        )
        try:
            ready = False
            for _ in range(30):
                try:
                    self._run(
                        [
                            "/usr/bin/docker",
                            "exec",
                            name,
                            "pg_isready",
                            "-U",
                            "postgres",
                        ],
                        timeout=2,
                    )
                    ready = True
                    break
                except CommandError:
                    time.sleep(1)
            if not ready:
                raise CommandError("Disposable database not ready")
            self._run(
                [
                    "/usr/bin/docker",
                    "exec",
                    name,
                    "createdb",
                    "-U",
                    "postgres",
                    "crate_restore",
                ],
                timeout=15,
            )
            with open(dump, "rb") as stream:
                self._run(
                    [
                        "/usr/bin/docker",
                        "exec",
                        "-i",
                        name,
                        "pg_restore",
                        "--exit-on-error",
                        "--no-owner",
                        "--no-acl",
                        "-U",
                        "postgres",
                        "-d",
                        "crate_restore",
                    ],
                    stdin=stream,
                    timeout=1200,
                )
            raw = self._run(
                [
                    "/usr/bin/docker",
                    "exec",
                    name,
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
                    "SELECT count(*) FROM pg_catalog.pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace;",
                ],
                timeout=30,
            )
            tables = int(raw.strip())
            if tables <= 0:
                raise CommandError("Restored database has no public tables")
            extensions = json.loads(
                self._run(
                    [
                        "/usr/bin/docker",
                        "exec",
                        name,
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
                        "SELECT json_object_agg(extname, extversion) FROM pg_catalog.pg_extension WHERE extname IN ('vector','pg_trgm','pgcrypto','pg_stat_statements');",
                    ],
                    timeout=30,
                )
            )
            if (
                not isinstance(extensions, dict)
                or not {"vector", "pg_trgm", "pgcrypto"} <= set(extensions)
                or any(
                    not isinstance(value, str)
                    or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", value)
                    for value in extensions.values()
                )
            ):
                raise CommandError("Required restored PostgreSQL extensions missing")
            return {
                "verified": True,
                "extensions": extensions,
                "method": "pg_restore-exit-on-error-and-live-catalog",
                "public_tables": tables,
                "image": self.c["postgres_image"],
            }
        finally:
            self._run(["/usr/bin/docker", "rm", "-f", name], timeout=30)

    def execute(self, plan, *, checkpoint=lambda: None):
        checkpoint()
        op = plan["operation"]
        if (
            self.preconditions(op, plan["target"], plan["version"])
            != plan["preconditions"]
        ):
            raise ValueError("Host changed immediately before effect")
        if op == "restart":
            self._run(
                [
                    "/usr/bin/docker",
                    "restart",
                    "--time",
                    "30",
                    plan["preconditions"]["container"],
                ],
                timeout=60,
            )
            return {"restarted": True}
        if op == "backup":
            root = Path(self.c["backup_directory"]) / ("pending-" + plan["id"])
            root.mkdir(mode=0o700)
            dump = root / "postgres.dump"
            with open(dump, "xb") as output:
                os.chmod(dump, 0o600)
                self._run(
                    [
                        "/usr/bin/docker",
                        "exec",
                        plan["preconditions"]["source"]["container"],
                        "pg_dump",
                        "-U",
                        self.c["postgres_user"],
                        "-d",
                        self.c["postgres_database"],
                        "--format=custom",
                        "--no-owner",
                        "--no-acl",
                    ],
                    output=output,
                    timeout=1200,
                )
            manifest = {
                "schema": 1,
                "instance": self.c["instance"],
                "plan_id": plan["id"],
                "coverage": "postgresql-only",
                "excludes": plan["preconditions"]["excludes"],
                "dump_sha256": self._file_hash(dump),
                "restore_test": self._drill(dump),
            }
            sha = digest(manifest)
            with open(root / "manifest.json", "xb") as output:
                output.write(canonical(manifest))
                output.flush()
                os.fsync(output.fileno())
            root.rename(root.parent / sha)
            for directory in (root.parent / sha, root.parent):
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            return {
                "backup_digest": sha,
                "restore_test": manifest["restore_test"],
                "coverage": manifest["coverage"],
                "excludes": manifest["excludes"],
            }
        if op == "restore":
            root, manifest = self._backup(plan["version"])
            return {
                "coverage": manifest["coverage"],
                "excludes": manifest["excludes"],
                "restore_test": self._drill(root / "postgres.dump"),
                "target": self.c["restore_target"],
            }
        if op == "deploy":
            self._remote("host-lock", plan)
            try:
                result = self._deploy(plan, checkpoint)
            except BaseException:
                with contextlib.suppress(Exception):
                    self._remote("host-unlock", plan)
                raise
            self._remote("host-unlock", plan)
            return result
        raise ValueError("Unknown operation")

    def _deploy(self, plan, checkpoint):
        server = Path(self.c["server_path"])
        original = plan["preconditions"]["host_inputs"]
        expected = dict(original)
        self._assert_deploy_inputs(plan, expected)
        self._remote("release-preflight", plan)
        checkpoint()
        if (
            self.preconditions("deploy", plan["target"], plan["version"])
            != plan["preconditions"]
        ):
            raise ValueError("Host changed during release preflight")
        root, assets, manifest = self._release(plan["version"])
        environment = environment_versions((server / ".env").read_bytes(), manifest)
        backup = server / ".deploy-backups" / ("infra-" + plan["id"])
        if backup.exists() or backup.is_symlink():
            raise ValueError("Deployment backup target already exists")
        backup_initial, backup_configured = generated_backup_inputs(
            original, assets, environment[0], manifest, plan["id"]
        )
        backup_expected = backup_initial
        self._remote("backup", plan)
        assert_backup_inputs(server, plan["id"], backup_expected)
        self._assert_deploy_inputs(plan, expected)
        (server / ".deploy").mkdir(exist_ok=True)
        staged = staged_inputs(original, assets)
        configured = configured_inputs(staged, assets, environment[-1])
        if configured != plan["preconditions"]["configured_host_inputs"]:
            raise ValueError("Predicted configuration transition changed")
        try:
            for name in ("release.env", "release-manifest.json"):
                shutil.copyfile(root / name, server / ".deploy" / (name + ".candidate"))
            for name in ("docker-compose.yaml", "docker-compose.project.yaml"):
                shutil.copyfile(root / name, server / name)
            if "agent-context.tar.gz" in assets:
                shutil.copyfile(
                    root / "agent-context.tar.gz",
                    server / ".deploy/agent-context.candidate.tar.gz",
                )
            expected = staged
            steps = ("preflight", "config", "pull", "up", "verify")
            if "agent-context.tar.gz" in assets:
                steps += ("agent-context",)
            for step in steps:
                checkpoint()
                self._assert_deploy_inputs(plan, expected)
                assert_backup_inputs(server, plan["id"], backup_expected)
                self._remote(step, plan)
                if step == "config":
                    expected = configured
                    backup_expected = backup_configured
                self._assert_deploy_inputs(plan, expected)
                assert_backup_inputs(server, plan["id"], backup_expected)
        except Exception:  # noqa: BLE001 — only known own transitions permit rollback.
            current = host_inputs(server, provisioned=self.policy.provisioned)
            stable = set(original) - {
                ".env",
                ".deploy/release-manifest.json",
                "docker-compose.yaml",
                "docker-compose.project.yaml",
                ".deploy/release.env.candidate",
                ".deploy/release-manifest.json.candidate",
                ".deploy/agent-context.candidate.tar.gz",
            }
            safe = all(current[key] == original[key] for key in stable)
            safe = safe and current[".env"] in {
                hashlib.sha256(raw).hexdigest() for raw in environment
            }
            for key in set(original) - stable - {".env"}:
                safe = safe and current[key] in {
                    original[key],
                    staged[key],
                    configured[key],
                }
            if safe:
                # A partial config failure may have written either exact predicted
                # selection; rollback never consumes arbitrary retained inputs.
                backup_actual = dict(backup_initial)
                for name in ("changed_image_refs", "changed_services"):
                    path = backup / name
                    value = self._file_hash(path) if path.exists() else None
                    if value not in {backup_initial[name], backup_configured[name]}:
                        raise CommandError(
                            "Deployment backup selection drifted"
                        ) from None
                    backup_actual[name] = value
                assert_backup_inputs(server, plan["id"], backup_actual)
                self._remote("rollback", plan)
            raise CommandError(
                "Deployment failed; rollback only attempted for known trusted inputs"
            ) from None
        return {
            "release_sha": plan["version"],
            "host_inputs": expected,
            "effective_compose_sha256": plan["preconditions"][
                "effective_compose_sha256"
            ],
        }

    def verify(self, plan, result):
        if plan["operation"] == "restart":
            current = self.inspect(plan["target"])
            for _ in range(12):
                if current["healthy"]:
                    break
                self.sleep(5)
                current = self.inspect(plan["target"])
            return (
                current["healthy"]
                and current["image"] == plan["preconditions"]["image"]
                and current["container"] == plan["preconditions"]["container"]
                and current["started_at"] != plan["preconditions"]["started_at"]
            )
        if plan["operation"] == "deploy":
            if (
                result.get("host_inputs")
                != plan["preconditions"]["configured_host_inputs"]
            ):
                return False
            self._assert_deploy_inputs(plan, result["host_inputs"])
            _, assets, manifest = self._release(plan["version"])
            if assets != plan["preconditions"]["assets"]:
                return False
            for entry in manifest["images"].values():
                ref = entry["repository"] + "@" + entry["digest"]
                image = json.loads(
                    self._run(["/usr/bin/docker", "image", "inspect", ref], timeout=15)
                )[0]
                if (
                    ref not in image["RepoDigests"]
                    or image["Config"]["Labels"].get(
                        "org.opencontainers.image.revision"
                    )
                    != entry["source_sha"]
                ):
                    return False
                for service in entry["services"] + (
                    ["crate-fast-worker"]
                    if entry["environment"] == "CRATE_WORKER_IMAGE"
                    else []
                ):
                    if service in self.c["services"]:
                        current = self.inspect(service)
                        if not current["healthy"] or current["image"] != image["Id"]:
                            return False
            return True
        if plan["operation"] == "backup":
            _, manifest = self._backup(result["backup_digest"])
            return manifest["plan_id"] == plan["id"]
        return result.get("restore_test", {}).get("verified") is True
