"""check_destination tells the S3 probe whether the bucket already exists."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest

from crate.backups import connection
from crate.backups.destinations import DestinationSecrets


def _row(initialized: datetime | None) -> dict:
    return {
        "id": "dest-1",
        "kind": "s3",
        "name": "Cloudflare R2",
        "config": {
            "endpoint": "https://account.r2.cloudflarestorage.com",
            "bucket": "crate-backups",
            "prefix": "",
            "region": "auto",
        },
        "repository_initialized_at": initialized,
    }


@pytest.fixture
def probed(monkeypatch, tmp_path):
    seen: list[dict[str, str]] = []
    secrets = DestinationSecrets(
        credentials={"access_key_id": "AK", "secret_access_key": "SK"},
        repository_password="p" * 32,
    )

    @contextmanager
    def fake_open(row, secrets, *, should_cancel=None, cache_dir=None):
        yield object(), Path(tmp_path)

    monkeypatch.setattr(connection, "tools_available", lambda: [])
    monkeypatch.setattr(connection, "load_destination_secrets", lambda row: secrets)
    monkeypatch.setattr(connection, "open_destination", fake_open)
    monkeypatch.setattr(connection, "backup_dir", lambda: tmp_path)
    monkeypatch.setattr(
        connection,
        "probe_remote",
        lambda remote, **_: seen.append(dict(remote.env)),
    )
    monkeypatch.setattr(connection, "open_or_init", lambda runner: "existing")
    monkeypatch.setattr(connection, "list_snapshots", lambda runner: [])
    monkeypatch.setattr(connection, "compact_snapshots", lambda listed: [])
    monkeypatch.setattr(connection, "repository_size", lambda runner: 0)
    return seen


def test_a_destination_with_a_repository_skips_bucket_creation(probed):
    result = connection.check_destination(
        _row(datetime(2026, 11, 13, tzinfo=timezone.utc))
    )

    assert result.status == "ok", result.error
    assert probed[0]["RCLONE_CONFIG_CRATEBK_NO_CHECK_BUCKET"] == "true"


def test_a_new_destination_may_create_its_bucket(probed):
    result = connection.check_destination(_row(None))

    assert result.status == "ok", result.error
    assert "RCLONE_CONFIG_CRATEBK_NO_CHECK_BUCKET" not in probed[0]
