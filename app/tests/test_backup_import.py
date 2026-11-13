"""``python -m crate.backups.cli import-destination``: BK0's repositories move in (BK6)."""

from __future__ import annotations

import io
import json

import pytest

from crate.backups import cli, importer
from crate.backups.destinations import load_destination_secrets
from crate.backups.local import BackupError
from crate.backups.providers import DestinationError
from crate.backups.restic import ResticError

PASSWORD = "sidecar-restic-password-0123456789"
R2_SECRET = "r2-secret-access-key-abcdefghijkl"
TOKEN = json.dumps(
    {
        "access_token": "ya29.drive-access",
        "refresh_token": "1//drive-refresh",
        "token_type": "Bearer",
        "expiry": "2026-11-13T10:00:00Z",
    }
)
SIDECAR_SNAPSHOTS = [
    {
        "id": "a1b2c3d4",
        "time": "2026-11-09T03:00:00Z",
        "host": "crate",
        "tags": ["weekly", "dump:crate-20261109.sql.gz"],
        "paths": ["/crate.sql.gz"],
    },
    {
        "id": "e5f6a7b8",
        "time": "2026-11-01T03:00:00Z",
        "host": "crate",
        "tags": ["monthly", "dump:crate-202611.sql.gz"],
        "paths": ["/crate.sql.gz"],
    },
]

# What `docker exec crate-backup-offsite env` prints, trimmed.
SIDECAR_ENV = f"""\
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RESTIC_PASSWORD={PASSWORD}
CRATE_OFFSITE_R2_ACCOUNT_ID=0123abcd
CRATE_OFFSITE_R2_BUCKET=crate-backups
CRATE_OFFSITE_R2_PATH=
CRATE_OFFSITE_R2_ACCESS_KEY_ID=r2-access-key
CRATE_OFFSITE_R2_SECRET_ACCESS_KEY={R2_SECRET}
CRATE_OFFSITE_GDRIVE_PATH=crate-backups
RCLONE_CONFIG_GDRIVE_TYPE=drive
RCLONE_CONFIG_GDRIVE_SCOPE=drive.file
RCLONE_CONFIG_GDRIVE_CLIENT_ID=1234-desktop.apps.googleusercontent.com
RCLONE_CONFIG_GDRIVE_CLIENT_SECRET=GOCSPX-drive-client-secret
RCLONE_CONFIG_GDRIVE_TOKEN={TOKEN}
"""


class Opener:
    def __init__(self, snapshots=SIDECAR_SNAPSHOTS, error: Exception | None = None):
        self.snapshots = snapshots
        self.error = error
        self.calls: list[tuple] = []

    def __call__(self, kind, config, credentials, password):
        self.calls.append((kind, dict(config), dict(credentials), password))
        if self.error is not None:
            raise self.error
        return importer.OpenedRepository(list(self.snapshots), 4_200_000)


@pytest.fixture
def opener(monkeypatch):
    fake = Opener()
    monkeypatch.setattr(importer, "open_existing_repository", fake)
    return fake


@pytest.fixture
def queued(monkeypatch):
    created: list[tuple] = []

    def create(task_type, params, dedup_key=""):
        created.append((task_type, params, dedup_key))
        return f"task-{len(created)}"

    monkeypatch.setattr("crate.db.repositories.tasks.create_task_dedup", create)
    return created


def _row(destination_id: str) -> dict:
    from crate.db.queries.backup_destinations import get_backup_destination

    row = get_backup_destination(destination_id)
    assert row is not None
    return row


def _import_r2(**overrides):
    values = {
        "kind": "s3",
        "name": "Cloudflare R2",
        "config": {
            "endpoint": "https://0123abcd.r2.cloudflarestorage.com",
            "bucket": "crate-backups",
            "region": "auto",
        },
        "credentials": {
            "access_key_id": "r2-access-key",
            "secret_access_key": R2_SECRET,
        },
        "repository_password": PASSWORD,
    }
    values.update(overrides)
    return importer.import_destination(**values)


# ── secrets and settings ──────────────────────────────────────────


