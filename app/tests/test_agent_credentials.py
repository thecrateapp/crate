import base64
import json
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from crate import agent_credentials_cli as cli
from crate.agent_access import (
    ACTION_GRANTS,
    ALLOWED_GRANTS,
    PILOT_GRANTS,
    TOKEN_PREFIX,
    actions_enabled,
    digest_token,
    generate_token,
)
from crate.db.repositories import agent_credentials as credentials
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text


def _expiry():
    return datetime.now(UTC) + timedelta(days=1)


def _issue():
    return credentials.create_credential(
        "Library inspector", {"library.health.read"}, _expiry()
    )


def test_opaque_token_contains_256_random_bits_and_stable_digest():
    first, second = generate_token(), generate_token()
    assert first != second
    assert first.startswith(TOKEN_PREFIX)
    assert len(base64.urlsafe_b64decode(first[len(TOKEN_PREFIX) :] + "=")) == 32
    assert digest_token(first) == digest_token(first)
    assert digest_token(first) != digest_token(second)
    assert len(digest_token(first)) == 64


@pytest.mark.parametrize(
    "token",
    [
        None,
        "",
        "jwt.token.value",
        "crate_mcp_short",
        "crate_mcp_" + "a" * 44,
        "crate_mcp_" + "a" * 43 + "\n",
    ],
)
def test_invalid_token_rejected_without_database_access(token, monkeypatch):
    def forbidden():
        pytest.fail("Malformed tokens must not query the database")

    monkeypatch.setattr(credentials, "read_scope", forbidden)
    with pytest.raises(ValueError, match="Invalid agent credential"):
        digest_token(token)
    assert credentials.resolve_credential(token) is None


def test_create_stores_only_digest_and_independent_immutable_identity(pg_db):
    issued = _issue()
    principal = credentials.resolve_credential(issued.token)
    assert principal == issued.principal
    assert principal.grants == frozenset({"library.health.read"})
    with pytest.raises(FrozenInstanceError):
        principal.name = "Changed"
    assert issued.token not in repr(issued)
    with read_scope() as session:
        stored = dict(
            session.execute(text("SELECT * FROM agent_credentials")).mappings().one()
        )
        audit = dict(
            session.execute(
                text(
                    "SELECT * FROM audit_log WHERE action = 'agent.credential.created'"
                )
            )
            .mappings()
            .one()
        )
    assert stored["token_digest"] == digest_token(issued.token)
    assert issued.token not in json.dumps(stored, default=str)
    assert issued.token not in json.dumps(audit, default=str)
    assert audit["user_id"] is None
    assert audit["details_json"] == {
        "principal_id": principal.id,
        "credential_id": principal.credential_id,
    }


@pytest.mark.parametrize(
    "value,enabled",
    [(None, False), ("false", False), ("true", True), ("TRUE", True), ("1", False)],
)
def test_action_feature_requires_explicit_true(monkeypatch, value, enabled):
    if value is None:
        monkeypatch.delenv("CRATE_MCP_ACTIONS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", value)
    assert actions_enabled() is enabled


def test_action_grants_are_explicit_and_do_not_expand_existing_diagnostic_grants(pg_db):
    assert ACTION_GRANTS == {
        "curation.shows.write",
        "library.health.run",
        "library.repair.photo_flag",
        "ops.jobs.retry",
        "ops.jobs.cancel_pending",
        "library.quality.run",
        "library.repair.run",
        "library.metadata.write",
        "library.enrichment.run",
        "library.analysis.run",
        "library.sync.run",
        "library.metadata.export",
        "library.metadata.rehydrate",
        "ops.jobs.cancel",
        "ops.schedules.run",
        "ops.schedules.write",
        "ops.runtime.write",
        "editorial.prepare",
        "library.acquisition.write",
    }
    assert not ACTION_GRANTS & PILOT_GRANTS
    assert ALLOWED_GRANTS == PILOT_GRANTS | ACTION_GRANTS | {
        "curation.shows.read",
        "library.acquisition.search",
        "ops.audit.read",
        "ops.jobs.manage_instance",
        "ops.schedules.read",
        "ops.runtime.read",
        "editorial.read",
        "editorial.write",
        "editorial.publish",
    }
    issued = credentials.create_credential(
        "Maintenance integration", ACTION_GRANTS, _expiry()
    )
    assert credentials.resolve_credential(issued.token).grants == ACTION_GRANTS
    assert credentials.resolve_credential(_issue().token).grants == {
        "library.health.read"
    }


