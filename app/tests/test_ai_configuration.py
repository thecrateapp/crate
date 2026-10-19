"""AI configuration and budget behavior on real PostgreSQL."""

import pytest
from crate.ai.contracts import AIConfigurationError
from crate.db.repositories import ai_configuration as config
from crate.db.repositories import ai_usage as usage
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text


def connection(**overrides):
    return config.create_connection(
        {"label": "Local", "provider": "ollama", **overrides}, None
    )


def profile(conn):
    return config.create_profile(
        {
            "label": "Default",
            "connection_id": conn["id"],
            "model_id": "model",
            "config": {},
        },
        None,
    )


def test_configuration_crud_cas_and_immutable_versions(pg_db):
    conn = connection(secret_ref=None)
    assert config.get_connection(conn["id"])["has_secret"] is False
    assert len(config.list_connections()) == 1
    assert (
        config.update_connection(conn["id"], {"label": "Changed"}, 1, None)["revision"]
        == 2
    )
    with pytest.raises(AIConfigurationError):
        config.update_connection(conn["id"], {"enabled": False}, 1, None)
    saved = config.save_model_catalog(conn["id"], [], "ready", 2)
    assert saved["revision"] == 3
    prof = profile(conn)
    assert len(config.list_profiles()) == 1
    version = config.create_profile_version(
        prof["id"],
        {"connection_id": conn["id"], "model_id": "new", "config": {}},
        1,
        None,
    )
    assert version["version"] == 2
    assert config.get_profile_version(prof["id"], 1)["model_id"] == "model"
    with pytest.raises(Exception), transaction_scope() as session:
        session.execute(text("UPDATE ai_profile_versions SET model_id='bad'"))


def test_bindings_rollback_activation_and_atomic_audit(pg_db):
    prof = profile(connection())
    change = {
        "action_id": "shows.extract.text",
        "profile_id": prof["id"],
        "profile_version": 1,
        "enabled": True,
        "expected_revision": 0,
    }
    assert config.configuration_state()["active"] is False
    assert config.list_bindings() == []
    config.apply_bindings([change], None)
    assert config.get_binding(change["action_id"])["revision"] == 1
    with pytest.raises(AIConfigurationError):
        config.apply_bindings(
            [{**change, "action_id": "artists.bio.research"}, change], None
        )
    assert config.get_binding("artists.bio.research") is None
    from crate.ai.actions import ACTIONS

    changes = [
        {
            **change,
            "action_id": action_id,
            "expected_revision": 1 if action_id == change["action_id"] else 0,
        }
        for action_id in ACTIONS
    ]
    state = config.activate_configuration(changes, 0, None)
    assert state["active"] and state["revision"] == 1
    assert len(config.list_bindings()) == 11
    with transaction_scope() as session:
        before = session.execute(text("SELECT count(*) FROM audit_log")).scalar_one()
        with pytest.raises(RuntimeError):
            with session.begin_nested():
                config.update_connection(
                    config.list_connections(session=session)[0]["id"],
                    {"label": "ROLLBACK"},
                    1,
                    None,
                    session=session,
                )
                raise RuntimeError()
        assert (
            session.execute(text("SELECT count(*) FROM audit_log")).scalar_one()
            == before
        )
        assert config.list_connections(session=session)[0]["label"] == "Local"
        assert all(
            set(row[0]) == {"revision"}
            for row in session.execute(
                text(
                    "SELECT details_json FROM audit_log WHERE target_type='ai_configuration'"
                )
            )
        )


def test_reservation_idempotency_limits_unknown_and_summary(pg_db):
    conn = connection(max_concurrent=1, daily_calls=2, daily_tokens=100)
    context = {
        "connection_id": conn["id"],
        "action_id": "shows.extract.text",
        "model_id": "model",
    }
    first = usage.reserve_invocation(
        context, idempotency_key="one", input_tokens=10, output_tokens=20
    )
    assert first["claimed"] and first["claim_token"]
    duplicate = usage.reserve_invocation(
        context, idempotency_key="one", input_tokens=10, output_tokens=20
    )
    assert (
        duplicate["id"] == first["id"]
        and not duplicate["claimed"]
        and duplicate["claim_token"] is None
    )
    with pytest.raises(AIConfigurationError):
        usage.reserve_invocation(
            context, idempotency_key="two", input_tokens=1, output_tokens=1
        )
    finished = usage.finish_invocation(first["id"], None, "timeout")
    assert finished["charged_tokens"] == 30
    usage.finish_invocation(
        first["id"], {"input_tokens": 0, "output_tokens": 0}, "succeeded"
    )
    second = usage.reserve_invocation(
        context, idempotency_key="two", input_tokens=10, output_tokens=20
    )
    usage.finish_invocation(
        second["id"], {"input_tokens": 2, "output_tokens": 3}, "succeeded"
    )
    assert usage.usage_summary()["totals"]["tokens"] == 35
    assert len(usage.list_invocations({})["items"]) == 2
    assert usage.prune_ai_activity()["deleted"] == 0
    with pytest.raises(AIConfigurationError):
        usage.reserve_invocation(
            context, idempotency_key="three", input_tokens=1, output_tokens=1
        )
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT active_invocations FROM ai_provider_connections")
            ).scalar_one()
            == 0
        )


