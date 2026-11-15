"""Stem files Crate Decks downloads (Smart Mix Stems, STEM-D6).

A track's stem file is served only while it was separated from the track's current file
(its profile's source revision). A download is a real use: it marks the file, and the
downloader's own Smart Mix playlists that are on and hold the track, as used now, which
is what the quota's LRU reads. Marks are at most hourly, so repeated range requests do
not write on every request.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.repositories.library_shared import coerce_uuid
from crate.db.tx import optional_scope, read_scope


@dataclass(frozen=True, slots=True)
class StemFileDownload:
    track_id: int
    path: str
    bytes: int


_DOWNLOAD = text(
    """
    SELECT file.track_id, file.path, file.bytes
    FROM library_tracks lt
    JOIN track_stem_files file ON file.track_id = lt.id
    JOIN track_mix_profiles profile
      ON profile.track_id = lt.id
     AND profile.source_stale_at IS NULL
     AND profile.source_revision = file.source_revision
    WHERE lt.entity_uid = CAST(:entity_uid AS uuid)
    """
)

_MARK_USED = text(
    """
    WITH file AS (
        UPDATE track_stem_files
        SET last_used_at = NOW()
        WHERE track_id = :track_id
          AND last_used_at < NOW() - INTERVAL '1 hour'
    )
    UPDATE smart_mix_playlists smp
    SET last_used_at = NOW()
    WHERE smp.user_id = :user_id
      AND smp.enabled
      AND (smp.last_used_at IS NULL OR smp.last_used_at < NOW() - INTERVAL '1 hour')
      AND EXISTS (
          SELECT 1 FROM playlist_tracks pt
          WHERE pt.playlist_id = smp.playlist_id AND pt.track_id = :track_id
      )
    """
)


def get_stem_file_download(
    entity_uid: str, *, session: Session | None = None
) -> StemFileDownload | None:
    """The stem file of the local track ``entity_uid``'s current file, or None."""

    def _impl(current: Session) -> StemFileDownload | None:
        row = (
            current.execute(_DOWNLOAD, {"entity_uid": str(coerce_uuid(entity_uid))})
            .mappings()
            .first()
        )
        if row is None:
            return None
        return StemFileDownload(
            track_id=int(row["track_id"]),
            path=str(row["path"]),
            bytes=int(row["bytes"]),
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def mark_stem_file_used(
    track_id: int, *, user_id: int | None, session: Session | None = None
) -> None:
    """Mark a downloaded stem file, and the user's Smart Mix playlists holding it, used."""
    with optional_scope(session) as current:
        current.execute(_MARK_USED, {"track_id": track_id, "user_id": user_id})


__all__ = ["StemFileDownload", "get_stem_file_download", "mark_stem_file_used"]