def test_secret_stream_reads_json_and_env_lines():
    assert importer.parse_secret_stream('{"repository_password": "x", "n": null}') == {
        "repository_password": "x"
    }
    parsed = importer.parse_secret_stream(
        "# comment\nexport RESTIC_PASSWORD='quoted=value'\nTOKEN={\"a\":1}\nnoise\n"
    )
    assert parsed == {"RESTIC_PASSWORD": "quoted=value", "TOKEN": '{"a":1}'}
    with pytest.raises(DestinationError):
        importer.parse_secret_stream("{not json")


def test_secrets_come_from_their_name_the_import_prefix_or_the_sidecar():
    source = importer.parse_secret_stream(SIDECAR_ENV)
    credentials, password = importer.read_secrets("s3", source)
    assert password == PASSWORD
    assert credentials == {
        "access_key_id": "r2-access-key",
        "secret_access_key": R2_SECRET,
    }
    credentials, _ = importer.read_secrets(
        "gdrive", {**source, "CRATE_IMPORT_TOKEN": '{"access_token": "other"}'}
    )
    assert credentials["token"] == '{"access_token": "other"}'
    assert credentials["client_secret"] == "GOCSPX-drive-client-secret"


def test_a_missing_or_short_password_is_refused():
    with pytest.raises(DestinationError, match="repository password is missing"):
        importer.read_secrets("s3", {})
    with pytest.raises(DestinationError, match="at least"):
        importer.read_secrets("s3", {"RESTIC_PASSWORD": "short"})


def test_sidecar_settings_give_the_same_repositories():
    source = importer.parse_secret_stream(SIDECAR_ENV)
    assert importer.sidecar_config("s3", source) == {
        "endpoint": "https://0123abcd.r2.cloudflarestorage.com",
        "bucket": "crate-backups",
        "region": "auto",
    }
    assert importer.sidecar_config("gdrive", source) == {
        "path": "crate-backups",
        "client_id": "1234-desktop.apps.googleusercontent.com",
    }
    with pytest.raises(DestinationError):
        importer.sidecar_config("b2", source)


# ── opening the repository ────────────────────────────────────────


class FakeRunner:
    calls: list[tuple[str, ...]] = []
    fail_on: str | None = None

    def __init__(self, target, password, work_dir, **kwargs):
        self.password = password

    def run(self, *arguments, **kwargs):
        FakeRunner.calls.append(arguments)
        if arguments[0] == FakeRunner.fail_on:
            raise ResticError(f"restic failed: wrong password {self.password}")
        return ""

    def json(self, *arguments, **kwargs):
        FakeRunner.calls.append(arguments)
        if arguments[0] == "snapshots":
            return [
                {
                    "short_id": "a1b2c3d4",
                    "time": "2026-11-09T03:00:00Z",
                    "hostname": "crate",
                    "tags": ["weekly"],
                    "paths": ["/crate.sql.gz"],
                }
            ]
        return {"total_size": 1234}


@pytest.fixture
def runner(monkeypatch):
    FakeRunner.calls = []
    FakeRunner.fail_on = None
    monkeypatch.setattr(importer, "Runner", FakeRunner)
    monkeypatch.setattr(importer, "tools_available", lambda: [])
    return FakeRunner


def test_opening_never_initialises_a_repository(runner):
    opened = importer.open_existing_repository(
        "s3",
        {"endpoint": "https://r2.example", "bucket": "crate-backups"},
        {"access_key_id": "id", "secret_access_key": R2_SECRET},
        PASSWORD,
    )
    assert runner.calls[0] == ("cat", "config")
    assert all(call[0] != "init" for call in runner.calls)
    assert opened.repository_bytes == 1234
    assert opened.sidecar_snapshots == 1


def test_a_repository_that_does_not_open_stops_the_import_without_secrets(runner):
    runner.fail_on = "cat"
    with pytest.raises(BackupError) as caught:
        importer.open_existing_repository(
            "s3",
            {"endpoint": "https://r2.example", "bucket": "crate-backups"},
            {"access_key_id": "id", "secret_access_key": R2_SECRET},
            PASSWORD,
        )
    assert "Cannot open the repository" in str(caught.value)
    assert PASSWORD not in str(caught.value)
    assert all(call[0] != "init" for call in runner.calls)