def test_parallel_reservations_have_one_owner_and_respect_shared_limits(pg_db):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    conn = connection(max_concurrent=2, daily_tokens=100)
    context = {
        "connection_id": conn["id"],
        "action_id": "shows.extract.text",
        "model_id": "model",
    }
    gate = Barrier(4)

    def duplicate(_):
        gate.wait()
        return usage.reserve_invocation(
            context, idempotency_key="same", input_tokens=10, output_tokens=20
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        rows = list(executor.map(duplicate, range(4)))
    assert sum(row["claimed"] for row in rows) == 1
    assert len({row["id"] for row in rows}) == 1
    gate = Barrier(3)

    def different(i):
        gate.wait()
        try:
            return usage.reserve_invocation(
                {**context, "action_id": "artists.bio.research"},
                idempotency_key=f"different{i}",
                input_tokens=10,
                output_tokens=20,
            )
        except AIConfigurationError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=3) as executor:
        outcomes = list(executor.map(different, range(3)))
    assert sum(isinstance(result, dict) for result in outcomes) == 1
    assert outcomes.count("AI_CONCURRENCY_LIMIT") == 2
    assert usage.usage_summary()["totals"] == {
        "calls": 2,
        "tokens": 60,
        "unknown_calls": 2,
        "completed": 0,
        "failed": 0,
        "estimated_cost": None,
    }


def test_token_limit_thought_cache_paging_retention_and_unknown(pg_db):
    conn = connection(daily_tokens=100)
    context = {
        "connection_id": conn["id"],
        "action_id": "shows.extract.text",
        "model_id": "model",
    }
    first = usage.reserve_invocation(
        context, idempotency_key="first", input_tokens=10, output_tokens=20
    )
    row = usage.finish_invocation(
        first["id"],
        {
            "input_tokens": 10,
            "output_tokens": 4,
            "thought_tokens": 6,
            "cached_input_tokens": 8,
            "total_tokens": 20,
        },
        "succeeded",
    )
    assert (
        row["charged_tokens"] == 20
        and row["thought_tokens"] == 6
        and row["cached_input_tokens"] == 8
    )
    assert row["total_tokens"] == 20
    second = usage.reserve_invocation(
        context, idempotency_key="second", input_tokens=30, output_tokens=50
    )
    usage.finish_invocation(
        second["id"], {"input_tokens": -1, "output_tokens": 0}, "failed"
    )
    with pytest.raises(AIConfigurationError) as error:
        usage.reserve_invocation(
            context, idempotency_key="over-budget", input_tokens=1, output_tokens=0
        )
    assert error.value.code == "AI_DAILY_TOKEN_LIMIT"
    page = usage.list_invocations({"connection_id": conn["id"]}, limit=1)
    assert len(page["items"]) == 1 and page["next_cursor"]
    next_page = usage.list_invocations({}, limit=1, cursor=page["next_cursor"])
    assert (
        len(next_page["items"]) == 1
        and next_page["items"][0]["id"] != page["items"][0]["id"]
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE ai_invocations SET created_at=NOW()-INTERVAL '91 days'")
        )
    assert usage.list_invocations({})["items"] == []
    assert usage.prune_ai_activity(limit=1)["deleted"] == 1
    assert usage.usage_summary()["totals"]["tokens"] == 100
    assert usage.prune_ai_activity(limit=1)["deleted"] == 1


def test_read_functions_own_rollback_scope_and_no_implicit_write_scope(
    pg_db, monkeypatch
):
    from contextlib import contextmanager

    called = []
    real_read = config.read_scope

    @contextmanager
    def observed():
        with real_read() as session:
            called.append(session)
            yield session

    monkeypatch.setattr(config, "read_scope", observed)
    conn = connection()
    prof = profile(conn)
    for read in (
        config.list_connections,
        lambda: config.get_connection(conn["id"]),
        config.list_profiles,
        lambda: config.get_profile_version(prof["id"], 1),
        config.list_bindings,
        lambda: config.get_binding("shows.extract.text"),
        config.configuration_state,
        lambda: usage.list_invocations({}),
        usage.usage_summary,
    ):
        before = len(called)
        read()
        assert len(called) == before + 1


