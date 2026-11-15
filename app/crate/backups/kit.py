"""The recovery kit: what an operator needs to restore without this server (BK4).

One file covers every destination, the local volume included (BG1-4):
``crate-recovery-kit-<YYYYMMDD>.md.age``. It is an `age v1`_ file encrypted to a
passphrase (an scrypt recipient) that the operator types when downloading it;
Crate never stores that passphrase. Any age implementation opens it::

    age -d -o crate-recovery-kit.md crate-recovery-kit-20261112.md.age

Inside is a Markdown document: restore steps with restic and pg_restore, then one
section per destination with its repository and password, the SFTP private key
for SFTP destinations (D2), and a fenced JSON block with the same data for tools.
Provider credentials (access keys, OAuth tokens) are not in the kit (D2): the
operator gets them again from the provider. The ``CRATE_CREDENTIAL_KEY``
fingerprint is there to tell which key a server's secrets need, not the key.

The age format is implemented here with ``cryptography`` (scrypt, HKDF-SHA256,
HMAC-SHA256, ChaCha20-Poly1305), following the specification; the tests open the
files with the reference ``age`` binary.

.. _age v1: https://age-encryption.org/v1
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import tempfile
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from crate.backups import providers
from crate.backups.destinations import load_destination_secrets
from crate.backups.settings import backup_dir

AGE_VERSION_LINE = b"age-encryption.org/v1"
AGE_CHUNK = 64 * 1024
_SCRYPT_LABEL = b"age-encryption.org/v1/scrypt"
# 2**16 needs 64 MiB in the API; age opens files up to 2**22.
DEFAULT_LOG_N = 16
MIN_PASSPHRASE = 12
KIT_FORMAT = "crate-recovery-kit/1"
_CREDENTIALS_NEEDED = {
    "local": [],
    "s3": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    "b2": ["B2_ACCOUNT_ID", "B2_ACCOUNT_KEY"],
    "sftp": [],
    "gdrive": ["an rclone remote for Google Drive (your own OAuth client)"],
    "dropbox": ["an rclone remote for Dropbox (your own app)"],
}


class KitError(ValueError):
    """The kit cannot be made or opened; the message is safe to show."""


# ── age v1, scrypt recipient ────────────────────────────────────────


def _b64(data: bytes) -> bytes:
    return base64.b64encode(data).rstrip(b"=")


def _unb64(data: bytes) -> bytes:
    if b"=" in data or b"\n" in data:
        raise KitError("Not an age file")
    return base64.b64decode(data + b"=" * (-len(data) % 4), validate=True)


def _wrap_body(body: bytes) -> bytes:
    lines = [body[i : i + 64] for i in range(0, len(body), 64)]
    if not lines or len(lines[-1]) == 64:
        lines.append(b"")
    return b"\n".join(lines)


def _hkdf(key: bytes, salt: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info).derive(key)


def _scrypt_key(passphrase: str, salt: bytes, log_n: int) -> bytes:
    return Scrypt(salt=_SCRYPT_LABEL + salt, length=32, n=2**log_n, r=8, p=1).derive(
        passphrase.encode("utf-8")
    )


def _stream(key: bytes, data: bytes, *, decrypt: bool) -> bytes:
    aead = ChaCha20Poly1305(key)
    size = AGE_CHUNK + 16 if decrypt else AGE_CHUNK
    chunks = [data[i : i + size] for i in range(0, len(data), size)] or [b""]
    out = []
    for counter, chunk in enumerate(chunks):
        last = counter == len(chunks) - 1
        nonce = counter.to_bytes(11, "big") + (b"\x01" if last else b"\x00")
        if decrypt:
            try:
                out.append(aead.decrypt(nonce, chunk, None))
            except InvalidTag as exc:
                raise KitError("The kit is damaged or the passphrase is wrong") from exc
        else:
            out.append(aead.encrypt(nonce, chunk, None))
    return b"".join(out)


def age_encrypt(
    plaintext: bytes, passphrase: str, *, log_n: int = DEFAULT_LOG_N
) -> bytes:
    file_key = os.urandom(16)
    salt = os.urandom(16)
    wrapped = ChaCha20Poly1305(_scrypt_key(passphrase, salt, log_n)).encrypt(
        b"\x00" * 12, file_key, None
    )
    header = (
        AGE_VERSION_LINE
        + b"\n-> scrypt "
        + _b64(salt)
        + b" "
        + str(log_n).encode()
        + b"\n"
        + _wrap_body(_b64(wrapped))
        + b"\n---"
    )
    mac = hmac.new(_hkdf(file_key, b"", b"header"), header, hashlib.sha256).digest()
    nonce = os.urandom(16)
    payload = _stream(_hkdf(file_key, nonce, b"payload"), plaintext, decrypt=False)
    return header + b" " + _b64(mac) + b"\n" + nonce + payload


def age_decrypt(data: bytes, passphrase: str, *, max_log_n: int = 22) -> bytes:
    """Open an age file made by ``age_encrypt`` (one scrypt stanza)."""
    try:
        version, rest = data.split(b"\n", 1)
        stanza, rest = rest.split(b"\n", 1)
        body_lines = []
        while True:
            line, rest = rest.split(b"\n", 1)
            body_lines.append(line)
            if len(line) < 64:
                break
        mac_line, payload = rest.split(b"\n", 1)
    except ValueError as exc:
        raise KitError("Not an age file") from exc
    parts = stanza.split(b" ")
    if (
        version != AGE_VERSION_LINE
        or parts[:2] != [b"->", b"scrypt"]
        or len(parts) != 4
    ):
        raise KitError("Not a passphrase-encrypted age file")
    if not mac_line.startswith(b"--- "):
        raise KitError("Not an age file")
    salt, log_n = _unb64(parts[2]), int(parts[3])
    if len(salt) != 16 or not 1 <= log_n <= max_log_n:
        raise KitError("Unsupported age scrypt parameters")
    try:
        file_key = ChaCha20Poly1305(_scrypt_key(passphrase, salt, log_n)).decrypt(
            b"\x00" * 12, _unb64(b"".join(body_lines)), None
        )
    except InvalidTag as exc:
        raise KitError("The passphrase is wrong") from exc
    header = data[: data.index(b"\n--- ") + len(b"\n---")]
    expected = hmac.new(
        _hkdf(file_key, b"", b"header"), header, hashlib.sha256
    ).digest()
    if not hmac.compare_digest(expected, _unb64(mac_line[4:])):
        raise KitError("The kit is damaged")
    if len(payload) < 16:
        raise KitError("The kit is damaged")
    nonce, ciphertext = payload[:16], payload[16:]
    return _stream(_hkdf(file_key, nonce, b"payload"), ciphertext, decrypt=True)


def check_passphrase(passphrase: Any) -> str:
    if not isinstance(passphrase, str) or len(passphrase) < MIN_PASSPHRASE:
        raise KitError(f"The kit passphrase needs {MIN_PASSPHRASE} characters or more")
    if len(passphrase) > 1024:
        raise KitError("The kit passphrase is too long")
    return passphrase


# ── the document ────────────────────────────────────────────────────


def credential_key_fingerprint() -> str:
    from crate.credentials import credential_key_fingerprint as fingerprint

    return fingerprint()


def _repository(row: Mapping[str, Any], work_dir: Path) -> str:
    kind, config = str(row["kind"]), dict(row.get("config") or {})
    if kind in ("gdrive", "dropbox"):
        return f"rclone:crate-{kind}:{config.get('path') or 'crate-backups'}"
    return providers.restic_target(
        kind, config, {}, backup_dir=backup_dir(), work_dir=work_dir
    ).repository


def _entry(row: Mapping[str, Any], work_dir: Path) -> dict[str, Any]:
    secrets = load_destination_secrets(dict(row))
    config = dict(row.get("config") or {})
    entry: dict[str, Any] = {
        "id": str(row["id"]),
        "name": row["name"],
        "kind": row["kind"],
        "location": providers.location_summary(str(row["kind"]), config),
        "repository": _repository(row, work_dir),
        "password": secrets.repository_password,
        "credentials_needed": _CREDENTIALS_NEEDED[str(row["kind"])],
    }
    if row["kind"] == "sftp":
        entry["ssh_private_key"] = secrets.credentials.get("private_key", "")
        entry["ssh_port"] = int(config.get("port") or 22)
        entry["known_hosts"] = config.get("known_hosts") or ""
    if row["kind"] == "local":
        entry["note"] = (
            "A folder of the server's backup directory: copy it off the server "
            "(or mount the disk) before restoring from it."
        )
    return entry


_STEPS = """\
## Restore steps