def test_opening_needs_the_backup_tools(monkeypatch):
    monkeypatch.setattr(importer, "tools_available", lambda: ["restic"])
    with pytest.raises(BackupError, match="crate-maintenance-worker"):
        importer.open_existing_repository("local", {"path": "x"}, {}, PASSWORD)


# ── the import ────────────────────────────────────────────────────


def test_import_stores_encrypted_secrets_and_the_sidecar_listing(pg_db, opener, queued):
    del pg_db
    result = _import_r2()

    assert result.action == "created"
    destination = result.destination
    row = _row(destination["id"])
    assert PASSWORD not in json.dumps(row, default=str)
    assert R2_SECRET not in json.dumps(row, default=str)
    secrets = load_destination_secrets(row)
    assert secrets.repository_password == PASSWORD
    assert secrets.credentials["secret_access_key"] == R2_SECRET
    # The Admin snapshots tab reads this listing: the sidecar's snapshots show.
    assert [s["id"] for s in row["snapshots"]] == ["a1b2c3d4", "e5f6a7b8"]
    assert row["snapshot_count"] == 2
    assert row["status"] == "ok" and row["enabled"]
    assert row["repository_initialized_at"] is not None
    assert destination["recovery_kit_confirmed_at"] is None
    assert queued == [
        (
            "backup_test_destination",
            {"destination_id": destination["id"]},
            f"backup_test_destination:{destination['id']}",
        )
    ]
    assert any("--group-by host" in note for note in result.notes)


def test_importing_the_same_settings_twice_changes_nothing(pg_db, opener, queued):
    del pg_db
    first = _import_r2()
    second = _import_r2()

    assert second.action == "unchanged"
    assert second.destination["id"] == first.destination["id"]
    assert len(opener.calls) == 1
    assert len(queued) == 1


def test_an_existing_destination_is_kept_unless_replace(pg_db, opener, queued):
    del pg_db
    first = _import_r2()
    other_password = "another-restic-password-0123456789"
    with pytest.raises(importer.ImportConflict, match="--replace"):
        _import_r2(name="cloudflare  r2", repository_password=other_password)
    with pytest.raises(importer.ImportConflict):
        _import_r2(name="Somewhere else", repository_password=other_password)
    assert len(opener.calls) == 1

    replaced = _import_r2(repository_password=other_password, replace=True)
    assert replaced.action == "replaced"
    assert replaced.destination["id"] == first.destination["id"]
    row = _row(first.destination["id"])
    assert load_destination_secrets(row).repository_password == other_password
    assert row["recovery_kit_confirmed_at"] is None
    assert row["status"] == "ok"


def test_a_repository_that_does_not_open_stores_nothing(pg_db, monkeypatch, queued):
    del pg_db
    from crate.db.queries.backup_destinations import list_backup_destinations

    monkeypatch.setattr(
        importer,
        "open_existing_repository",
        Opener(error=BackupError("Cannot open the repository")),
    )
    with pytest.raises(BackupError):
        _import_r2()
    assert list_backup_destinations() == []
    assert queued == []


def test_drive_needs_the_client_that_minted_the_token(pg_db, opener, queued):
    del pg_db
    with pytest.raises(DestinationError, match="OAuth client"):
        importer.import_destination(
            kind="gdrive",
            name="Google Drive",
            config={"path": "crate-backups"},
            credentials={"token": TOKEN},
            repository_password=PASSWORD,
        )
    result = importer.import_destination(
        kind="gdrive",
        name="Google Drive",
        config={
            "path": "crate-backups",
            "client_id": "1234.apps.googleusercontent.com",
        },
        credentials={"token": TOKEN, "client_secret": "GOCSPX-secret"},
        repository_password=PASSWORD,
    )
    assert result.destination["config"]["client_id"].startswith("1234")
    assert opener.calls[-1][0] == "gdrive"


