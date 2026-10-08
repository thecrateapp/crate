from __future__ import annotations

import hashlib
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from unittest.mock import patch


class _Result:
    def __init__(self, rows=(), scalar=None):
        self.rows = list(rows)
        self.scalar = scalar

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None

    def scalar_one(self):
        return self.scalar


class _Connection:
    def __init__(self):
        self.users = [{"id": 5, "subsonic_token": "legacy-credential"}]
        self.credentials = []
        self.lock_count = 0

    def execute(self, statement, params=None):
        sql = str(statement)
        if "pg_advisory_xact_lock" in sql:
            self.lock_count += 1
            return _Result()
        if "SELECT id, subsonic_token" in sql:
            return _Result(row for row in self.users if row["subsonic_token"])
        if "SELECT 1 FROM user_subsonic_credentials" in sql:
            found = [
                {"present": 1}
                for item in self.credentials
                if item["user_id"] == params["user_id"]
            ]
            return _Result(found)
        if "SELECT now()" in sql:
            return _Result(scalar=datetime(2026, 9, 16, tzinfo=timezone.utc))
        if "INSERT INTO user_subsonic_credentials" in sql:
            self.credentials.append(dict(params))
            return _Result()
        if "UPDATE users SET subsonic_token = NULL" in sql:
            for user in self.users:
                if user["id"] == params["user_id"]:
                    user["subsonic_token"] = None
            return _Result()
        raise AssertionError(f"Unexpected SQL: {sql}")


def _migration_module() -> ModuleType:
    root = Path(__file__).resolve().parents[2]
    path = root / "crate/db/migrations/versions/097_opensubsonic_credentials.py"
    assert path.is_file(), "migration 097 is missing"
    spec = importlib.util.spec_from_file_location("opensubsonic_migration_097", path)
    assert spec is not None and spec.loader is not None, "migration 097 is missing"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_legacy_subsonic_tokens_are_encrypted_hashed_and_cleared_once():
    migration = _migration_module()
    connection = _Connection()
    with patch(
        "crate.credentials.store_secret", return_value="opensubsonic:encrypted-ref"
    ) as store_secret:
        first_count = migration.migrate_legacy_subsonic_tokens(connection)
        second_count = migration.migrate_legacy_subsonic_tokens(connection)

    assert first_count == 1
    assert second_count == 0
    store_secret.assert_called_once_with(
        "opensubsonic",
        {"secret": "legacy-credential"},
        session=connection,
    )
    assert connection.credentials == [
        {
            "user_id": 5,
            "secret_ref": "opensubsonic:encrypted-ref",
            "api_key_digest": hashlib.sha256(b"legacy-credential").hexdigest(),
            "now": datetime(2026, 9, 16, tzinfo=timezone.utc),
        }
    ]
    assert connection.users[0]["subsonic_token"] is None
    assert connection.lock_count == 2
