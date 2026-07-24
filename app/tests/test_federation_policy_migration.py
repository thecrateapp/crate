from __future__ import annotations

import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "crate/db/migrations/versions/065_federation_policy_and_quota_state.py"
)


def _module():
    spec = importlib.util.spec_from_file_location("migration_065", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_policy_migration_adds_typed_revisioned_grants_and_recovery_state():
    source = MIGRATION.read_text()

    assert 'revision = "065"' in source
    assert 'down_revision = "064"' in source
    for column in (
        "grant_uid",
        "policy_revision",
        "constraints_version",
        "subject_selector",
        "valid_from",
        "valid_until",
        "revoked_at",
    ):
        assert column in source
    assert "CREATE TABLE federation_quota_reservations" in source
    assert "jsonb_typeof(constraints_json) = 'object'" in source
    assert "DROP TABLE IF EXISTS federation_quota_reservations" in source


def test_policy_migration_upgrade_and_downgrade_are_callable():
    module = _module()

    assert callable(module.upgrade)
    assert callable(module.downgrade)