def test_secret_refs_private_only_and_permissions(pg_db, monkeypatch):
    from cryptography.fernet import Fernet
    from crate.credentials import store_secret
    from crate.api.permissions import get_user_capabilities

    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())
    secret_ref = store_secret(
        "ai_provider", {"api_key": "sensitive-value"}, require_strong_key=True
    )
    conn = connection(secret_ref=secret_ref, secret_source="stored")
    assert "secret_ref" not in conn and conn["has_secret"]
    assert config.get_connection(conn["id"], private=True)["secret_ref"] == secret_ref
    assert "sensitive-value" not in str(config.list_connections())
    capabilities = {
        "ai.config.read",
        "ai.config.manage",
        "ai.credentials.manage",
        "ai.usage.read",
        "ai.tests.run",
    }
    for role in ("admin", "owner"):
        assert capabilities <= get_user_capabilities({"role": role})
    for role in ("ops", "librarian", "curator", "editor", "user"):
        assert not capabilities & get_user_capabilities({"role": role})


def test_invalid_binding_batch_and_profile_version_leave_no_partial_writes(pg_db):
    conn = connection()
    prof = profile(conn)
    with transaction_scope() as session:
        before = session.execute(text("SELECT count(*) FROM audit_log")).scalar_one()
        change = {
            "action_id": "artists.bio.research",
            "profile_id": prof["id"],
            "profile_version": 1,
            "enabled": True,
            "expected_revision": 0,
        }
        with pytest.raises(Exception):
            config.apply_bindings(
                [
                    change,
                    {
                        **change,
                        "action_id": "shows.extract.text",
                        "profile_version": 99,
                    },
                ],
                None,
                session=session,
            )
        assert config.list_bindings(session=session) == []
        assert (
            session.execute(text("SELECT count(*) FROM audit_log")).scalar_one()
            == before
        )
        with pytest.raises(Exception):
            config.create_profile_version(
                prof["id"],
                {
                    "connection_id": conn["id"],
                    "model_id": "x",
                    "config": {"timeout_seconds": 0},
                },
                1,
                None,
                session=session,
            )
        assert config.list_profiles(session=session)[0]["current_version"] == 1
        assert config.get_profile_version(prof["id"], 2, session=session) is None


def test_unknown_reservation_is_never_freed_by_retention(pg_db):
    conn = connection(max_concurrent=1)
    context = {
        "connection_id": conn["id"],
        "action_id": "shows.extract.text",
        "model_id": "model",
    }
    invocation = usage.reserve_invocation(
        context, idempotency_key="old-reservation", input_tokens=10, output_tokens=20
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE ai_invocations SET created_at=NOW()-INTERVAL '91 days'")
        )
    assert usage.prune_ai_activity()["deleted"] == 0
    with pytest.raises(AIConfigurationError) as error:
        usage.reserve_invocation(
            context, idempotency_key="no-auto-release", input_tokens=1, output_tokens=1
        )
    assert error.value.code == "AI_CONCURRENCY_LIMIT"
    row = usage.finish_invocation(invocation["id"], None, "timeout")
    assert row["charged_tokens"] == 30
    assert usage.prune_ai_activity()["deleted"] == 1
    assert usage.usage_summary()["totals"]["tokens"] == 30


