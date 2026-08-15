from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_artist_upsert_preserves_featured_metadata(pg_db):
    from crate.db.tx import read_scope, transaction_scope

    artist_name = "Featured Persistence Artist"
    pg_db.upsert_artist({"name": artist_name, "album_count": 1})

    with read_scope() as session:
        initial = (
            session.execute(
                text(
                    """
                SELECT is_featured, first_seen_at
                FROM library_artists
                WHERE name = :name
                """
                ),
                {"name": artist_name},
            )
            .mappings()
            .one()
        )

    assert initial["is_featured"] is False
    assert initial["first_seen_at"] is not None

    first_seen_at = datetime(2020, 1, 2, tzinfo=timezone.utc)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_artists
                SET is_featured = TRUE, first_seen_at = :first_seen_at
                WHERE name = :name
                """
            ),
            {"name": artist_name, "first_seen_at": first_seen_at},
        )

    pg_db.upsert_artist({"name": artist_name, "album_count": 4})

    with read_scope() as session:
        persisted = (
            session.execute(
                text(
                    """
                SELECT is_featured, first_seen_at, album_count
                FROM library_artists
                WHERE name = :name
                """
                ),
                {"name": artist_name},
            )
            .mappings()
            .one()
        )

    assert persisted["is_featured"] is True
    assert persisted["first_seen_at"] == first_seen_at
    assert persisted["album_count"] == 4