@pytest.mark.parametrize(
    "name,grants",
    [
        ("", {"ops.status.read"}),
        ("a" * 121, {"ops.status.read"}),
        ("bad\nname", {"ops.status.read"}),
        ("valid", set()),
        ("valid", {"ops.tasks.manage"}),
        ("valid", "ops.status.read"),
    ],
)
def test_create_rejects_invalid_name_and_grants(name, grants):
    with pytest.raises((ValueError, TypeError)):
        credentials.create_credential(name, grants, _expiry())


@pytest.mark.parametrize(
    "expiry", [datetime(2000, 1, 1, tzinfo=UTC), datetime(2030, 1, 1), None]
)
def test_create_rejects_expired_or_unzoned_expiry(expiry):
    with pytest.raises(ValueError):
        credentials.create_credential("Inspector", PILOT_GRANTS, expiry)


def test_credentials_do_not_share_identity_or_grants(pg_db):
    first = _issue()
    second = credentials.create_credential(
        "Operations inspector", {"ops.jobs.read"}, _expiry()
    )
    assert first.principal.id != second.principal.id
    assert credentials.resolve_credential(first.token).grants == frozenset(
        {"library.health.read"}
    )
    assert credentials.resolve_credential(second.token).grants == frozenset(
        {"ops.jobs.read"}
    )
    assert credentials.resolve_credential(generate_token()) is None


def test_each_resolution_observes_scope_change_expiry_disable_and_revoke(pg_db):
    issued = _issue()
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE agent_principals SET grants = ARRAY['ops.jobs.read'] WHERE id = :id"
            ),
            {"id": issued.principal.id},
        )
    assert credentials.resolve_credential(issued.token).grants == frozenset(
        {"ops.jobs.read"}
    )
    assert credentials.set_principal_enabled(issued.principal.id, False)
    assert credentials.resolve_credential(issued.token) is None
    assert not credentials.set_principal_enabled(issued.principal.id, False)
    assert credentials.set_principal_enabled(issued.principal.id, True)
    assert credentials.resolve_credential(issued.token) is not None
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE agent_credentials SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day' WHERE id = :id"
            ),
            {"id": issued.principal.credential_id},
        )
    assert credentials.resolve_credential(issued.token) is None
    assert credentials.revoke_credential(issued.principal.credential_id)
    assert credentials.resolve_credential(issued.token) is None


def test_list_never_returns_digest_or_token(pg_db):
    issued = _issue()
    rows = credentials.list_credentials()
    assert len(rows) == 1
    assert rows[0]["credential_id"] == issued.principal.credential_id
    assert rows[0]["principal_id"] == issued.principal.id
    assert rows[0]["grants"] == ["library.health.read"]
    encoded = json.dumps(rows, default=str)
    assert issued.token not in encoded
    assert digest_token(issued.token) not in encoded
    assert "token_digest" not in rows[0]


def test_rotation_preserves_identity_and_atomically_revokes_old_secret(pg_db):
    old = _issue()
    new = credentials.rotate_credential(old.principal.credential_id, _expiry())
    assert new.principal.id == old.principal.id
    assert new.principal.credential_id != old.principal.credential_id
    assert new.principal.grants == old.principal.grants
    assert credentials.resolve_credential(old.token) is None
    assert credentials.resolve_credential(new.token) == new.principal
    with pytest.raises(ValueError, match="revoked"):
        credentials.rotate_credential(old.principal.credential_id, _expiry())
    assert len(credentials.list_credentials()) == 2


def test_failed_rotation_rolls_back_revocation(pg_db, monkeypatch):
    old = _issue()

    def fail_issue(*args, **kwargs):
        raise RuntimeError("Insert failed")

    monkeypatch.setattr(credentials, "_issue", fail_issue)
    with pytest.raises(RuntimeError, match="Insert failed"):
        credentials.rotate_credential(old.principal.credential_id, _expiry())
    assert credentials.resolve_credential(old.token) == old.principal
    assert len(credentials.list_credentials()) == 1


