"""Backup destination providers (admin backups, BK2).

Each destination is one restic repository. A provider says which settings it
takes, which of them are secrets, and how restic (and rclone, for the connection
probe) reach the repository:

| kind      | restic repository            | credentials                                  |
| --------- | ---------------------------- | -------------------------------------------- |
| `local`   | a folder of the backup dir   | none                                         |
| `s3`      | `s3:<endpoint>/<bucket>/...` | access key ID and secret (R2, Wasabi, MinIO) |
| `b2`      | `b2:<bucket>:<prefix>`       | key ID and application key                   |
| `sftp`    | `sftp:<user>@<host>:<path>`  | an SSH key Crate generates                   |
| `gdrive`  | `rclone:` + rclone `drive`   | OAuth token (scope `drive.file`)             |
| `dropbox` | `rclone:` + rclone `dropbox` | OAuth token                                  |

Secrets never reach the arguments of a command: restic and rclone read them from
their environment, and files that must exist (the SSH key) are written owner-only
into a per-run directory the caller removes. ``secret_values`` lists every secret
of a target so command output can be scrubbed before it is stored or logged.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

RCLONE_REMOTE = "cratebk"
_RCLONE_ENV = f"RCLONE_CONFIG_{RCLONE_REMOTE.upper()}_"
DRIVE_SCOPE = "drive.file"


class DestinationError(ValueError):
    """A destination setting is invalid; the message is safe to show."""


# ── Field validation ──────────────────────────────────────────────

_SAFE_PATH = re.compile(r"^[A-Za-z0-9._/@+-]+$")
_BUCKET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$")
_REGION = re.compile(r"^[a-z0-9-]{0,40}$")
_HOST = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})$")
_USER = re.compile(r"^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$")
_FOLDER_ID = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
_PRINTABLE = re.compile(r"^[\x21-\x7e]{1,300}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _text(name: str, value: Any, *, max_length: int = 300) -> str:
    if not isinstance(value, str):
        raise DestinationError(f"{name} must be text")
    value = value.strip()
    if len(value) > max_length:
        raise DestinationError(f"{name} is longer than {max_length} characters")
    return value


def _relative_path(name: str, value: Any) -> str:
    raw = _text(name, value, max_length=200)
    if raw.startswith("/"):
        raise DestinationError(
            f"{name} must be relative to the backup directory, for example restic"
        )
    clean = raw.strip("/")
    parts = PurePosixPath(clean).parts
    if not clean or not _SAFE_PATH.match(clean) or ".." in parts or "." in parts:
        raise DestinationError(f"{name} must be a plain folder path, like restic/main")
    return "/".join(parts)


def _prefix(name: str, value: Any) -> str:
    raw = _text(name, value, max_length=200).strip("/")
    if not raw:
        return ""
    parts = PurePosixPath(raw).parts
    if not _SAFE_PATH.match(raw) or ".." in parts or "." in parts:
        raise DestinationError(f"{name} must be a plain folder path")
    return "/".join(parts)


def _remote_path(name: str, value: Any) -> str:
    raw = _text(name, value, max_length=300)
    if not raw or _CONTROL.search(raw) or raw.startswith("-"):
        raise DestinationError(f"{name} must be a folder path on one line")
    return raw


def _endpoint(name: str, value: Any) -> str:
    raw = _text(name, value, max_length=300).rstrip("/")
    parts = urlsplit(raw)
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or _CONTROL.search(raw)
        or " " in raw
    ):
        raise DestinationError(
            f"{name} must be an http(s) URL without credentials, "
            "like https://<account>.r2.cloudflarestorage.com"
        )
    return raw


def _matching(pattern: re.Pattern[str], hint: str) -> Callable[[str, Any], str]:
    def check(name: str, value: Any) -> str:
        raw = _text(name, value)
        if not pattern.match(raw):
            raise DestinationError(f"{name} {hint}")
        return raw

    return check


def _optional_matching(
    pattern: re.Pattern[str], hint: str
) -> Callable[[str, Any], str]:
    check = _matching(pattern, hint)

    def optional(name: str, value: Any) -> str:
        if value in (None, ""):
            return ""
        return check(name, value)

    return optional


def _choice(*options: str) -> Callable[[str, Any], str]:
    def check(name: str, value: Any) -> str:
        raw = _text(name, value)
        if raw not in options:
            raise DestinationError(f"{name} must be one of {', '.join(options)}")
        return raw

    return check


def _port(name: str, value: Any) -> int:
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if type(value) is not int or not 1 <= value <= 65535:
        raise DestinationError(f"{name} must be a port number from 1 to 65535")
    return value


def _known_hosts(name: str, value: Any) -> str:
    raw = _text(name, value, max_length=8192)
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if any(_CONTROL.search(line) or len(line.split()) < 3 for line in lines):
        raise DestinationError(f"{name} must hold known_hosts lines (host type key)")
    return "\n".join(lines)


def _token(name: str, value: Any) -> str:
    if isinstance(value, Mapping):
        payload: Any = dict(value)
    else:
        try:
            payload = json.loads(_text(name, value, max_length=8192))
        except (json.JSONDecodeError, DestinationError):
            payload = None
    if not isinstance(payload, dict) or not isinstance(
        payload.get("access_token"), str
    ):
        raise DestinationError(
            f"{name} must be the JSON token rclone prints (with an access_token)"
        )
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _secret(name: str, value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DestinationError(f"{name} must be a non-empty value")
    if len(value) > 16384:
        raise DestinationError(f"{name} is too long")
    return value.strip()


@dataclass(frozen=True, slots=True)
class FieldSpec:
    name: str
    label: str
    check: Callable[[str, Any], Any]
    required: bool = False
    default: Any = None
    # Set by Crate (the SFTP public key), never accepted from a client.
    system: bool = False


@dataclass(frozen=True, slots=True)
class Provider:
    kind: str
    label: str
    config_fields: tuple[FieldSpec, ...]
    secret_fields: tuple[FieldSpec, ...] = ()
    oauth: bool = False

    def config_field(self, name: str) -> FieldSpec | None:
        return next((f for f in self.config_fields if f.name == name), None)

    def secret_field(self, name: str) -> FieldSpec | None:
        return next((f for f in self.secret_fields if f.name == name), None)

    def missing_secrets(self, secrets: Mapping[str, Any]) -> list[str]:
        """Secrets the destination needs before it can be used."""
        missing = [
            f.name
            for f in self.secret_fields
            if (f.required or f.system) and not secrets.get(f.name)
        ]
        if self.oauth and not secrets.get("token"):
            missing.append("token")
        return missing


PROVIDERS: dict[str, Provider] = {
    "local": Provider(
        "local",
        "Backup volume",
        (FieldSpec("path", "Folder in the backup directory", _relative_path, True),),
    ),
    "s3": Provider(
        "s3",
        "S3-compatible (Cloudflare R2, Wasabi, MinIO, Hetzner, AWS)",
        (
            FieldSpec("endpoint", "Endpoint URL", _endpoint, True),
            FieldSpec(
                "bucket",
                "Bucket",
                _matching(_BUCKET, "must be a bucket name (letters, digits, . _ -)"),
                True,
            ),
            FieldSpec("prefix", "Folder in the bucket", _prefix, default=""),
            FieldSpec(
                "region",
                "Region",
                _matching(_REGION, "must be a region name like auto or eu-central-1"),
                default="",
            ),
            FieldSpec(
                "bucket_lookup",
                "Bucket lookup",
                _choice("auto", "dns", "path"),
                default="auto",
            ),
        ),
        (
            FieldSpec("access_key_id", "Access key ID", _secret, True),
            FieldSpec("secret_access_key", "Secret access key", _secret, True),
        ),
    ),
    "b2": Provider(
        "b2",
        "Backblaze B2",
        (
            FieldSpec(
                "bucket",
                "Bucket",
                _matching(_BUCKET, "must be a bucket name (letters, digits, . _ -)"),
                True,
            ),
            FieldSpec("prefix", "Folder in the bucket", _prefix, default=""),
        ),
        (
            FieldSpec("key_id", "Application key ID", _secret, True),
            FieldSpec("application_key", "Application key", _secret, True),
        ),
    ),
    "sftp": Provider(
        "sftp",
        "SFTP (Hetzner Storage Box, rsync.net, a home server)",
        (
            FieldSpec(
                "host",
                "Host",
                _matching(_HOST, "must be a host name or an IPv4 address"),
                True,
            ),
            FieldSpec("port", "Port", _port, default=22),
            FieldSpec(
                "user",
                "User",
                _matching(_USER, "must be a user name (letters, digits, . _ -)"),
                True,
            ),
            FieldSpec("path", "Folder on the server", _remote_path, True),
            FieldSpec("known_hosts", "Pinned host key", _known_hosts, default=""),
            FieldSpec("public_key", "Public key", _text, system=True),
        ),
        (FieldSpec("private_key", "Private key", _secret, system=True),),
    ),
    "gdrive": Provider(
        "gdrive",
        "Google Drive",
        (
            FieldSpec("path", "Folder", _remote_path, default="crate-backups"),
            FieldSpec(
                "root_folder_id",
                "Root folder ID",
                _optional_matching(_FOLDER_ID, "must be a Drive folder ID"),
                default="",
            ),
            FieldSpec(
                "client_id",
                "OAuth client ID",
                _optional_matching(_PRINTABLE, "must be an OAuth client ID"),
                default="",
            ),
        ),
        (
            FieldSpec("client_secret", "OAuth client secret", _secret),
            FieldSpec("token", "OAuth token", _token),
        ),
        oauth=True,
    ),
    "dropbox": Provider(
        "dropbox",
        "Dropbox",
        (
            FieldSpec("path", "Folder", _remote_path, default="crate-backups"),
            FieldSpec(
                "client_id",
                "App key",
                _optional_matching(_PRINTABLE, "must be a Dropbox app key"),
                default="",
            ),
        ),
        (
            FieldSpec("client_secret", "App secret", _secret),
            FieldSpec("token", "OAuth token", _token),
        ),
        oauth=True,
    ),
}


def provider(kind: str) -> Provider:
    found = PROVIDERS.get(kind)
    if found is None:
        raise DestinationError(f"Unknown destination kind: {kind!r}")
    return found


def validate(
    kind: str,
    config: Mapping[str, Any],
    secrets: Mapping[str, Any],
    *,
    from_client: bool = True,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Check a destination's settings and return them normalised.

    With ``from_client`` (the default) the fields Crate sets itself, such as the
    SFTP key pair, are refused; the engine validates stored settings with it off.
    """
    spec = provider(kind)
    secret_names = {f.name for f in spec.secret_fields}
    clean_config: dict[str, Any] = {}
    for name in config:
        field_spec = spec.config_field(name)
        if name in secret_names:
            raise DestinationError(f"{name} is a secret; send it as a secret")
        if field_spec is None or (field_spec.system and from_client):
            raise DestinationError(f"Unknown field for {kind}: {name}")
    for field_spec in spec.config_fields:
        value = config.get(field_spec.name)
        if value in (None, ""):
            if field_spec.required:
                raise DestinationError(f"{field_spec.name} is required")
            if field_spec.default is not None:
                clean_config[field_spec.name] = field_spec.default
            continue
        clean_config[field_spec.name] = field_spec.check(field_spec.name, value)
    clean_secrets: dict[str, str] = {}
    for name, value in secrets.items():
        field_spec = spec.secret_field(name)
        if field_spec is None or (field_spec.system and from_client):
            raise DestinationError(f"Unknown secret for {kind}: {name}")
        if value in (None, ""):
            continue
        clean_secrets[name] = field_spec.check(name, value)
    for field_spec in spec.secret_fields:
        if field_spec.required and not clean_secrets.get(field_spec.name):
            raise DestinationError(f"{field_spec.name} is required")
    return clean_config, clean_secrets


