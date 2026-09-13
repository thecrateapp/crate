"""Worker-side lifecycle coordination for destructive artist operations."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TypeVar

from crate.artist_hero_publication import (
    artist_hero_publication_lock,
    delete_artist_hero_storage,
)
from crate.db.repositories.library import (
    delete_artist as db_delete_artist,
    get_library_artist,
    get_library_artist_by_id,
)

T = TypeVar("T")
log = logging.getLogger(__name__)


class ArtistIdentityChangedError(RuntimeError):
    """Raised when a queued artist mutation no longer targets the same row."""


def _run_artist_change(
    name: str,
    operation: Callable[[], T],
    *,
    cleanup_storage_when: Callable[[T], bool],
) -> T:
    artist = get_library_artist(name)
    if not artist or artist.get("id") is None or not artist.get("entity_uid"):
        return operation()

    artist_id = int(artist["id"])
    entity_uid = str(artist["entity_uid"])
    with artist_hero_publication_lock(entity_uid):
        current_artist = get_library_artist(name)
        if (
            not current_artist
            or current_artist.get("id") != artist_id
            or str(current_artist.get("entity_uid") or "") != entity_uid
        ):
            raise ArtistIdentityChangedError(
                f"Artist identity changed while waiting for lifecycle lock: {name}"
            )

        result = operation()
        should_cleanup = cleanup_storage_when(result)
        try:
            remaining_artist = (
                get_library_artist_by_id(artist_id)
                if should_cleanup
                else current_artist
            )
        except Exception:
            log.warning(
                "Could not verify artist hero cleanup after changing %s",
                name,
                exc_info=True,
            )
            return result
        source_was_removed = (
            not remaining_artist
            or str(remaining_artist.get("entity_uid") or "") != entity_uid
        )
        if should_cleanup and source_was_removed:
            try:
                delete_artist_hero_storage(entity_uid)
            except Exception:
                log.warning(
                    "Artist hero storage cleanup failed after deleting %s",
                    name,
                    exc_info=True,
                )
        return result


def run_artist_deletion(name: str, operation: Callable[[], T]) -> T:
    """Run a destructive DB operation and best-effort cleanup under one lock."""

    return _run_artist_change(
        name, operation, cleanup_storage_when=lambda _result: True
    )


def run_artist_merge(name: str, operation: Callable[[], bool]) -> bool:
    """Run a possible merge and clean storage only when it removes the source."""

    return _run_artist_change(name, operation, cleanup_storage_when=bool)


def delete_artist(name: str) -> None:
    run_artist_deletion(name, lambda: db_delete_artist(name))


__all__ = [
    "ArtistIdentityChangedError",
    "delete_artist",
    "run_artist_deletion",
    "run_artist_merge",
]
