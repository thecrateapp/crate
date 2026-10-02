from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text


def test_upsert_with_null_artist_id_updates_only_exact_name(pg_db):
    from crate.db.tx import read_scope, transaction_scope

    target_storage_id = uuid4()
    sibling_storage_id = uuid4()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (
                    name, id, storage_id, slug, folder_name, album_count, track_count
                )
                VALUES
                    ('Various Artists', NULL, :target_storage_id,
                     'various-artists-target', 'Target Folder', 1, 2),
                    ('VARIOUS ARTISTS', NULL, :sibling_storage_id,
                     'various-artists-sibling', 'Sibling Folder', 3, 4)
                """
            ),
            {
                "target_storage_id": target_storage_id,
                "sibling_storage_id": sibling_storage_id,
            },
        )

    updated_name = pg_db.upsert_artist(
        {
            "name": "VARIOUS ARTISTS",
            "storage_id": target_storage_id,
            "album_count": 9,
            "track_count": 12,
        }
    )

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT name, album_count, track_count
                FROM library_artists
                WHERE LOWER(name) = LOWER(:name)
                """
            ),
            {"name": "Various Artists"},
        ).mappings()
        artists = {
            row["name"]: (row["album_count"], row["track_count"]) for row in rows
        }

    assert updated_name == "Various Artists"
    assert artists == {
        "Various Artists": (9, 12),
        "VARIOUS ARTISTS": (3, 4),
    }


def test_upsert_fails_if_selected_artist_disappears_before_update(pg_db):
    from crate.db.repositories.library_artist_upserts import _update_existing_artist
    from crate.db.tx import transaction_scope

    with pytest.raises(
        RuntimeError, match="Expected to update one existing artist row"
    ):
        with transaction_scope() as session:
            _update_existing_artist(
                session,
                existing_id=None,
                existing_name="Artist removed before update",
                existing_slug=None,
                existing_storage_id=None,
                existing_entity_uid=None,
                existing_folder_name=None,
                existing_mbid=None,
                existing_spotify_id=None,
                requested_storage_id=None,
                folder_name="",
                data={},
                now=datetime.now(timezone.utc),
            )
