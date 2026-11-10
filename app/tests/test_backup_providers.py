"""Backup destination providers: validation and how restic and rclone reach them (BK2)."""

from __future__ import annotations

import pytest

from crate.backups import providers
from crate.backups.providers import DestinationError, generate_ssh_keypair

SECRET = "s3cr3t-value-that-must-never-leak"


def test_every_kind_of_the_table_has_a_provider():
    from crate.db.schema_sections.backup_destinations_v163 import V163_KINDS

    kinds = {kind.strip(" '") for kind in V163_KINDS.split(",")}
    assert set(providers.PROVIDERS) == kinds
    # Only Drive and Dropbox connect through OAuth.
    assert {k for k, p in providers.PROVIDERS.items() if p.oauth} == {
        "gdrive",
        "dropbox",
    }


@pytest.mark.parametrize(
    "kind, config, secrets, message",
    [
        ("local", {"path": "/etc"}, {}, "relative"),
        ("local", {"path": "../escape"}, {}, "path"),
        ("local", {}, {}, "path"),
        ("s3", {"endpoint": "ftp://x", "bucket": "b"}, {}, "endpoint"),
        ("s3", {"endpoint": "https://u:p@x", "bucket": "b"}, {}, "endpoint"),
        ("s3", {"endpoint": "https://x", "bucket": "Bad Bucket"}, {}, "bucket"),
        (
            "s3",
            {"endpoint": "https://x", "bucket": "b1", "bucket_lookup": "x"},
            {},
            "lookup",
        ),
        ("b2", {"bucket": "-b"}, {}, "bucket"),
        ("sftp", {"host": "-oProxyCommand=x", "user": "u", "path": "p"}, {}, "host"),
        ("sftp", {"host": "h", "user": "u -x", "path": "p"}, {}, "user"),
        ("sftp", {"host": "h", "user": "u", "path": "p", "port": 70000}, {}, "port"),
        ("sftp", {"host": "h", "user": "u", "path": "a\nb"}, {}, "path"),
        ("gdrive", {"path": "crate", "unknown": 1}, {}, "unknown"),
        ("dropbox", {"path": "crate"}, {"token": "not json"}, "token"),
    ],
)
def test_bad_configurations_are_refused(kind, config, secrets, message):
    with pytest.raises(DestinationError) as error:
        providers.validate(kind, config, secrets)
    assert message in str(error.value).lower()


def test_secrets_go_to_the_secret_payload_and_never_to_the_config():
    config, secrets = providers.validate(
        "s3",
        {
            "endpoint": "https://acc.r2.cloudflarestorage.com/",
            "bucket": "crate-backups",
            "prefix": "/db/",
            "region": "auto",
        },
        {"access_key_id": "AKID", "secret_access_key": SECRET},
    )
    assert config == {
        "endpoint": "https://acc.r2.cloudflarestorage.com",
        "bucket": "crate-backups",
        "prefix": "db",
        "region": "auto",
        "bucket_lookup": "auto",
    }
    assert secrets == {"access_key_id": "AKID", "secret_access_key": SECRET}
    # A secret sent as configuration is refused instead of stored in clear.
    with pytest.raises(DestinationError):
        providers.validate("s3", {**config, "secret_access_key": SECRET}, {})


def test_missing_required_secrets_are_reported_once_the_destination_is_used():
    provider = providers.PROVIDERS["s3"]
    assert provider.missing_secrets({"access_key_id": "a"}) == ["secret_access_key"]
    assert providers.PROVIDERS["local"].missing_secrets({}) == []
    # Drive needs a token from the OAuth flow (or rclone authorize).
    assert providers.PROVIDERS["gdrive"].missing_secrets({}) == ["token"]


def test_restic_targets_per_kind(tmp_path):
    backup_dir = tmp_path
    cases = {
        "local": ({"path": "restic/main"}, {}, f"{tmp_path}/restic/main"),
        "s3": (
            {
                "endpoint": "https://acc.r2.cloudflarestorage.com",
                "bucket": "crate",
                "prefix": "pg",
                "region": "auto",
                "bucket_lookup": "path",
            },
            {"access_key_id": "AKID", "secret_access_key": SECRET},
            "s3:https://acc.r2.cloudflarestorage.com/crate/pg",
        ),
        "b2": (
            {"bucket": "crate", "prefix": ""},
            {"key_id": "k", "application_key": SECRET},
            "b2:crate:/",
        ),
        "gdrive": (
            {"path": "crate-backups", "client_id": "cid"},
            {
                "client_secret": SECRET,
                "token": '{"access_token":"a","refresh_token":"r"}',
            },
            "rclone:cratebk:crate-backups",
        ),
        "dropbox": (
            {"path": "crate"},
            {"token": '{"access_token":"a","refresh_token":"r"}'},
            "rclone:cratebk:crate",
        ),
    }
    for kind, (config, secrets, url) in cases.items():
        target = providers.restic_target(
            kind, config, secrets, backup_dir=backup_dir, work_dir=tmp_path
        )
        assert target.repository == url, kind
        # Secrets travel in the environment, never in the arguments.
        assert SECRET not in " ".join(target.options + [target.repository]), kind

    s3 = providers.restic_target(
        "s3", *cases["s3"][:2], backup_dir=backup_dir, work_dir=tmp_path
    )
    assert s3.env["AWS_ACCESS_KEY_ID"] == "AKID"
    assert s3.env["AWS_SECRET_ACCESS_KEY"] == SECRET
    assert s3.env["AWS_DEFAULT_REGION"] == "auto"
    assert "s3.bucket-lookup=path" in s3.options
    assert SECRET in s3.secret_values

    drive = providers.restic_target(
        "gdrive", *cases["gdrive"][:2], backup_dir=backup_dir, work_dir=tmp_path
    )
    assert drive.env["RCLONE_CONFIG_CRATEBK_TYPE"] == "drive"
    assert drive.env["RCLONE_CONFIG_CRATEBK_SCOPE"] == "drive.file"
    assert drive.env["RCLONE_CONFIG_CRATEBK_CLIENT_ID"] == "cid"
    assert drive.env["RCLONE_CONFIG_CRATEBK_CLIENT_SECRET"] == SECRET


