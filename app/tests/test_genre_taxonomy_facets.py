from importlib import import_module

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class RecordingExecutor:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(" ".join(str(statement).split()))


def test_v136_facet_migration_matches_bootstrap(monkeypatch):
    from crate.db.schema_bootstrap import create_schema
    from crate.db.schema_sections.genre_facets_v136 import (
        create_genre_taxonomy_facets_v136_schema,
    )

    migration = import_module("crate.db.migrations.versions.136_genre_taxonomy_facets")
    migrated = RecordingExecutor()
    section = RecordingExecutor()
    bootstrap = RecordingExecutor()
    monkeypatch.setattr(migration, "op", migrated)

    migration.upgrade()
    create_genre_taxonomy_facets_v136_schema(section)
    create_schema(bootstrap)

    assert migrated.statements == section.statements
    assert all(statement in bootstrap.statements for statement in section.statements)
    assert (migration.revision, migration.down_revision) == ("136", "135")
    sql = "\n".join(migrated.statements)
    assert "genre_taxonomy_raw_tag_classifications" in sql
    assert "genre_taxonomy_raw_tag_facets" in sql
    assert "('genre', 'facet', 'hybrid', 'ignore')" in sql


def test_raw_tag_facet_classification_is_persisted_and_removed_from_genre_lists(
    pg_db,
):
    from uuid import uuid4

    from crate.db.queries.genres_library_catalog import (
        get_all_genres,
        get_unmapped_genre_count,
        get_unmapped_genres,
        list_unmapped_genres_for_inference,
    )
    from crate.db.repositories.genres_taxonomy_raw_tags import (
        clear_raw_genre_classification,
        update_raw_genre_classification,
    )
    from crate.db.tx import read_scope, transaction_scope

    token = uuid4().hex[:10]
    slug = f"facet-raw-tag-{token}"
    artist_name = f"Facet Raw Tag Artist {token}"
    pg_db.upsert_artist({"name": artist_name})
    with transaction_scope() as session:
        genre_id = session.execute(
            text("INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"),
            {"name": f"Facet Raw Tag {token}", "slug": slug},
        ).scalar_one()
        session.execute(
            text(
                "INSERT INTO artist_genres (artist_name, genre_id, source) "
                "VALUES (:artist, :genre_id, 'test')"
            ),
            {"artist": artist_name, "genre_id": genre_id},
        )

    before_count = get_unmapped_genre_count()
    assert any(row["slug"] == slug for row in get_all_genres())
    assert any(row["slug"] == slug for row in get_unmapped_genres(limit=2000))
    assert [row["slug"] for row in list_unmapped_genres_for_inference(10, slug)] == [
        slug
    ]

    result = update_raw_genre_classification(
        slug,
        "facet",
        [{"dimension": "vocals", "name": "Instrumental"}],
    )

    assert result == {
        "slug": slug,
        "classification": "facet",
        "facets": [
            {"dimension": "vocals", "slug": "instrumental", "name": "Instrumental"}
        ],
    }
    assert get_unmapped_genre_count() == before_count - 1
    assert all(row["slug"] != slug for row in get_all_genres())
    assert all(row["slug"] != slug for row in get_unmapped_genres(limit=2000))
    assert list_unmapped_genres_for_inference(10, slug) == []
    with read_scope() as session:
        classification = (
            session.execute(
                text(
                    """
                SELECT classification.classification, facet.dimension, facet.slug,
                       EXISTS (
                           SELECT 1 FROM genre_taxonomy_aliases alias
                           WHERE alias.alias_slug = :slug
                       ) AS has_alias,
                       EXISTS (
                           SELECT 1 FROM genre_taxonomy_nodes node
                           WHERE node.slug = :slug
                       ) AS has_node,
                       EXISTS (
                           SELECT 1 FROM artist_genres assignment
                           WHERE assignment.genre_id = classification.genre_id
                       ) AS has_library_assignment
                FROM genre_taxonomy_raw_tag_classifications classification
                JOIN genre_taxonomy_raw_tag_facets raw_facet
                  ON raw_facet.genre_id = classification.genre_id
                JOIN genre_taxonomy_facet_values facet ON facet.id = raw_facet.facet_id
                WHERE classification.genre_id = :genre_id
                """
                ),
                {"slug": slug, "genre_id": genre_id},
            )
            .mappings()
            .one()
        )
    assert classification["classification"] == "facet"
    assert classification["dimension"] == "vocals"
    assert classification["slug"] == "instrumental"
    assert classification["has_alias"] is False
    assert classification["has_node"] is False
    assert classification["has_library_assignment"] is True

    # Explicitly returning a tag to the genre vocabulary clears its facets.
    update_raw_genre_classification(slug, "genre")
    assert any(row["slug"] == slug for row in get_all_genres())
    assert any(row["slug"] == slug for row in get_unmapped_genres(limit=2000))
    with read_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM genre_taxonomy_raw_tag_facets "
                    "WHERE genre_id = :genre_id"
                ),
                {"genre_id": genre_id},
            ).scalar_one()
            == 0
        )

    update_raw_genre_classification(
        slug, "facet", [{"dimension": "vocals", "name": "Instrumental"}]
    )
    with transaction_scope() as session:
        node_id = session.execute(
            text(
                "INSERT INTO genre_taxonomy_nodes (slug, name) "
                "VALUES (:slug, :name) RETURNING id"
            ),
            {"slug": f"node-{token}", "name": f"Node {token}"},
        ).scalar_one()
        session.execute(
            text(
                "INSERT INTO genre_taxonomy_aliases "
                "(alias_slug, alias_name, genre_id, origin) "
                "VALUES (:slug, :name, :node_id, 'manual')"
            ),
            {"slug": slug, "name": f"Facet Raw Tag {token}", "node_id": node_id},
        )
    with pytest.raises(ValueError, match="Mapped raw genres"):
        update_raw_genre_classification(slug, "facet")
    clear_raw_genre_classification(slug)