def location_summary(kind: str, config: Mapping[str, Any]) -> str:
    """Where the repository lives, in one line without any secret."""
    if kind == "local":
        return f"Backup volume: {config.get('path', '')}"
    if kind == "s3":
        parts = [config.get("endpoint", ""), config.get("bucket", "")]
        if config.get("prefix"):
            parts.append(config["prefix"])
        return "/".join(p for p in parts if p)
    if kind == "b2":
        prefix = config.get("prefix")
        return f"b2:{config.get('bucket', '')}" + (f"/{prefix}" if prefix else "")
    if kind == "sftp":
        return (
            f"{config.get('user', '')}@{config.get('host', '')}:"
            f"{config.get('port', 22)}/{config.get('path', '')}"
        )
    if kind == "gdrive":
        return f"Google Drive: {config.get('path', '')}"
    if kind == "dropbox":
        return f"Dropbox: {config.get('path', '')}"
    return kind


# ── SSH keys ──────────────────────────────────────────────────────


def generate_ssh_keypair(comment: str) -> tuple[str, str]:
    """A new Ed25519 key pair: (OpenSSH private key, ``authorized_keys`` line)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.OpenSSH,
        serialization.NoEncryption(),
    ).decode("ascii")
    public = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
        )
        .decode("ascii")
    )
    safe_comment = re.sub(r"[^A-Za-z0-9@._-]", "-", comment)[:80]
    return private, f"{public} {safe_comment}"


# ── restic and rclone targets ─────────────────────────────────────


@dataclass(slots=True)
class ResticTarget:
    repository: str
    env: dict[str, str] = field(default_factory=dict)
    # Each one is passed as ``-o <option>``.
    options: list[str] = field(default_factory=list)
    secret_values: list[str] = field(default_factory=list)


@dataclass(slots=True)
class RcloneRemote:
    path: str
    env: dict[str, str] = field(default_factory=dict)
    secret_values: list[str] = field(default_factory=list)


def _write_private(path: Path, content: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(content if content.endswith("\n") else content + "\n")
    os.chmod(path, 0o600)


def _sftp_files(
    config: Mapping[str, Any], secrets: Mapping[str, Any], work_dir: Path
) -> tuple[Path, Path, bool]:
    key_file = work_dir / "id_ed25519"
    known_hosts = work_dir / "known_hosts"
    _write_private(key_file, str(secrets.get("private_key", "")))
    pinned = bool(config.get("known_hosts"))
    if not known_hosts.exists() or pinned:
        _write_private(known_hosts, str(config.get("known_hosts") or ""))
    return key_file, known_hosts, pinned


def install_oauth_client(
    kind: str, config: Mapping[str, Any], secrets: Mapping[str, Any]
) -> tuple[str, str]:
    """The install's own OAuth client: the destination's, else the install-wide one.

    Drive and Dropbox never fall back to rclone's shared client (decision D4): its
    quota is shared with every rclone user, and a token minted for another client
    cannot be refreshed with it.
    """
    env_prefix = f"CRATE_BACKUP_{kind.upper()}_"
    client_id = str(config.get("client_id") or "").strip()
    client_secret = str(secrets.get("client_secret") or "").strip()
    if not client_id:
        client_id = os.environ.get(f"{env_prefix}CLIENT_ID", "").strip()
        client_secret = (
            client_secret or os.environ.get(f"{env_prefix}CLIENT_SECRET", "").strip()
        )
    if not client_id or not client_secret:
        label = PROVIDERS[kind].label
        raise DestinationError(
            f"Add your own {label} OAuth client ID and secret to this destination first"
        )
    return client_id, client_secret


def _rclone_oauth_env(
    kind: str, config: Mapping[str, Any], secrets: Mapping[str, Any]
) -> tuple[dict[str, str], list[str]]:
    env = {f"{_RCLONE_ENV}TYPE": "drive" if kind == "gdrive" else "dropbox"}
    secret_values: list[str] = []
    if kind == "gdrive":
        env[f"{_RCLONE_ENV}SCOPE"] = DRIVE_SCOPE
        if config.get("root_folder_id"):
            env[f"{_RCLONE_ENV}ROOT_FOLDER_ID"] = str(config["root_folder_id"])
    client_id, client_secret = install_oauth_client(kind, config, secrets)
    env[f"{_RCLONE_ENV}CLIENT_ID"] = client_id
    env[f"{_RCLONE_ENV}CLIENT_SECRET"] = client_secret
    secret_values.append(client_secret)
    if secrets.get("token"):
        token = str(secrets["token"])
        env[f"{_RCLONE_ENV}TOKEN"] = token
        secret_values.append(token)
        try:
            parsed = json.loads(token)
        except json.JSONDecodeError:
            parsed = {}
        for key in ("access_token", "refresh_token"):
            if isinstance(parsed, dict) and parsed.get(key):
                secret_values.append(str(parsed[key]))
    return env, secret_values


def restic_target(
    kind: str,
    config: Mapping[str, Any],
    secrets: Mapping[str, Any],
    *,
    backup_dir: Path,
    work_dir: Path,
) -> ResticTarget:
    """How restic reaches a destination's repository (without its password)."""
    provider(kind)
    if kind == "local":
        return ResticTarget(str(Path(backup_dir) / str(config["path"])))
    if kind == "s3":
        prefix = f"/{config['prefix']}" if config.get("prefix") else ""
        target = ResticTarget(f"s3:{config['endpoint']}/{config['bucket']}{prefix}")
        target.env["AWS_ACCESS_KEY_ID"] = str(secrets.get("access_key_id", ""))
        target.env["AWS_SECRET_ACCESS_KEY"] = str(secrets.get("secret_access_key", ""))
        if config.get("region"):
            target.env["AWS_DEFAULT_REGION"] = str(config["region"])
        lookup = config.get("bucket_lookup") or "auto"
        if lookup != "auto":
            target.options.append(f"s3.bucket-lookup={lookup}")
        target.secret_values = [target.env["AWS_SECRET_ACCESS_KEY"]]
        return target
    if kind == "b2":
        target = ResticTarget(f"b2:{config['bucket']}:{config.get('prefix') or '/'}")
        target.env["B2_ACCOUNT_ID"] = str(secrets.get("key_id", ""))
        target.env["B2_ACCOUNT_KEY"] = str(secrets.get("application_key", ""))
        target.secret_values = [target.env["B2_ACCOUNT_KEY"]]
        return target
    if kind == "sftp":
        key_file, known_hosts, pinned = _sftp_files(config, secrets, work_dir)
        host, user = str(config["host"]), str(config["user"])
        port = int(config.get("port") or 22)
        checking = "yes" if pinned else "accept-new"
        command = (
            f"ssh -i {key_file} -p {port} -o BatchMode=yes -o IdentitiesOnly=yes "
            f"-o UserKnownHostsFile={known_hosts} -o StrictHostKeyChecking={checking} "
            f"-o ConnectTimeout=20 -o ServerAliveInterval=30 {user}@{host} -s sftp"
        )
        return ResticTarget(
            f"sftp:{user}@{host}:{config['path']}",
            options=[f"sftp.command={command}"],
            secret_values=[str(secrets.get("private_key", ""))],
        )
    env, secret_values = _rclone_oauth_env(kind, config, secrets)
    return ResticTarget(
        f"rclone:{RCLONE_REMOTE}:{config.get('path') or 'crate-backups'}",
        env=env,
        secret_values=secret_values,
    )


