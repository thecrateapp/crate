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