def test_sftp_cannot_be_imported(pg_db):
    del pg_db
    with pytest.raises(DestinationError, match="cannot be imported"):
        importer.import_destination(
            kind="sftp",
            name="Box",
            config={},
            credentials={},
            repository_password=PASSWORD,
        )


# ── the command ───────────────────────────────────────────────────


def test_the_command_imports_both_sidecar_repositories_from_stdin(
    pg_db, opener, queued, capsys
):
    del pg_db
    args = ["import-destination", "--secrets-from", "stdin", "--from-sidecar"]

    def run(*extra: str) -> int:
        namespace = _parse([*args, *extra])
        return cli.import_command(namespace, stdin=io.StringIO(SIDECAR_ENV))

    assert run("--kind", "s3", "--name", "Cloudflare R2") == 0
    assert run("--kind", "gdrive", "--name", "Google Drive") == 0
    out = capsys.readouterr().out
    assert "Cloudflare R2" in out and "Google Drive" in out
    assert "2 snapshots" in out and "--group-by host" in out
    assert PASSWORD not in out and R2_SECRET not in out
    s3_call, drive_call = opener.calls
    assert s3_call[1]["endpoint"] == "https://0123abcd.r2.cloudflarestorage.com"
    assert drive_call[1]["client_id"] == "1234-desktop.apps.googleusercontent.com"
    assert drive_call[3] == PASSWORD

    assert run("--kind", "s3", "--name", "Cloudflare R2") == 0
    assert "already imported" in capsys.readouterr().out


def test_the_command_exit_codes(pg_db, opener, queued, monkeypatch, capsys):
    del pg_db
    monkeypatch.setenv("RESTIC_PASSWORD", PASSWORD)
    monkeypatch.setenv("CRATE_IMPORT_ACCESS_KEY_ID", "r2-access-key")
    monkeypatch.setenv("CRATE_IMPORT_SECRET_ACCESS_KEY", R2_SECRET)
    base = [
        "import-destination",
        "--kind",
        "s3",
        "--name",
        "R2",
        "--endpoint",
        "https://0123abcd.r2.cloudflarestorage.com",
        "--bucket",
        "crate-backups",
    ]
    assert cli.main([*base, "--no-test"]) == 0
    assert queued == []
    monkeypatch.setenv("RESTIC_PASSWORD", "another-restic-password-0123456789")
    assert cli.main([*base, "--no-test"]) == 3
    assert cli.main([*base, "--bucket", "Bad Bucket!"]) == 2
    monkeypatch.setattr(
        importer,
        "open_existing_repository",
        Opener(error=BackupError("Cannot open the repository")),
    )
    assert cli.main([*base, "--replace", "--no-test"]) == 1
    err = capsys.readouterr().err
    assert "Cannot open the repository" in err
    assert PASSWORD not in err


def test_secrets_have_no_command_line_option():
    help_text = cli.IMPORT_HELP
    assert "--group-by host" in help_text and "D6" in help_text
    with pytest.raises(SystemExit):
        _parse(["import-destination", "--kind", "s3", "--name", "x", "--password", "p"])


def test_before_upgrade_is_a_no_op_while_the_engine_is_off(monkeypatch, capsys):
    monkeypatch.setenv("CRATE_LOCAL_BACKUPS_ENABLED", "false")

    def refuse(*args, **kwargs):  # pragma: no cover - must not be reached
        raise AssertionError("nothing may be queued")

    monkeypatch.setattr(cli, "list_before_upgrade_policies", refuse)
    monkeypatch.setattr(cli, "create_task_dedup", refuse)
    assert cli.main(["before-upgrade", "--wait"]) == 0
    assert "engine is off" in capsys.readouterr().out


def _parse(argv: list[str]):
    """The parsed arguments ``cli.main`` would act on."""
    captured = {}

    def capture(namespace, **kwargs):
        captured["args"] = namespace
        return 0

    original = cli.import_command
    cli.import_command = capture  # type: ignore[assignment]
    try:
        cli.main(argv)
    finally:
        cli.import_command = original  # type: ignore[assignment]
    return captured["args"]
