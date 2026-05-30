"""Tests for destructive genre repository operations."""

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_delete_library_genre_removes_artist_and_album_assignments(pg_db):
    from crate.db.jobs.genre_taxonomy import assign_genre_alias_in_session
    from crate.db.repositories.genres_delete import delete_library_genre
    from crate.db.tx import read_scope, transaction_scope

    pg_db.upsert_artist({"name": "Delete Genre Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Delete Genre Artist",
            "name": "Delete Genre Album",
            "path": "/music/Delete Genre Artist/Delete Genre Album",
        }
    )

    with transaction_scope() as session:
        pg_db.upsert_genre_taxonomy_node(
            "delete-target", name="Delete Target", session=session
        )
        assert assign_genre_alias_in_session(session, "delete raw", "delete-target")
        genre_id = session.execute(
            text(
                """
                INSERT INTO genres (name, slug)
                VALUES ('delete raw', 'delete-raw')
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO artist_genres (artist_name, genre_id, weight, source)
                VALUES ('Delete Genre Artist', :genre_id, 1.0, 'test')
                """
            ),
            {"genre_id": genre_id},
        )
        session.execute(
            text(
                """
                INSERT INTO album_genres (album_id, genre_id, weight, source)
                VALUES (:album_id, :genre_id, 1.0, 'test')
                """
            ),
            {"album_id": album_id, "genre_id": genre_id},
        )

    result = delete_library_genre("delete-raw")

    assert result is not None
    assert result["removed_artist_assignments"] == 1
    assert result["removed_album_assignments"] == 1
    assert result["removed_raw_genres"] == ["delete-raw"]

    with read_scope() as session:
        counts = (
            session.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*)::int FROM genres WHERE slug = 'delete-raw') AS genres,
                        (SELECT COUNT(*)::int FROM artist_genres WHERE genre_id = :genre_id) AS artist_links,
                        (SELECT COUNT(*)::int FROM album_genres WHERE genre_id = :genre_id) AS album_links,
                        (SELECT COUNT(*)::int FROM genre_taxonomy_aliases WHERE alias_slug = 'delete-raw') AS aliases
                    """
                ),
                {"genre_id": genre_id},
            )
            .mappings()
            .one()
        )

    assert counts == {
        "genres": 0,
        "artist_links": 0,
        "album_links": 0,
        "aliases": 0,
    }


def test_delete_taxonomy_genre_removes_node_edges_aliases_and_mapped_raw_genres(pg_db):
    from crate.db.jobs.genre_taxonomy import assign_genre_alias_in_session
    from crate.db.repositories.genres_delete import delete_taxonomy_genre
    from crate.db.tx import read_scope, transaction_scope

    pg_db.upsert_artist({"name": "Delete Taxonomy Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Delete Taxonomy Artist",
            "name": "Delete Taxonomy Album",
            "path": "/music/Delete Taxonomy Artist/Delete Taxonomy Album",
        }
    )

    with transaction_scope() as session:
        source = pg_db.upsert_genre_taxonomy_node(
            "delete-core", name="Delete Core", session=session
        )
        target = pg_db.upsert_genre_taxonomy_node(
            "delete-related", name="Delete Related", session=session
        )
        assert assign_genre_alias_in_session(session, "delete core", "delete-core")
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_edges (source_genre_id, target_genre_id, relation_type)
                VALUES (:source_id, :target_id, 'related')
                """
            ),
            {"source_id": source["id"], "target_id": target["id"]},
        )
        genre_id = session.execute(
            text(
                """
                INSERT INTO genres (name, slug)
                VALUES ('delete core', 'delete-core')
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO artist_genres (artist_name, genre_id, weight, source)
                VALUES ('Delete Taxonomy Artist', :genre_id, 1.0, 'test')
                """
            ),
            {"genre_id": genre_id},
        )
        session.execute(
            text(
                """
                INSERT INTO album_genres (album_id, genre_id, weight, source)
                VALUES (:album_id, :genre_id, 1.0, 'test')
                """
            ),
            {"album_id": album_id, "genre_id": genre_id},
        )

    result = delete_taxonomy_genre("delete-core")

    assert result is not None
    assert result["deleted_taxonomy_nodes"] == 1
    assert result["deleted_library_genres"] == 1
    assert result["removed_artist_assignments"] == 1
    assert result["removed_album_assignments"] == 1

    with read_scope() as session:
        counts = (
            session.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*)::int FROM genre_taxonomy_nodes WHERE slug = 'delete-core') AS nodes,
                        (SELECT COUNT(*)::int FROM genre_taxonomy_aliases WHERE alias_slug = 'delete-core') AS aliases,
                        (SELECT COUNT(*)::int FROM genre_taxonomy_edges WHERE source_genre_id = :source_id OR target_genre_id = :source_id) AS edges,
                        (SELECT COUNT(*)::int FROM genres WHERE slug = 'delete-core') AS genres,
                        (SELECT COUNT(*)::int FROM artist_genres WHERE genre_id = :genre_id) AS artist_links,
                        (SELECT COUNT(*)::int FROM album_genres WHERE genre_id = :genre_id) AS album_links
                    """
                ),
                {"source_id": source["id"], "genre_id": genre_id},
            )
            .mappings()
            .one()
        )

    assert counts == {
        "nodes": 0,
        "aliases": 0,
        "edges": 0,
        "genres": 0,
        "artist_links": 0,
        "album_links": 0,
    }
