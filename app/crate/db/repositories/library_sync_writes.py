from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import select

from crate.db.orm.library import LibraryAlbum
from crate.db.repositories.library_writes import (
    upsert_album,
    upsert_artist,
    upsert_track,
)
from crate.db.tx import transaction_scope


def upsert_scanned_album(
    *,
    artist_payload: dict,
    album_payload: dict,
    track_payloads: list[dict],
    indexed_album_path_is_live: Callable[[str], bool] | None = None,
) -> tuple[str, int, str, set[str]]:
    """Persist one scanned album folder and its tracks in a single transaction.

    ``indexed_album_path_is_live`` reports whether an album indexed at another
    path still holds audio; see ``upsert_album`` for how it resolves a folder
    that duplicates or replaces such an album.
    """
    with transaction_scope() as session:
        artist_name = upsert_artist(artist_payload, session=session)
        album_id = upsert_album(
            {**album_payload, "artist": artist_name},
            session=session,
            indexed_path_is_live=indexed_album_path_is_live,
        )
        album_entity_uid = session.execute(
            select(LibraryAlbum.entity_uid).where(LibraryAlbum.id == album_id)
        ).scalar_one()
        if album_entity_uid is None:
            raise RuntimeError(f"Album {album_id} has no entity UID after upsert")

        synced_paths: set[str] = set()
        for track_payload in track_payloads:
            payload = {**track_payload, "album_id": album_id}
            upsert_track(payload, session=session)
            synced_paths.add(payload["path"])

    return artist_name, album_id, str(album_entity_uid), synced_paths
