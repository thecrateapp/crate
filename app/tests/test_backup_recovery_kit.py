"""The recovery kit: one age-encrypted file for every destination (BG1-4, D1, D2)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

from crate.backups import kit
from crate.backups.destinations import create_destination, load_destination_secrets
from crate.db.queries.backup_destinations import get_backup_destination

PASSPHRASE = "correct horse battery staple"


def test_age_round_trip_across_chunk_sizes():
    for size in (0, 1, kit.AGE_CHUNK - 1, kit.AGE_CHUNK, kit.AGE_CHUNK + 1, 200_000):
        plaintext = os.urandom(size)
        sealed = kit.age_encrypt(plaintext, PASSPHRASE, log_n=10)
        assert sealed.startswith(b"age-encryption.org/v1\n-> scrypt ")
        assert kit.age_decrypt(sealed, PASSPHRASE) == plaintext


def test_age_refuses_a_wrong_passphrase_and_tampering():
    sealed = kit.age_encrypt(b"secret", PASSPHRASE, log_n=10)
    with pytest.raises(kit.KitError):
        kit.age_decrypt(sealed, "wrong passphrase!")
    tampered = bytearray(sealed)
    tampered[-1] ^= 1
    with pytest.raises(kit.KitError):
        kit.age_decrypt(bytes(tampered), PASSPHRASE)


def _age_binary() -> str | None:
    configured = os.environ.get("CRATE_AGE_BIN")
    if configured and shutil.which(configured):
        return configured
    return shutil.which("age")


def test_the_age_reference_implementation_opens_the_file(tmp_path):
    """The kit must open with stock age, without Crate."""
    binary = _age_binary()
    if binary is None:
        if os.environ.get("CRATE_BACKUP_INTEGRATION_REQUIRED") == "1":
            pytest.fail("age is required (CRATE_AGE_BIN)")
        pytest.skip("age is required (CRATE_AGE_BIN)")
    plaintext = os.urandom(150_000)
    sealed = tmp_path / "kit.md.age"
    sealed.write_bytes(kit.age_encrypt(plaintext, PASSPHRASE))
    # age reads the passphrase from the terminal only; script(1) gives it one.
    script = f"{binary} -d -o {tmp_path / 'out'} {sealed}"
    result = subprocess.run(
        ["script", "-qec", script, "/dev/null"],
        input=f"{PASSPHRASE}\n".encode(),
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (tmp_path / "out").read_bytes() == plaintext


def test_passphrases_must_be_long_enough():
    with pytest.raises(kit.KitError, match="12"):
        kit.check_passphrase("short")
    kit.check_passphrase("twelve chars")


@pytest.fixture
def backup_root(tmp_path, monkeypatch):
    root = tmp_path / "backups"
    root.mkdir()
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(root))
    return root


def test_the_kit_holds_every_repository_and_only_the_sftp_key(pg_db, backup_root):
    del pg_db
    volume = create_destination(kind="local", name="Volume", config={"path": "restic"})
    bucket = create_destination(
        kind="s3",
        name="Cloudflare R2",
        config={"endpoint": "https://acc.r2.cloudflarestorage.com", "bucket": "crate"},
        secrets={"access_key_id": "AKID-NEVER", "secret_access_key": "SK-NEVER"},
    )
    box = create_destination(
        kind="sftp",
        name="Storage Box",
        config={
            "host": "u1.your-storagebox.de",
            "port": 23,
            "user": "u1",
            "path": "crate",
        },
    )
    rows = [get_backup_destination(d["id"]) for d in (volume, bucket, box)]

    document = kit.build_kit(rows, generated_at="2026-11-12T12:00:00Z")

    for row in rows:
        password = load_destination_secrets(row).repository_password
        assert password in document
    assert "AKID-NEVER" not in document and "SK-NEVER" not in document
    sftp_key = load_destination_secrets(rows[2]).credentials["private_key"]
    assert sftp_key.strip() in document
    assert "restic -r" in document and "pg_restore" in document
    data = json.loads(document.split("```json\n", 1)[1].split("\n```", 1)[0])
    assert data["format"] == "crate-recovery-kit/1"
    assert [d["name"] for d in data["destinations"]] == [
        "Volume",
        "Cloudflare R2",
        "Storage Box",
    ]
    by_name = {d["name"]: d for d in data["destinations"]}
    assert by_name["Cloudflare R2"]["repository"] == (
        "s3:https://acc.r2.cloudflarestorage.com/crate"
    )
    assert by_name["Cloudflare R2"]["credentials_needed"] == [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ]
    assert by_name["Storage Box"]["ssh_private_key"].strip() == sftp_key.strip()
    assert "ssh_private_key" not in by_name["Volume"]
    assert len(data["credential_key_fingerprint"]) == 16

    sealed = kit.seal_kit(document, PASSPHRASE)
    assert kit.age_decrypt(sealed, PASSPHRASE).decode() == document
    assert (
        kit.kit_filename("2026-11-12T12:00:00Z") == "crate-recovery-kit-20261112.md.age"
    )
