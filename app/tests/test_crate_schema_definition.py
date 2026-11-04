"""Contract tests for the Crates schema DDL source."""

from contextlib import contextmanager
from importlib import import_module
from pathlib import Path

from alembic.script import ScriptDirectory
from crate.db.schema_sections.curation_crates import create_crates_schema


class RecordingExecutor:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> None:
        self.statements.append(" ".join(statement.split()))

    def get_context(self):
        return self

    @contextmanager
    def autocommit_block(self):
        yield


def test_crate_migration_uses_the_bootstrap_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.099_listen_crates")
    revision_schema = import_module("crate.db.schema_sections.crates_v099")
    migration_executor = RecordingExecutor()
    revision_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    revision_schema.create_crates_v099_schema(revision_executor)

    assert migration_executor.statements == revision_executor.statements


def test_crate_presentation_migration_uses_its_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.100_crate_presentation")
    revision_schema = import_module("crate.db.schema_sections.crates_v100")
    migration_executor = RecordingExecutor()
    revision_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    revision_schema.create_crates_v100_schema(revision_executor)

    assert migration_executor.statements == revision_executor.statements


def test_crate_followers_migration_creates_follow_table(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.101_crate_followers")
    executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", executor)

    migration.upgrade()

    statements = "\n".join(executor.statements)
    assert "CREATE TABLE IF NOT EXISTS crate_followers" in statements
    assert "followed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" in statements
    assert "PRIMARY KEY (crate_id, user_id)" in statements
    assert "ON crate_followers(user_id, followed_at DESC)" in statements
    assert "crate_likes" not in statements


def test_crate_short_code_migration_uses_its_schema_definition(monkeypatch) -> None:
    migration = import_module("crate.db.migrations.versions.102_crate_short_codes")
    revision_schema = import_module("crate.db.schema_sections.crates_v102")
    migration_executor = RecordingExecutor()
    revision_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    revision_schema.create_crates_v102_schema(revision_executor)

    assert migration_executor.statements == revision_executor.statements
    statements = "\n".join(migration_executor.statements)
    assert "ADD COLUMN IF NOT EXISTS short_code TEXT" in statements
    assert "WHERE short_code IS NULL" in statements
    assert "ALTER COLUMN short_code SET NOT NULL" in statements
    assert "CREATE UNIQUE INDEX IF NOT EXISTS idx_crates_short_code" in statements
    assert statements.index("WHERE short_code IS NULL") < statements.index(
        "SET NOT NULL"
    )


def test_crate_migration_follows_the_current_main_head() -> None:
    migrations_path = (
        Path(__file__).resolve().parents[1] / "crate" / "db" / "migrations"
    )
    scripts = ScriptDirectory(str(migrations_path))

    assert scripts.get_revision("098").down_revision == "097"
    assert scripts.get_revision("099").down_revision == "098"
    assert scripts.get_revision("100").down_revision == "099"
    assert scripts.get_revision("101").down_revision == "100"
    assert scripts.get_revision("102").down_revision == "101"
    assert scripts.get_revision("103").down_revision == "102"
    assert scripts.get_revision("104").down_revision == "103"
    assert scripts.get_revision("105").down_revision == "104"
    assert scripts.get_revision("106").down_revision == "105"
    assert scripts.get_revision("107").down_revision == "106"
    assert scripts.get_revision("108").down_revision == "107"
    assert scripts.get_revision("109").down_revision == "108"
    assert scripts.get_revision("110").down_revision == "109"
    assert scripts.get_revision("111").down_revision == "110"
    assert scripts.get_revision("112").down_revision == "111"
    assert scripts.get_revision("113").down_revision == "112"
    assert scripts.get_revision("114").down_revision == "113"
    assert scripts.get_revision("115").down_revision == "114"
    assert scripts.get_revision("116").down_revision == "115"
    assert scripts.get_revision("117").down_revision == "116"
    assert scripts.get_revision("118").down_revision == "117"
    assert scripts.get_revision("119").down_revision == "118"
    assert scripts.get_revision("120").down_revision == "119"
    assert scripts.get_revision("121").down_revision == "120"
    assert scripts.get_revision("122").down_revision == "121"
    assert scripts.get_revision("123").down_revision == "122"
    assert scripts.get_revision("124").down_revision == "123"
    assert scripts.get_revision("125").down_revision == "124"
    assert scripts.get_revision("126").down_revision == "125"
    assert scripts.get_revision("127").down_revision == "126"
    assert scripts.get_revision("128").down_revision == "127"
    assert scripts.get_revision("129").down_revision == "128"
    assert scripts.get_revision("130").down_revision == "129"
    assert scripts.get_revision("131").down_revision == "130"
    assert scripts.get_revision("134").down_revision == "133"
    assert scripts.get_revision("135").down_revision == "134"
    assert scripts.get_revision("136").down_revision == "135"
    assert scripts.get_revision("137").down_revision == "136"
    assert scripts.get_revision("138").down_revision == "137"
    assert scripts.get_revision("139").down_revision == "138"
    assert scripts.get_revision("140").down_revision == "139"
    assert scripts.get_revision("141").down_revision == "140"
    assert scripts.get_revision("142").down_revision == "141"
    assert scripts.get_revision("143").down_revision == "142"
    assert scripts.get_revision("144").down_revision == "143"
    assert scripts.get_revision("145").down_revision == "144"
    assert scripts.get_revision("146").down_revision == "145"
    assert scripts.get_revision("147").down_revision == "146"
    assert scripts.get_heads() == ["148"]
    assert scripts.get_revision("148").down_revision == "147"


def test_metric_minute_migration_uses_immutable_schema_definition(monkeypatch):
    root = Path(__file__).resolve().parents[1] / "crate" / "db"
    assert (root / "migrations/versions/141_metric_minute_snapshots.py").is_file()
    assert (root / "schema_sections/metric_minutes_v141.py").is_file()
    migration = import_module(
        "crate.db.migrations.versions.141_metric_minute_snapshots"
    )
    schema = import_module("crate.db.schema_sections.metric_minutes_v141")
    migration_executor = RecordingExecutor()
    schema_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    schema.create_metric_minute_snapshots_v141_schema(schema_executor)

    assert migration_executor.statements == schema_executor.statements
    statements = "\n".join(migration_executor.statements)
    assert "CREATE TABLE IF NOT EXISTS metric_minute_snapshots" in statements
    assert "metric_rollups" not in statements


def test_product_kpi_migration_uses_immutable_schema_and_a_concurrent_brin_index(
    monkeypatch,
):
    migration = import_module("crate.db.migrations.versions.142_product_kpi_daily")
    schema = import_module("crate.db.schema_sections.product_kpis_v142")
    migration_executor = RecordingExecutor()
    schema_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    schema.create_product_kpi_daily_v142_schema(schema_executor)

    statements = migration_executor.statements
    assert statements[: len(schema_executor.statements)] == schema_executor.statements
    assert "CREATE TABLE IF NOT EXISTS product_kpi_daily" in statements[0]
    assert any(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_play_events_created_brin"
        in sql
        and "USING brin (created_at)" in sql
        for sql in statements
    )

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    assert any(
        "DROP TABLE IF EXISTS product_kpi_daily" in sql for sql in downgrade.statements
    )


def test_metric_minute_migration_downgrade_keeps_legacy_rollups(monkeypatch):
    path = (
        Path(__file__).resolve().parents[1]
        / "crate/db/migrations/versions/141_metric_minute_snapshots.py"
    )
    assert path.is_file()
    migration = import_module(
        "crate.db.migrations.versions.141_metric_minute_snapshots"
    )
    executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", executor)

    migration.downgrade()

    statements = "\n".join(executor.statements)
    assert "DROP TABLE IF EXISTS metric_minute_snapshots" in statements
    assert "metric_rollups" not in statements


def test_deployed_revisions_keep_their_numbers_ahead_of_branch_revisions() -> None:
    migrations_path = (
        Path(__file__).resolve().parents[1] / "crate" / "db" / "migrations"
    )
    scripts = ScriptDirectory(str(migrations_path))
    expected = {
        "109": "109_smart_mix_profiles",
        "110": "110_user_access_tokens",
        "111": "111_smart_mix_measurement_provenance",
        "112": "112_smart_mix_target_generation",
        "113": "113_vdj_mood_indexes",
        "114": "114_smart_mix_source_stale",
        "115": "115_playback_continuation_tokens",
        "116": "116_playback_continuation_descriptor",
        "117": "117_smart_mix_local_tempo",
        "118": "118_smart_mix_cue_beats",
        "119": "119_agent_access",
        "120": "120_agent_diagnostic_reads",
        "121": "121_agent_commands",
        "122": "122_mcp_oauth",
        "123": "123_agent_admin",
        "124": "124_agent_library_operations",
        "125": "125_agent_instance_operations",
        "126": "126_editorial_playlists",
        "127": "127_canonical_shows",
        "128": "128_shared_show_plans",
        "129": "129_private_show_extraction",
        "130": "130_ai_configuration",
        "131": "131_ai_default_model",
    }

    for revision, stem in expected.items():
        assert Path(scripts.get_revision(revision).path).stem == stem


def test_error_inbox_migration_uses_immutable_schema_definition(monkeypatch):
    migration = import_module("crate.db.migrations.versions.143_error_inbox")
    schema = import_module("crate.db.schema_sections.error_inbox_v143")
    migration_executor = RecordingExecutor()
    schema_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    schema.create_error_inbox_v143_schema(schema_executor)

    assert migration_executor.statements == schema_executor.statements
    statements = "\n".join(migration_executor.statements)
    assert "CREATE TABLE IF NOT EXISTS error_issues" in statements
    assert "UNIQUE (provider, external_id)" in statements
    assert "CREATE TABLE IF NOT EXISTS error_issue_triage" in statements
    assert "REFERENCES error_issues(id) ON DELETE CASCADE" in statements
    assert "UNIQUE (issue_id, kind, digest_hash)" in statements
    # Soft link: migration 130 owns ai_invocations and must stay reversible on its own.
    assert "REFERENCES ai_invocations" not in statements
    for index in (
        "idx_error_issues_status_score",
        "idx_error_issues_group_key",
        "idx_error_issues_last_seen",
    ):
        assert f"CREATE INDEX IF NOT EXISTS {index}" in statements

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    assert downgrade.statements == [
        "DROP TABLE IF EXISTS error_issue_triage",
        "DROP TABLE IF EXISTS error_issues",
    ]


def test_error_inbox_grant_migration_uses_immutable_schema_definition(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.144_error_inbox_agent_grant"
    )
    schema = import_module("crate.db.schema_sections.error_inbox_grant_v144")
    migration_executor = RecordingExecutor()
    schema_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    schema.create_error_inbox_grant_v144_schema(schema_executor)

    assert migration_executor.statements == schema_executor.statements
    added = migration_executor.statements[-1]
    assert "ADD CONSTRAINT agent_principals_grants_check" in added
    assert "'ops.errors.read'" in added
    assert "'library.acquisition.write'" in added

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    assert "'ops.errors.read'" not in downgrade.statements[-1]
    assert "'library.acquisition.write'" in downgrade.statements[-1]


def test_error_inbox_grant_check_matches_the_allowed_grants() -> None:
    import re

    from crate.agent_access import ALLOWED_GRANTS
    from crate.db.schema_sections.error_inbox_grant_v144 import V144_GRANTS

    assert set(re.findall(r"'([^']+)'", V144_GRANTS)) == set(ALLOWED_GRANTS)


def test_error_inbox_tables_are_part_of_the_bootstrap_schema() -> None:
    source = (
        Path(__file__).resolve().parents[1] / "crate/db/schema_bootstrap.py"
    ).read_text()

    assert "create_error_inbox_v143_schema(cur)" in source
    assert "create_error_inbox_grant_v144_schema(cur)" in source
    assert "create_error_inbox_auto_triage_v146_schema(cur)" in source


def test_error_inbox_auto_triage_migration_uses_immutable_schema_definition(
    monkeypatch,
):
    migration = import_module(
        "crate.db.migrations.versions.146_error_inbox_auto_triage"
    )
    schema = import_module("crate.db.schema_sections.error_inbox_auto_triage_v146")
    migration_executor = RecordingExecutor()
    schema_executor = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migration_executor)

    migration.upgrade()
    schema.create_error_inbox_auto_triage_v146_schema(schema_executor)

    assert migration_executor.statements == schema_executor.statements
    statements = "\n".join(migration_executor.statements)
    assert "ADD COLUMN IF NOT EXISTS auto_triage_hash TEXT" in statements
    assert "ADD COLUMN IF NOT EXISTS auto_triage_at TIMESTAMPTZ" in statements

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    assert downgrade.statements == [
        "ALTER TABLE error_issues DROP COLUMN IF EXISTS auto_triage_at",
        "ALTER TABLE error_issues DROP COLUMN IF EXISTS auto_triage_hash",
    ]


def test_crate_bootstrap_includes_presentation_settings() -> None:
    executor = RecordingExecutor()

    create_crates_schema(executor)

    statements = "\n".join(executor.statements)
    assert "is_ordered" in statements
    assert "sort_direction" in statements
    assert "loop_enabled" in statements
