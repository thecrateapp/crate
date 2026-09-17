"""DB functions for artwork worker handlers."""

from sqlalchemy import text

from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.tx import transaction_scope


def set_artist_has_photo(artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_artists SET has_photo = 1, updated_at = NOW() WHERE name = :name"
            ),
            {"name": artist_name},
        )


def touch_artist_artwork(artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET updated_at = NOW() WHERE name = :name"),
            {"name": artist_name},
        )


def set_album_has_cover(album_id: int) -> None:
    with transaction_scope() as session:
        entity_uid = session.execute(
            text(
                "UPDATE library_albums "
                "SET has_cover = 1, updated_at = NOW() "
                "WHERE id = :id RETURNING entity_uid"
            ),
            {"id": album_id},
        ).scalar_one_or_none()
        if entity_uid:
            enqueue_local_dirty_source(
                "album",
                str(entity_uid),
                "upsert",
                session=session,
            )
