from importlib import import_module
from pathlib import Path

from crate.db.tx import transaction_scope
from sqlalchemy import text
from tests.test_agent_access_migration import RecordingExecutor, SessionExecutor

APP_ROOT = Path(__file__).resolve().parents[1] / "crate"
LEGACY_KEYS = ("telegram_enabled", "telegram_bot_token", "telegram_chat_id")


def _migration():
    return import_module(
        "crate.db.migrations.versions.138_remove_legacy_telegram_settings"
    )


def test_migration_deletes_only_legacy_bot_settings(monkeypatch):
    migration = _migration()
    recorded = RecordingExecutor()
    monkeypatch.setattr(migration, "op", recorded)
    migration.upgrade()
    assert migration.revision == "138" and migration.down_revision == "137"
    assert len(recorded.statements) == 1
    statement = recorded.statements[0]
    assert statement.startswith("DELETE FROM settings WHERE key IN")
    for key in LEGACY_KEYS:
        assert f"'{key}'" in statement


def test_migration_purges_plaintext_token_and_downgrade_does_not_restore(
    pg_db, monkeypatch
):
    migration = _migration()
    with transaction_scope() as session:
        for key, value in (
            ("telegram_enabled", "true"),
            ("telegram_bot_token", "123456:plaintext-secret"),
            ("telegram_chat_id", "42"),
            ("slskd_url", "http://slskd:5030"),
        ):
            session.execute(
                text(
                    "INSERT INTO settings(key, value) VALUES (:key, :value) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
                ),
                {"key": key, "value": value},
            )
        monkeypatch.setattr(migration, "op", SessionExecutor(session))
        migration.upgrade()
        migration.upgrade()
        migration.downgrade()
        keys = set(
            session.execute(
                text("SELECT key FROM settings WHERE key = ANY(:keys)"),
                {"keys": [*LEGACY_KEYS, "slskd_url"]},
            ).scalars()
        )
    assert keys == {"slskd_url"}


def test_legacy_bot_modules_and_notify_calls_are_gone():
    assert not (APP_ROOT / "telegram.py").exists()
    assert not (APP_ROOT / "db" / "queries" / "telegram.py").exists()
    offenders = []
    for path in APP_ROOT.rglob("*.py"):
        source = path.read_text()
        if (
            "from crate.telegram import" in source
            or "import crate.telegram" in source
            or "notify_task_failed" in source
            or "notify_task_completed" in source
            or "notify_new_release" in source
            or "check_and_alert" in source
        ):
            offenders.append(str(path.relative_to(APP_ROOT)))
    assert offenders == []


def test_worker_no_longer_starts_a_bot_thread_and_cli_flag_is_a_noop(monkeypatch):
    import crate.__main__ as cli
    import crate.worker

    worker_source = (APP_ROOT / "worker.py").read_text()
    assert "telegram" not in worker_source.lower()
    captured = {}
    monkeypatch.setattr(cli, "load_config", lambda: {})
    monkeypatch.setattr(crate.worker, "run_worker", captured.update)
    monkeypatch.setattr("sys.argv", ["crate", "worker", "--no-telegram"])
    cli.main()
    assert captured["worker_queues"] is not None
    assert "worker_telegram" not in captured


def test_settings_api_no_longer_exposes_the_legacy_bot(monkeypatch):
    from crate.api import settings
    from crate.api.schemas.settings import SettingsResponse

    reads = []

    def get_setting(key, default=None):
        reads.append(key)
        return default

    monkeypatch.setattr(settings, "_require_settings_manager", lambda _request: {})
    monkeypatch.setattr(settings, "get_setting", get_setting)
    monkeypatch.setattr(
        settings,
        "read_runtime_policy_state",
        lambda: {
            "policy": {"max_running": 4},
            "configured_revision": 1,
            "effective_revision": 1,
        },
    )
    monkeypatch.setattr(settings, "get_schedules", lambda: {})
    monkeypatch.setattr(settings, "get_cache_stats", lambda: {})
    monkeypatch.setattr(settings, "get_db_table_stats", lambda: {})
    monkeypatch.setattr(
        settings,
        "_get_shows_settings",
        lambda: {"active_cities": [], "upcoming_shows": 0},
    )
    monkeypatch.setattr(
        settings,
        "_get_about_info",
        lambda: {
            "version": "1",
            "git_commit": "x",
            "python": "3",
            "uptime_seconds": 0,
            "artists": 0,
            "albums": 0,
            "tracks": 0,
            "total_size_gb": 0,
        },
    )

    payload = settings.get_settings(None)

    assert "telegram" not in payload
    assert not any(key.startswith("telegram") for key in reads)
    assert "telegram" not in SettingsResponse.model_fields
    assert not hasattr(settings, "update_telegram")
    assert not hasattr(settings, "test_telegram")
    paths = {route.path for route in settings.router.routes}
    assert "/api/settings/telegram" not in paths
    assert "/api/settings/telegram/test" not in paths
