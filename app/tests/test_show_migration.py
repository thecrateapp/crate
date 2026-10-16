"""Revision 117 preserves old identities and leaves ambiguous duplicates untouched."""

from importlib import import_module

from sqlalchemy import text

from crate.db.tx import transaction_scope


def test_show_migration_backfills_aliases_and_only_unique_semantic_keys(pg_db):
    from crate.db.schema_sections.shows_v117 import create_shows_v117_schema

    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO shows(external_id,artist_name,date,venue,city,country_code,created_at,updated_at)
            VALUES ('a','Band','2027-03-02','Venue','Madrid','ES',NOW(),NOW()),
                   ('b','Duplicate','2027-03-02','Venue','Madrid','ES',NOW(),NOW()),
                   ('c','Duplicate','2027-03-02','Venue','Madrid','ES',NOW(),NOW())""")
        )

        class Executor:
            def execute(self, statement):
                return session.execute(text(statement))

        create_shows_v117_schema(Executor())
        create_shows_v117_schema(Executor())
        rows = session.execute(text("SELECT * FROM shows ORDER BY id")).mappings().all()
        assert rows[0]["identity_key"] is not None
        assert rows[1]["identity_key"] is rows[2]["identity_key"] is None
        assert (
            session.execute(
                text("SELECT count(*) FROM show_source_aliases")
            ).scalar_one()
            == 3
        )
        assert rows[0]["field_provenance"]["date"]["actor"] == "migration:117"


def test_show_migration_downgrade_keeps_canonical_show_rows(pg_db, monkeypatch):
    migration = import_module("crate.db.migrations.versions.117_canonical_shows")
    with transaction_scope() as session:
        session.execute(
            text("""INSERT INTO shows(artist_name,date,created_at,updated_at)
            VALUES ('Band','2027-03-02',NOW(),NOW())""")
        )

        class Executor:
            def execute(self, statement):
                return session.execute(text(statement))

        monkeypatch.setattr(migration, "op", Executor())
        migration.downgrade()
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 1
        migration.upgrade()
        assert session.execute(text("SELECT count(*) FROM shows")).scalar_one() == 1


def test_shared_plan_rollback_removes_internal_proofs_and_restores_previous_grants(
    pg_db, monkeypatch
):
    from crate.db.repositories.auth_user_accounts import create_user
    from crate.db.repositories.show_imports import get_show_editor_principal

    user = create_user("migration-editor@example.test", role="curator")
    get_show_editor_principal(user["id"])
    migration = import_module("crate.db.migrations.versions.118_shared_show_plans")
    with transaction_scope() as session:

        class Executor:
            def execute(self, statement):
                return session.execute(text(statement))

        monkeypatch.setattr(migration, "op", Executor())
        migration.downgrade()
        assert (
            session.execute(
                text("SELECT count(*) FROM agent_principals WHERE kind='human'")
            ).scalar_one()
            == 0
        )
        check = session.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='agent_principals_grants_check'"
            )
        ).scalar_one()
        assert "curation.shows" not in check
        migration.upgrade()
