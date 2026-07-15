import importlib

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


def test_core_taxonomy_descriptor_has_stable_identity_and_digest():
    from crate.genre_taxonomy import get_core_taxonomy_descriptor

    first = get_core_taxonomy_descriptor()
    second = get_core_taxonomy_descriptor()

    assert first == second
    assert first["taxonomy_id"] == "crate-core"
    assert first["version"] == "1.0.0"
    assert first["digest"].startswith("sha256:")
    assert first["genres"]


def test_core_genre_uid_is_independent_from_display_slug():
    from crate.genre_taxonomy import core_genre_uid

    assert core_genre_uid("hardcore-punk") == core_genre_uid("hardcore-punk")
    assert core_genre_uid("hardcore-punk") != core_genre_uid("post-hardcore")


def test_core_taxonomy_migration_persists_release_and_global_genre_ids(monkeypatch):
    migration = importlib.import_module(
        "crate.db.migrations.versions.059_core_genre_taxonomy"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert migration.revision == "059"
    assert migration.down_revision == "058"
    assert "CREATE TABLE IF NOT EXISTS genre_taxonomy_releases" in sql
    assert "global_genre_uid" in sql
    assert "taxonomy_id" in sql
    assert "origin" in sql


def test_global_catalog_genre_migration_preserves_unmapped_source_evidence(monkeypatch):
    migration = importlib.import_module(
        "crate.db.migrations.versions.060_global_catalog_genres"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert migration.revision == "060"
    assert migration.down_revision == "059"
    assert "global_catalog_genre_assertions" in sql
    assert "global_genre_uid UUID" in sql
    assert "invalidated_at" in sql
    assert "global_catalog_entity_genres" in sql


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_seeded_core_nodes_use_core_uid_and_locked_edges(pg_db):
    from crate.db.tx import read_scope
    from crate.genre_taxonomy import core_genre_uid

    with read_scope() as session:
        node = (
            session.execute(
                text(
                    """
                    SELECT global_genre_uid::text AS global_genre_uid, origin
                    FROM genre_taxonomy_nodes
                    WHERE slug = 'hardcore-punk'
                    """
                )
            )
            .mappings()
            .one()
        )
        locked = session.execute(
            text(
                """
                SELECT edge.locked
                FROM genre_taxonomy_edges edge
                JOIN genre_taxonomy_nodes source ON source.id = edge.source_genre_id
                JOIN genre_taxonomy_nodes target ON target.id = edge.target_genre_id
                WHERE source.slug = 'hardcore-punk'
                  AND target.slug = 'punk'
                  AND edge.relation_type = 'parent'
                """
            )
        ).scalar_one()

    assert node == {
        "global_genre_uid": core_genre_uid("hardcore-punk"),
        "origin": "core",
    }
    assert locked is True


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_runtime_taxonomy_nodes_are_valid_global_overlay_nodes(pg_db):
    from crate.db.tx import read_scope

    created = pg_db.upsert_genre_taxonomy_node(
        "fixture-global-overlay", name="Fixture Global Overlay"
    )

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        entity_uid::text AS entity_uid,
                        global_genre_uid::text AS global_genre_uid,
                        taxonomy_id,
                        origin
                    FROM genre_taxonomy_nodes
                    WHERE slug = 'fixture-global-overlay'
                    """
                )
            )
            .mappings()
            .one()
        )

    assert created is not None
    assert row["global_genre_uid"] == row["entity_uid"]
    assert row["taxonomy_id"] == "crate-core"
    assert row["origin"] == "overlay"
