"""Schema contract tests for Listen Crates."""

from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


CRATE_TABLES = {"crates", "crate_albums", "crate_members", "crate_invites"}


def _table_names(session) -> set[str]:
    return set(
        session.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                """
            )
        ).scalars()
    )


def _alembic_config() -> Config:
    app_dir = Path(__file__).resolve().parents[1]
    config = Config(str(app_dir / "alembic.ini"))
    config.set_main_option("script_location", str(app_dir / "crate/db/migrations"))
    return config


def test_crate_relations_exist_after_database_migrations(pg_db):
    from crate.db.tx import read_scope

    with read_scope() as session:
        tables = _table_names(session)

    assert CRATE_TABLES <= tables


def test_crate_schema_has_private_default_and_required_constraints(pg_db):
    from crate.db.tx import read_scope

    with read_scope() as session:
        visibility_default = session.execute(
            text(
                """
                SELECT column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'crates'
                  AND column_name = 'visibility'
                """
            )
        ).scalar_one()
        foreign_keys = (
            session.execute(
                text(
                    """
                SELECT
                    source.table_name,
                    source.column_name,
                    target.table_name AS referenced_table,
                    target.column_name AS referenced_column,
                    constraint_row.delete_rule
                FROM information_schema.table_constraints AS table_constraint
                JOIN information_schema.key_column_usage AS source
                  ON source.constraint_schema = table_constraint.constraint_schema
                 AND source.constraint_name = table_constraint.constraint_name
                JOIN information_schema.constraint_column_usage AS target
                  ON target.constraint_schema = table_constraint.constraint_schema
                 AND target.constraint_name = table_constraint.constraint_name
                JOIN information_schema.referential_constraints AS constraint_row
                  ON constraint_row.constraint_schema = table_constraint.constraint_schema
                 AND constraint_row.constraint_name = table_constraint.constraint_name
                WHERE table_constraint.constraint_type = 'FOREIGN KEY'
                  AND table_constraint.table_schema = 'public'
                  AND table_constraint.table_name IN (
                      'crates', 'crate_albums', 'crate_members', 'crate_invites'
                  )
                """
                )
            )
            .mappings()
            .all()
        )
        index_definitions = (
            session.execute(
                text(
                    """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = 'public' AND tablename = 'crate_albums'
                """
                )
            )
            .scalars()
            .all()
        )

    assert "private" in visibility_default
    fk_contract = {
        (
            row["table_name"],
            row["column_name"],
            row["referenced_table"],
            row["referenced_column"],
            row["delete_rule"],
        )
        for row in foreign_keys
    }
    assert (
        "crates",
        "owner_id",
        "users",
        "id",
        "CASCADE",
    ) in fk_contract
    assert (
        "crate_albums",
        "crate_id",
        "crates",
        "id",
        "CASCADE",
    ) in fk_contract
    assert (
        "crate_members",
        "crate_id",
        "crates",
        "id",
        "CASCADE",
    ) in fk_contract
    assert (
        "crate_invites",
        "crate_id",
        "crates",
        "id",
        "CASCADE",
    ) in fk_contract
    assert (
        "crate_albums",
        "global_album_uid",
        "global_catalog_albums",
        "global_album_uid",
        "CASCADE",
    ) in fk_contract
    assert any("(crate_id, global_album_uid)" in index for index in index_definitions)
    assert any(
        "(crate_id, position)" in index.replace('"', "") for index in index_definitions
    )


def test_crate_migration_can_be_downgraded_and_reapplied(pg_db):
    from crate.db.tx import read_scope

    config = _alembic_config()
    try:
        command.downgrade(config, "098")
        with read_scope() as session:
            assert not (CRATE_TABLES & _table_names(session))

        command.upgrade(config, "099")
        with read_scope() as session:
            assert CRATE_TABLES <= _table_names(session)

        command.downgrade(config, "098")
        with read_scope() as session:
            assert not (CRATE_TABLES & _table_names(session))
    finally:
        command.upgrade(config, "099")

    with read_scope() as session:
        assert CRATE_TABLES <= _table_names(session)


def test_curation_bootstrap_registers_crate_schema_idempotently(pg_db):
    from crate.db.schema_sections.curation import create_curation_schema
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        raw_connection = session.connection().connection
        cursor = raw_connection.cursor()
        try:
            create_curation_schema(cursor)
            create_curation_schema(cursor)
        finally:
            cursor.close()

        assert CRATE_TABLES <= _table_names(session)
