import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_library_upserts_enqueue_one_dirty_source_per_local_entity(pg_db):
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Projection Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Projection Artist",
            "name": "Projection Album",
            "path": "/music/Projection Artist/Projection Album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Projection Artist",
            "album": "Projection Album",
            "filename": "01-projection.flac",
            "title": "Projection Track",
            "path": "/music/Projection Artist/Projection Album/01-projection.flac",
        }
    )

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
        ("album", "upsert"),
        ("artist", "upsert"),
        ("track", "upsert"),
    ]
    assert all(row["local_entity_uid"] for row in rows)


def test_repeated_upsert_coalesces_its_pending_dirty_source(pg_db):
    from crate.db.tx import read_scope

    payload = {"name": "Coalesced Artist", "has_photo": 1}
    pg_db.upsert_artist(payload)
    pg_db.upsert_artist(payload)

    with read_scope() as session:
        count = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM global_catalog_dirty_sources
                WHERE entity_type = 'artist'
                  AND source_kind = 'local'
                  AND completed_at IS NULL
                """
            )
        ).scalar_one()

    assert count == 1