def test_probe_has_no_domain_action_and_shares_all_budgets(pg_db):
    conn = connection(max_concurrent=1, daily_calls=2, daily_tokens=100)
    prof = profile(conn)
    context = {
        "connection_id": conn["id"],
        "invocation_kind": "probe",
        "action_id": None,
        "model_id": "model",
        "profile_id": prof["id"],
        "profile_version": 1,
    }
    probe = usage.reserve_invocation(
        context, idempotency_key="probe", input_tokens=10, output_tokens=20
    )
    assert probe["invocation_kind"] == "probe" and probe["action_id"] is None
    assert probe["profile_id"] == prof["id"] and probe["claimed"]
    duplicate = usage.reserve_invocation(
        context, idempotency_key="probe", input_tokens=10, output_tokens=20
    )
    assert duplicate["id"] == probe["id"] and not duplicate["claimed"]
    with pytest.raises(AIConfigurationError):
        usage.reserve_invocation(
            {**context, "invocation_kind": "action", "action_id": "shows.extract.text"},
            idempotency_key="action",
            input_tokens=1,
            output_tokens=1,
        )
    usage.finish_invocation(
        probe["id"], {"input_tokens": 3, "output_tokens": 2}, "succeeded"
    )
    action = usage.reserve_invocation(
        {**context, "invocation_kind": "action", "action_id": "shows.extract.text"},
        idempotency_key="action",
        input_tokens=1,
        output_tokens=1,
    )
    usage.finish_invocation(action["id"], None, "timeout")
    with pytest.raises(AIConfigurationError) as error:
        usage.reserve_invocation(
            context, idempotency_key="over-calls", input_tokens=1, output_tokens=1
        )
    assert error.value.code == "AI_DAILY_CALL_LIMIT"
    daily = usage.usage_summary()["daily"]
    probe_bucket = next(row for row in daily if row["invocation_kind"] == "probe")
    assert probe_bucket["action_id"] is None and probe_bucket["tokens"] == 5
    assert len(usage.list_invocations({"invocation_kind": "probe"})["items"]) == 1


@pytest.mark.parametrize(
    "kind,action", [("action", None), ("probe", "shows.extract.text"), ("other", None)]
)
def test_invalid_invocation_kinds_reject_before_database(kind, action):
    with pytest.raises(AIConfigurationError):
        usage.reserve_invocation(
            {"invocation_kind": kind, "action_id": action},
            idempotency_key="invalid",
            input_tokens=1,
            output_tokens=1,
        )


def test_legacy_tracking_ignores_new_quotas_but_never_replays(pg_db):
    conn = config.ensure_environment_connection("ollama", "http://localhost:11434")
    context = {
        "mode": "legacy",
        "invocation_kind": "action",
        "connection_id": conn["id"],
        "action_id": "genres.eq.propose",
        "provider": "ollama",
        "model_id": "old-model",
    }
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE ai_provider_connections SET max_concurrent=1,daily_calls=1,daily_tokens=1"
            )
        )
    first = usage.reserve_invocation(
        context, idempotency_key="legacy-one", input_tokens=0, output_tokens=0
    )
    second = usage.reserve_invocation(
        context, idempotency_key="legacy-two", input_tokens=0, output_tokens=0
    )
    assert first["claimed"] and second["claimed"]
    assert first["metering_mode"] == "legacy_tracking"
    assert not usage.reserve_invocation(
        context, idempotency_key="legacy-one", input_tokens=0, output_tokens=0
    )["claimed"]
    usage.finish_invocation(first["id"], None, "failed")
    usage.finish_invocation(
        second["id"], {"input_tokens": 3, "output_tokens": 4}, "succeeded"
    )
    summary = usage.usage_summary()
    assert summary["totals"]["unknown_calls"] == 1
    assert summary["totals"]["tokens"] == 7
    with transaction_scope() as session:
        session.execute(text("UPDATE ai_configuration_state SET active=TRUE"))
    with pytest.raises(AIConfigurationError) as error:
        usage.reserve_invocation(
            context, idempotency_key="late-legacy", input_tokens=0, output_tokens=0
        )
    assert error.value.code == "AI_CONTEXT_STALE"


def test_unsupported_legacy_receipt_shares_idempotency_and_stays_unknown(pg_db):
    context = {
        "mode": "legacy",
        "invocation_kind": "action",
        "action_id": "genres.eq.propose",
        "provider": "anthropic",
        "model_id": "old-model",
        "config_fingerprint": "a" * 64,
    }
    first = usage.reserve_invocation(
        context, idempotency_key="same-receipt", input_tokens=0, output_tokens=0
    )
    assert first["claimed"] and first["metering_mode"] == "legacy_unsupported"
    conn = connection()
    supported = {
        "connection_id": conn["id"],
        "action_id": "genres.eq.propose",
        "model_id": "model",
    }
    duplicate = usage.reserve_invocation(
        supported, idempotency_key="same-receipt", input_tokens=1, output_tokens=1
    )
    assert not duplicate["claimed"] and duplicate["id"] == first["id"]
    result = usage.finish_invocation(
        first["id"], None, "failed", error_code="AI_PROVIDER_FAILED"
    )
    assert result["status"] == "failed" and result["usage_known"] is False
    assert usage.usage_summary()["legacy_usage_unknown"] is True
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE ai_legacy_invocation_receipts SET created_at=NOW()-INTERVAL '100 days'"
            )
        )
    assert usage.prune_ai_activity()["legacy_deleted"] == 1