def _known_host_key_types(known_hosts: str) -> list[str]:
    types: list[str] = []
    for line in known_hosts.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[1] not in types:
            types.append(parts[1])
    return types


def rclone_remote(
    kind: str,
    config: Mapping[str, Any],
    secrets: Mapping[str, Any],
    *,
    backup_dir: Path,
    work_dir: Path,
    bucket_exists: bool = False,
) -> RcloneRemote:
    """The same place as an rclone remote, for the write, read and delete probe.

    ``bucket_exists`` is true once the destination holds a repository (created or
    imported). The S3 probe then skips rclone's CreateBucket call, which a key
    scoped to one bucket's objects (Cloudflare R2's "Object Read & Write") is
    refused with a 403. A new destination keeps it, so a bucket that does not
    exist yet is created by its first test.
    """
    provider(kind)
    prefix = f"{_RCLONE_ENV}"
    if kind == "local":
        return RcloneRemote(
            f"{RCLONE_REMOTE}:{Path(backup_dir) / str(config['path'])}",
            env={f"{prefix}TYPE": "local"},
        )
    if kind == "s3":
        lookup = config.get("bucket_lookup") or "auto"
        env = {
            f"{prefix}TYPE": "s3",
            f"{prefix}PROVIDER": "Other",
            f"{prefix}ENDPOINT": str(config["endpoint"]),
            f"{prefix}ACCESS_KEY_ID": str(secrets.get("access_key_id", "")),
            f"{prefix}SECRET_ACCESS_KEY": str(secrets.get("secret_access_key", "")),
            f"{prefix}FORCE_PATH_STYLE": "false" if lookup == "dns" else "true",
        }
        if bucket_exists:
            env[f"{prefix}NO_CHECK_BUCKET"] = "true"
        if config.get("region"):
            env[f"{prefix}REGION"] = str(config["region"])
        path = "/".join(p for p in (config["bucket"], config.get("prefix")) if p)
        return RcloneRemote(
            f"{RCLONE_REMOTE}:{path}",
            env=env,
            secret_values=[env[f"{prefix}SECRET_ACCESS_KEY"]],
        )
    if kind == "b2":
        env = {
            f"{prefix}TYPE": "b2",
            f"{prefix}ACCOUNT": str(secrets.get("key_id", "")),
            f"{prefix}KEY": str(secrets.get("application_key", "")),
        }
        path = "/".join(p for p in (config["bucket"], config.get("prefix")) if p)
        return RcloneRemote(
            f"{RCLONE_REMOTE}:{path}", env=env, secret_values=[env[f"{prefix}KEY"]]
        )
    if kind == "sftp":
        key_file, known_hosts, _ = _sftp_files(config, secrets, work_dir)
        env = {
            f"{prefix}TYPE": "sftp",
            f"{prefix}HOST": str(config["host"]),
            f"{prefix}USER": str(config["user"]),
            f"{prefix}PORT": str(config.get("port") or 22),
            f"{prefix}KEY_FILE": str(key_file),
            f"{prefix}KNOWN_HOSTS_FILE": str(known_hosts),
        }
        # ssh pins the one key type it negotiated; rclone must ask for that type,
        # or the server offers another and rclone reports a mismatch.
        types = _known_host_key_types(str(config.get("known_hosts") or ""))
        if types:
            env[f"{prefix}HOST_KEY_ALGORITHMS"] = " ".join(types)
        return RcloneRemote(
            f"{RCLONE_REMOTE}:{config['path']}",
            env=env,
            secret_values=[str(secrets.get("private_key", ""))],
        )
    env, secret_values = _rclone_oauth_env(kind, config, secrets)
    return RcloneRemote(
        f"{RCLONE_REMOTE}:{config.get('path') or 'crate-backups'}",
        env=env,
        secret_values=secret_values,
    )


__all__ = [
    "DRIVE_SCOPE",
    "DestinationError",
    "FieldSpec",
    "PROVIDERS",
    "Provider",
    "RCLONE_REMOTE",
    "RcloneRemote",
    "ResticTarget",
    "generate_ssh_keypair",
    "location_summary",
    "provider",
    "rclone_remote",
    "restic_target",
    "validate",
]
