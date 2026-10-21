"""Closed, root-provisioned infrastructure policy; no request-controlled commands."""

import hashlib
import json
import os
import re
from pathlib import Path

SERVICES = frozenset(
    {
        "crate-api",
        "crate-readplane",
        "crate-worker",
        "crate-fast-worker",
        "crate-projector",
        "crate-maintenance-worker",
        "crate-analysis-worker",
        "crate-playback-worker",
        "crate-media-worker",
        "crate-ui",
        "crate-listen",
        "crate-cast-receiver",
        "crate-site",
        "crate-docs",
    }
)
OPERATIONS = frozenset({"restart", "backup", "deploy", "restore"})
SHA = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
IDENTIFIER = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def trusted_file(path):
    path = Path(path)
    for item in (path, *path.parents):
        st = item.lstat()
        if item.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
            raise ValueError("Root-owned non-writable provisioning required")
    return path


def secret(path):
    raw = Path(path).read_bytes().strip()
    if not 32 <= len(raw) <= 256 or b"\n" in raw or b"\r" in raw:
        raise ValueError("Invalid dedicated secret")
    return raw


class Policy:
    def __init__(self, path, *, provisioned=True):
        self.path, self.provisioned = Path(path), provisioned
        self.load()

    def load(self):
        if self.provisioned:
            trusted_file(self.path)
        if self.path.stat().st_size > 65536:
            raise ValueError("Policy too large")
        c = json.loads(self.path.read_bytes())
        fields = {
            "instance",
            "enabled",
            "services",
            "humans",
            "tokens",
            "native_key_file",
            "state_directory",
            "socket",
            "server_path",
            "approved_releases",
            "backup_directory",
            "restore_target",
            "postgres_image",
            "postgres_user",
            "postgres_database",
            "cooldown_seconds",
            "plan_ttl_seconds",
        }
        if (
            set(c) != fields
            or type(c["enabled"]) is not bool
            or not IDENTIFIER.fullmatch(c["instance"])
        ):
            raise ValueError("Invalid closed policy")
        if (
            not isinstance(c["services"], list)
            or not set(c["services"]) <= SERVICES
            or not c["services"]
        ):
            raise ValueError("Forbidden service")
        if set(c["tokens"]) != {"read", "prepare", "apply"}:
            raise ValueError("Separate authority required")
        for name in ("cooldown_seconds", "plan_ttl_seconds"):
            if type(c[name]) is not int or not 1 <= c[name] <= 3600:
                raise ValueError("Invalid timing policy")
        for name in (
            "socket",
            "state_directory",
            "server_path",
            "approved_releases",
            "backup_directory",
            "native_key_file",
            *(),
        ):
            if not Path(c[name]).is_absolute():
                raise ValueError("Absolute paths required")
        if c["restore_target"] != "crate-infra-disposable":
            raise ValueError("Only isolated disposable restore is implemented")
        if not re.fullmatch(
            r"postgres:15(?:\.[0-9]+)?(?:-alpine)?@sha256:[a-f0-9]{64}",
            c["postgres_image"],
        ):
            raise ValueError("Pinned PostgreSQL 15 image required")
        for name in ("postgres_user", "postgres_database"):
            if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", c[name]):
                raise ValueError("Invalid database identity")
        if not isinstance(c["humans"], dict) or not c["humans"]:
            raise ValueError("Explicit human mapping required")
        for human, caps in c["humans"].items():
            if (
                not re.fullmatch(r"[1-9][0-9]{0,17}", human)
                or not isinstance(caps, list)
                or not set(caps) <= OPERATIONS
            ):
                raise ValueError("Invalid human capabilities")
        files = [c["native_key_file"], *c["tokens"].values()]
        if len(set(files)) != 4 or any(not Path(p).is_absolute() for p in files):
            raise ValueError("Dedicated authority files required")
        if self.provisioned:
            for path in [
                *files,
                c["server_path"],
                c["approved_releases"],
                c["state_directory"],
                c["backup_directory"],
                str(Path(c["socket"]).parent),
            ]:
                trusted_file(path)
            for file in files:
                if os.stat(file).st_mode & 0o077:
                    raise ValueError("Secrets must be private")
        keys = [secret(p) for p in files]
        if len(set(keys)) != 4:
            raise ValueError("Authority keys must differ")
        self.config = c
        engine_files = [
            Path(__file__).with_name(name)
            for name in (
                "infra_policy.py",
                "infra_plans.py",
                "infra_executor.py",
                "infra_server.py",
            )
        ]
        if self.provisioned:
            for path in engine_files:
                trusted_file(path)
        self.revision = digest(
            {
                "engine": {
                    path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in engine_files
                },
                **c,
                "key_hashes": [hashlib.sha256(k).hexdigest() for k in keys],
            }
        )
        return self

    def authorize(self, role, token):
        import hmac

        self.load()
        if role not in self.config["tokens"] or not hmac.compare_digest(
            secret(self.config["tokens"][role]), token
        ):
            raise PermissionError("Infrastructure authority denied")

    def human(self, user, operation):
        return type(user) is int and operation in self.config["humans"].get(
            str(user), []
        )