def test_revoke_is_immediate_and_idempotent(pg_db):
    issued = _issue()
    assert credentials.revoke_credential(issued.principal.credential_id)
    assert credentials.resolve_credential(issued.token) is None
    assert not credentials.revoke_credential(issued.principal.credential_id)
    assert not credentials.revoke_credential(str(uuid4()))
    assert not credentials.set_principal_enabled(str(uuid4()), False)


def test_disabled_integration_cannot_rotate(pg_db):
    issued = _issue()
    credentials.set_principal_enabled(issued.principal.id, False)
    with pytest.raises(ValueError, match="disabled"):
        credentials.rotate_credential(issued.principal.credential_id, _expiry())


def test_supplied_session_composes_credential_lifecycle_and_rolls_back(pg_db):
    class Rollback(Exception):
        pass

    with pytest.raises(Rollback), transaction_scope() as session:
        issued = credentials.create_credential(
            "Transactional inspector", PILOT_GRANTS, _expiry(), session=session
        )
        assert (
            credentials.resolve_credential(issued.token, session=session)
            == issued.principal
        )
        assert len(credentials.list_credentials(session=session)) == 1
        new = credentials.rotate_credential(
            issued.principal.credential_id, _expiry(), session=session
        )
        assert credentials.revoke_credential(
            new.principal.credential_id, session=session
        )
        assert credentials.set_principal_enabled(
            new.principal.id, False, session=session
        )
        raise Rollback()
    assert credentials.list_credentials() == []


@pytest.mark.parametrize(
    "operation",
    [
        lambda: credentials.revoke_credential("bad"),
        lambda: credentials.rotate_credential("bad", _expiry()),
        lambda: credentials.set_principal_enabled("bad", True),
        lambda: credentials.set_principal_enabled(str(uuid4()), "true"),
    ],
)
def test_invalid_identifiers_and_boolean_rejected(operation):
    with pytest.raises((ValueError, TypeError)):
        operation()


def test_cli_create_list_rotate_revoke_only_prints_secret_on_issuance(pg_db, capsys):
    assert (
        cli.main(
            [
                "create",
                "--name",
                "Remote agent",
                "--grant",
                "library.health.read",
                "--expires-in-days",
                "7",
            ]
        )
        == 0
    )
    created = json.loads(capsys.readouterr().out)
    assert credentials.resolve_credential(created["token"]) is not None
    assert cli.main(["list"]) == 0
    listed = capsys.readouterr().out
    assert created["token"] not in listed
    assert digest_token(created["token"]) not in listed
    assert cli.main(["rotate", created["credential_id"]]) == 0
    rotated = json.loads(capsys.readouterr().out)
    assert created["principal_id"] == rotated["principal_id"]
    assert credentials.resolve_credential(created["token"]) is None
    assert cli.main(["revoke", rotated["credential_id"]]) == 0
    assert json.loads(capsys.readouterr().out)["revoked"] is True
    assert credentials.resolve_credential(rotated["token"]) is None


def test_cli_issues_only_explicit_action_grants(pg_db, capsys):
    assert (
        cli.main(
            [
                "create",
                "--name",
                "Photo maintenance",
                "--grant",
                "library.health.run",
                "--grant",
                "library.repair.photo_flag",
                "--expires-in-days",
                "7",
            ]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    principal = credentials.resolve_credential(result["token"])
    assert principal.grants == {"library.health.run", "library.repair.photo_flag"}


def test_cli_validates_expiry_and_hides_database_exceptions(capsys, monkeypatch):
    assert (
        cli.main(
            [
                "create",
                "--name",
                "Inspector",
                "--grant",
                "ops.status.read",
                "--expires-in-days",
                "0",
            ]
        )
        == 2
    )
    assert "between 1 and 365" in capsys.readouterr().err

    def fail_list():
        raise RuntimeError("password=private-database-password")

    monkeypatch.setattr(cli, "list_credentials", fail_list)
    assert cli.main(["list"]) == 1
    result = capsys.readouterr()
    assert "database connectivity" in result.err
    assert "private-database-password" not in result.err
    assert result.out == ""