def test_sftp_uses_the_generated_key_and_pins_the_host(tmp_path):
    private, public = generate_ssh_keypair("crate-backups@test")
    assert private.startswith("-----BEGIN OPENSSH PRIVATE KEY-----")
    assert public.startswith("ssh-ed25519 ") and public.endswith(" crate-backups@test")

    config = {
        "host": "u1.your-storagebox.de",
        "port": 23,
        "user": "u1",
        "path": "crate",
    }
    first = providers.restic_target(
        "sftp", config, {"private_key": private}, backup_dir=tmp_path, work_dir=tmp_path
    )
    assert first.repository == "sftp:u1@u1.your-storagebox.de:crate"
    command = next(o for o in first.options if o.startswith("sftp.command="))
    assert "-p 23" in command and "BatchMode=yes" in command
    # First contact learns the host key; later ones require it.
    assert "StrictHostKeyChecking=accept-new" in command
    key_file = tmp_path / "id_ed25519"
    assert key_file.read_text() == private
    assert oct(key_file.stat().st_mode & 0o777) == "0o600"
    assert private not in " ".join(first.options)

    pinned = providers.restic_target(
        "sftp",
        {**config, "known_hosts": "[u1.your-storagebox.de]:23 ssh-ed25519 AAAA"},
        {"private_key": private},
        backup_dir=tmp_path,
        work_dir=tmp_path,
    )
    command = next(o for o in pinned.options if o.startswith("sftp.command="))
    assert "StrictHostKeyChecking=yes" in command
    assert (
        (tmp_path / "known_hosts").read_text().startswith("[u1.your-storagebox.de]:23")
    )


def test_rclone_probe_remotes_reach_the_same_place(tmp_path):
    s3 = providers.rclone_remote(
        "s3",
        {"endpoint": "https://minio:9000", "bucket": "b", "prefix": "p", "region": ""},
        {"access_key_id": "AK", "secret_access_key": SECRET},
        backup_dir=tmp_path,
        work_dir=tmp_path,
    )
    assert s3.path == "cratebk:b/p"
    assert s3.env["RCLONE_CONFIG_CRATEBK_TYPE"] == "s3"
    assert s3.env["RCLONE_CONFIG_CRATEBK_ENDPOINT"] == "https://minio:9000"
    assert s3.env["RCLONE_CONFIG_CRATEBK_SECRET_ACCESS_KEY"] == SECRET

    local = providers.rclone_remote(
        "local", {"path": "restic"}, {}, backup_dir=tmp_path, work_dir=tmp_path
    )
    assert local.path == f"cratebk:{tmp_path}/restic"


def test_location_summaries_carry_no_secret():
    assert (
        providers.location_summary(
            "s3", {"endpoint": "https://e", "bucket": "b", "prefix": "p"}
        )
        == "https://e/b/p"
    )
    assert (
        providers.location_summary(
            "sftp", {"host": "h", "user": "u", "path": "x", "port": 23}
        )
        == "u@h:23/x"
    )
    assert (
        providers.location_summary("gdrive", {"path": "crate"}) == "Google Drive: crate"
    )


def test_the_sftp_probe_asks_for_the_pinned_host_key_type(tmp_path):
    private, _ = generate_ssh_keypair("t")
    remote = providers.rclone_remote(
        "sftp",
        {
            "host": "h",
            "user": "u",
            "path": "p",
            "port": 23,
            "known_hosts": "[h]:23 ssh-ed25519 AAAA\n[h]:23 ecdsa-sha2-nistp256 BBBB",
        },
        {"private_key": private},
        backup_dir=tmp_path,
        work_dir=tmp_path,
    )
    assert remote.env["RCLONE_CONFIG_CRATEBK_HOST_KEY_ALGORITHMS"] == (
        "ssh-ed25519 ecdsa-sha2-nistp256"
    )
    assert remote.env["RCLONE_CONFIG_CRATEBK_PORT"] == "23"
    assert private not in " ".join(remote.env.values())
