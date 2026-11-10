"""Backup destinations and their secrets (admin backups, BK2).

Secrets go only through ``crate.credentials`` (Fernet, ``CRATE_CREDENTIAL_KEY``):

- ``secret_ref``: the provider credentials, in one payload per destination (access
  keys, the SFTP private key Crate generates, the OAuth client secret and token).
  A change stores a new payload and revokes the old one.
- ``repo_password_ref``: the restic repository password. Crate generates it when
  the destination is created, or imports an existing repository's password (BK6
  moves the off-site sidecar's repositories this way). It never changes, because
  the repository is encrypted with it.

``public_destination`` is the only view a client gets: settings that are safe to
show, the names of the secrets that are set, never their values or references.
"""

from __future__ import annotations

import logging
import secrets as token_source
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from crate.backups import providers
from crate.backups.providers import DestinationError
from crate.credentials import load_secret, revoke_secret, store_secret
from crate.db.queries.backup_destinations import (
    get_backup_destination,
    list_backup_destinations,
)
from crate.db.repositories.backup_destinations import (
    delete_backup_destination,
    insert_backup_destination,
    update_backup_destination,
)

log = logging.getLogger(__name__)

SECRET_SCOPE = "backup_destination"
PASSWORD_SCOPE = "backup_repository"
MIN_REPOSITORY_PASSWORD = 16


