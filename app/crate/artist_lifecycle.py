"""Worker-side lifecycle coordination for destructive artist operations."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from crate.artist_hero_publication import (
    artist_hero_publication_lock,
    delete_artist_hero_storage,
)
from crate.db.repositories.library import (
    delete_artist as db_delete_artist,
    get_library_artist,
)
from crate.streaming.paths import cache_root

T = TypeVar("T")


def run_artist_deletion(name: str, operation: Callable[[], T]) -> T:
    """Run cleanup and a destructive DB operation under the artist hero lock."""

    artist = get_library_artist(name)
    if not artist or artist.get("id") is None or not artist.get("entity_uid"):
        return operation()

    with artist_hero_publication_lock(cache_root(), int(artist["id"])):
        delete_artist_hero_storage(str(artist["entity_uid"]))
        return operation()


def delete_artist(name: str) -> None:
    run_artist_deletion(name, lambda: db_delete_artist(name))


__all__ = ["delete_artist", "run_artist_deletion"]