1. Install restic 0.19 or later and the PostgreSQL 15 client (`pg_restore`).
2. Pick a destination below and export its password:
   `export RESTIC_PASSWORD='<password>'`, plus the provider credentials it lists.
3. List the snapshots and pick one (the engine's are `/crate.dump`, host `crate`):
   `restic -r <repository> snapshots --host crate`
4. Take the dump out: `restic -r <repository> dump <snapshot> /crate.dump > crate.dump`
5. Check it: `pg_restore --list crate.dump | head`
6. Restore into an empty database of a new Crate install (stop its workers first):
   `pg_restore --no-owner --no-privileges -d <database> crate.dump`
7. Set `CRATE_CREDENTIAL_KEY` to the key whose fingerprint is below, so the
   restored secrets open. Without it, enter the provider credentials again.

Snapshots made by the older off-site sidecar hold `crate.sql.gz` instead: restore
them with `restic dump <snapshot> /crate.sql.gz | gunzip | psql -d <database>`.
"""


def _section(entry: Mapping[str, Any]) -> str:
    lines = [
        f"### {entry['name']} ({entry['kind']})",
        "",
        f"- Location: {entry['location']}",
        f"- Repository: `{entry['repository']}`",
        f"- Password: `{entry['password']}`",
    ]
    if entry["credentials_needed"]:
        needed = ", ".join(
            f"`{c}`" if c.isupper() else c for c in entry["credentials_needed"]
        )
        lines.append(f"- Also needs (not in this kit): {needed}")
    if entry.get("note"):
        lines.append(f"- {entry['note']}")
    if entry["kind"] == "sftp":
        lines += [
            "",
            "Save the key below as `id_ed25519` (mode 600) and run restic with",
            f"`-o sftp.args='-i id_ed25519 -p {entry['ssh_port']}'`:",
            "",
            "```text",
            str(entry["ssh_private_key"]).strip(),
            "```",
        ]
    return "\n".join(lines)


def build_kit(rows: Iterable[Mapping[str, Any]], *, generated_at: str) -> str:
    """The kit's Markdown for these destinations, in the given order."""
    with tempfile.TemporaryDirectory(prefix="crate-kit-") as raw_dir:
        entries = [_entry(row, Path(raw_dir)) for row in rows]
    fingerprint = credential_key_fingerprint()
    data = {
        "format": KIT_FORMAT,
        "generated_at": generated_at,
        "credential_key_fingerprint": fingerprint,
        "destinations": entries,
    }
    parts = [
        "# Crate recovery kit",
        "",
        f"Generated {generated_at}. Keep this file off the Crate server: anyone who",
        "opens it can read every backup listed here.",
        "",
        f"`CRATE_CREDENTIAL_KEY` fingerprint: `{fingerprint}` (the key is not here).",
        "",
        _STEPS,
        "## Destinations",
        "",
        "\n\n".join(_section(entry) for entry in entries) or "None yet.",
        "",
        "## Machine-readable copy",
        "",
        "```json",
        json.dumps(data, indent=2, sort_keys=True),
        "```",
        "",
    ]
    return "\n".join(parts)


def seal_kit(document: str, passphrase: str) -> bytes:
    return age_encrypt(document.encode("utf-8"), check_passphrase(passphrase))


def kit_filename(generated_at: str) -> str:
    digits = "".join(ch for ch in generated_at[:10] if ch.isdigit())
    return f"crate-recovery-kit-{digits}.md.age"


__all__ = [
    "AGE_CHUNK",
    "KIT_FORMAT",
    "KitError",
    "age_decrypt",
    "age_encrypt",
    "build_kit",
    "check_passphrase",
    "credential_key_fingerprint",
    "kit_filename",
    "seal_kit",
]