class DestinationNotFound(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class DestinationSecrets:
    """A destination's decrypted secrets. Keep it inside the worker or this module."""

    credentials: dict[str, str]
    repository_password: str


def _store_credentials(payload: Mapping[str, str]) -> str | None:
    if not payload:
        return None
    return store_secret(SECRET_SCOPE, dict(payload))


def _revoke(ref: str | None) -> None:
    if not ref:
        return
    try:
        revoke_secret(ref)
    except Exception:  # pragma: no cover - a stale ref must not block the change
        log.warning("Could not revoke a backup secret reference", exc_info=True)


def generate_repository_password() -> str:
    return token_source.token_urlsafe(32)


def load_destination_secrets(row: Mapping[str, Any]) -> DestinationSecrets:
    credentials: dict[str, str] = {}
    if row.get("secret_ref"):
        credentials = {
            str(k): str(v)
            for k, v in load_secret(row["secret_ref"], scope=SECRET_SCOPE).items()
        }
    password = load_secret(row["repo_password_ref"], scope=PASSWORD_SCOPE)["password"]
    return DestinationSecrets(credentials, str(password))


def public_destination(row: Mapping[str, Any]) -> dict[str, Any]:
    """What a client may see: no secret value and no secret reference."""
    kind = str(row["kind"])
    spec = providers.provider(kind)
    config = dict(row.get("config") or {})
    secret_names = sorted(row.get("_secret_names") or ())
    return {
        "id": str(row["id"]),
        "kind": kind,
        "provider": spec.label,
        "name": row["name"],
        "config": config,
        "location": providers.location_summary(kind, config),
        "secrets_set": secret_names,
        "missing_secrets": spec.missing_secrets({name: True for name in secret_names}),
        "oauth": spec.oauth,
        "enabled": bool(row["enabled"]),
        "status": row["status"],
        "last_checked_at": row.get("last_checked_at"),
        "last_error": row.get("last_error"),
        "repository_initialized_at": row.get("repository_initialized_at"),
        "snapshot_count": row.get("snapshot_count"),
        "repository_bytes": row.get("repository_bytes"),
        "recovery_kit_downloaded_at": row.get("recovery_kit_downloaded_at"),
        "recovery_kit_confirmed_at": row.get("recovery_kit_confirmed_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _with_secret_names(row: dict[str, Any]) -> dict[str, Any]:
    names: list[str] = []
    if row.get("secret_ref"):
        try:
            names = sorted(load_secret(row["secret_ref"], scope=SECRET_SCOPE))
        except Exception:
            log.warning("Backup destination %s: secrets unreadable", row.get("id"))
    return {**row, "_secret_names": names}


def get_destination(destination_id: str) -> dict[str, Any] | None:
    row = get_backup_destination(destination_id)
    return public_destination(_with_secret_names(row)) if row else None


def list_destinations() -> list[dict[str, Any]]:
    return [
        public_destination(_with_secret_names(row))
        for row in list_backup_destinations()
    ]


def _name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DestinationError("name is required")
    name = " ".join(value.split())
    if len(name) > 80:
        raise DestinationError("name is longer than 80 characters")
    return name


def create_destination(
    *,
    kind: str,
    name: str,
    config: Mapping[str, Any] | None = None,
    secrets: Mapping[str, Any] | None = None,
    enabled: bool = True,
    repository_password: str | None = None,
) -> dict[str, Any]:
    """Validate, store the secrets, then the row. Returns the public view."""
    clean_name = _name(name)
    clean_config, clean_secrets = providers.validate(kind, config or {}, secrets or {})
    if kind == "sftp":
        private, public = providers.generate_ssh_keypair(f"crate-backups@{clean_name}")
        clean_secrets["private_key"] = private
        clean_config["public_key"] = public
    if repository_password is not None:
        if (
            not isinstance(repository_password, str)
            or len(repository_password) < MIN_REPOSITORY_PASSWORD
        ):
            raise DestinationError(
                "An imported repository password has at least "
                f"{MIN_REPOSITORY_PASSWORD} characters"
            )
    password = repository_password or generate_repository_password()
    secret_ref = _store_credentials(clean_secrets)
    password_ref = store_secret(PASSWORD_SCOPE, {"password": password})
    try:
        row = insert_backup_destination(
            kind=kind,
            name=clean_name,
            config=clean_config,
            secret_ref=secret_ref,
            repo_password_ref=password_ref,
            enabled=enabled,
        )
    except Exception:
        _revoke(secret_ref)
        _revoke(password_ref)
        raise
    return public_destination({**row, "_secret_names": sorted(clean_secrets)})


def update_destination(
    destination_id: str,
    *,
    name: str | None = None,
    config: Mapping[str, Any] | None = None,
    secrets: Mapping[str, Any] | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """Change a destination. Secrets sent replace those stored; others are kept.

    A secret sent as null (or an empty string) is removed when the provider allows
    it (an OAuth token, to disconnect); required secrets cannot be removed.
    """
    row = get_backup_destination(destination_id)
    if row is None:
        raise DestinationNotFound(destination_id)
    kind = str(row["kind"])
    spec = providers.provider(kind)
    for key in config or {}:
        field_spec = spec.config_field(key)
        if field_spec is not None and field_spec.system:
            raise DestinationError(f"Unknown field for {kind}: {key}")
    patch = dict(secrets or {})
    for key in patch:
        field_spec = spec.secret_field(key)
        if field_spec is None or field_spec.system:
            raise DestinationError(f"Unknown secret for {kind}: {key}")
    removed = {key for key, value in patch.items() if value in (None, "")}
    stored = load_destination_secrets(row).credentials
    merged_config = {**(row["config"] or {}), **(config or {})}
    previous = row["config"] or {}
    if kind == "sftp" and "known_hosts" not in (config or {}):
        moved = any(
            key in (config or {}) and (config or {})[key] != previous.get(key)
            for key in ("host", "port")
        )
        if moved:
            # Another server: learn its host key again on the next test.
            merged_config["known_hosts"] = ""
    merged_secrets = {k: v for k, v in stored.items() if k not in removed}
    merged_secrets.update({k: v for k, v in patch.items() if k not in removed})
    # The merged state is checked as the engine will use it, system fields included.
    clean_config, clean_secrets = providers.validate(
        kind, merged_config, merged_secrets, from_client=False
    )
    secrets_changed = clean_secrets != stored
    new_ref = _store_credentials(clean_secrets) if secrets_changed else None
    try:
        updated = update_backup_destination(
            destination_id,
            name=None if name is None else _name(name),
            config=clean_config if config is not None else None,
            enabled=enabled,
            **({"secret_ref": new_ref} if secrets_changed else {}),
        )
    except Exception:
        _revoke(new_ref)
        raise
    if updated is None:
        _revoke(new_ref)
        raise DestinationNotFound(destination_id)
    if secrets_changed:
        _revoke(row.get("secret_ref"))
    return public_destination({**updated, "_secret_names": sorted(clean_secrets)})


def delete_destination(destination_id: str) -> dict[str, Any]:
    """Delete a destination and revoke its secrets. The repository itself stays."""
    row = delete_backup_destination(destination_id)
    if row is None:
        raise DestinationNotFound(destination_id)
    _revoke(row.get("secret_ref"))
    _revoke(row.get("repo_password_ref"))
    return public_destination({**row, "_secret_names": []})


__all__ = [
    "DestinationError",
    "DestinationNotFound",
    "DestinationSecrets",
    "PASSWORD_SCOPE",
    "SECRET_SCOPE",
    "create_destination",
    "delete_destination",
    "generate_repository_password",
    "get_destination",
    "list_destinations",
    "load_destination_secrets",
    "public_destination",
    "update_destination",
]
