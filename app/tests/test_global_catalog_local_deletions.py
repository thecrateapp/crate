import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_artist_delete_replaces_local_upserts_with_delete_dirty_records(pg_db):
    from crate.db.repositories.library_enrichment_writes import delete_artist
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Delete Projection Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Delete Projection Artist",
            "name": "Delete Projection Album",
            "path": "/music/Delete Projection Artist/Delete Projection Album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Delete Projection Artist",
            "album": "Delete Projection Album",
            "filename": "01-delete.flac",
            "title": "Delete Projection Track",
            "path": "/music/Delete Projection Artist/Delete Projection Album/01-delete.flac",
        }
    )

    delete_artist("Delete Projection Artist")

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT entity_type, operation, local_entity_uid::text AS local_entity_uid
                    FROM global_catalog_dirty_sources
                    WHERE source_kind = 'local'
                    ORDER BY entity_type
                    """
                )
            )
            .mappings()
            .all()
        )

    assert [(row["entity_type"], row["operation"]) for row in rows] == [
        ("album", "delete"),
        ("artist", "delete"),
        ("track", "delete"),
    ]
    assert all(row["local_entity_uid"] for row in rows)
