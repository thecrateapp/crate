from sqlalchemy import text

from crate.db.repositories.library import upsert_album
from crate.db.tx import transaction_scope


def reassign_album_artist(album_path: str, artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET artist = :artist WHERE path = :path"),
            {"artist": artist_name, "path": album_path},
        )


def update_track_artist(track_path: str, artist_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET artist = :artist WHERE path = :path"),
            {"artist": artist_name, "path": track_path},
        )


def update_album_path_and_name(old_path: str, new_path: str, album_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"
            ),
            {"name": album_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET path = REPLACE(path, :old_prefix, :new_prefix) WHERE path LIKE :pattern"
            ),
            {
                "old_prefix": old_path + "/",
                "new_prefix": new_path + "/",
                "pattern": old_path + "/%",
            },
        )


def update_album_artist_and_path(
    album_id: int, old_path: str, new_path: str, artist_name: str
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_albums
                SET artist = :artist,
                    path = :new_path,
                    updated_at = NOW()
                WHERE id = :album_id
                """
            ),
            {
                "album_id": album_id,
                "artist": artist_name,
                "new_path": new_path,
            },
        )
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET artist = :artist,
                    albumartist = :artist,
                    path = REPLACE(path, :old_prefix, :new_prefix),
                    updated_at = NOW()
                WHERE album_id = :album_id
                """
            ),
            {
                "album_id": album_id,
                "artist": artist_name,
                "old_prefix": old_path + "/",
                "new_prefix": new_path + "/",
            },
        )


def merge_album_into_album(
    source_album_id: int,
    target_album_id: int,
    old_path: str,
    new_path: str,
    path_map: list[tuple[str, str]],
    target_artist: str,
    target_album: str,
) -> None:
    with transaction_scope() as session:
        for old_track_path, new_track_path in path_map:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET album_id = :target_album_id,
                        artist = :target_artist,
                        albumartist = :target_artist,
                        album = :target_album,
                        path = :new_track_path,
                        updated_at = NOW()
                    WHERE album_id = :source_album_id
                      AND path = :old_track_path
                    """
                ),
                {
                    "source_album_id": source_album_id,
                    "target_album_id": target_album_id,
                    "target_artist": target_artist,
                    "target_album": target_album,
                    "old_track_path": old_track_path,
                    "new_track_path": new_track_path,
                },
            )
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET album_id = :target_album_id,
                    artist = :target_artist,
                    albumartist = :target_artist,
                    album = :target_album,
                    path = REPLACE(path, :old_prefix, :new_prefix),
                    updated_at = NOW()
                WHERE album_id = :source_album_id
                  AND path LIKE :pattern
                """
            ),
            {
                "source_album_id": source_album_id,
                "target_album_id": target_album_id,
                "target_artist": target_artist,
                "target_album": target_album,
                "old_prefix": old_path + "/",
                "new_prefix": new_path + "/",
                "pattern": old_path + "/%",
            },
        )
        session.execute(
            text("DELETE FROM library_albums WHERE id = :source_album_id"),
            {"source_album_id": source_album_id},
        )
        session.execute(
            text(
                "UPDATE library_albums SET updated_at = NOW() WHERE id = :target_album_id"
            ),
            {"target_album_id": target_album_id},
        )


def create_split_album_and_move_tracks(
    source_album_id: int,
    source_album: dict,
    target_album_name: str,
    target_album_path: str,
    track_moves: list[tuple[int, str, str]],
) -> int:
    formats = sorted(
        {
            str(source_format)
            for _track_id, _old_path, _new_path in track_moves
            for source_format in source_album.get("formats", [])
            if source_format
        }
    )
    target_album_id = upsert_album(
        {
            "artist": source_album["artist"],
            "name": target_album_name,
            "path": target_album_path,
            "track_count": len(track_moves),
            "total_size": 0,
            "total_duration": 0,
            "formats": formats,
            "year": source_album.get("year"),
            "genre": source_album.get("genre"),
            "has_cover": 0,
        }
    )
    with transaction_scope() as session:
        for track_id, old_path, new_path in track_moves:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET album_id = :target_album_id,
                        album = :target_album_name,
                        path = :new_path,
                        updated_at = NOW()
                    WHERE id = :track_id
                      AND album_id = :source_album_id
                      AND path = :old_path
                    """
                ),
                {
                    "track_id": track_id,
                    "source_album_id": source_album_id,
                    "target_album_id": target_album_id,
                    "target_album_name": target_album_name,
                    "old_path": old_path,
                    "new_path": new_path,
                },
            )

        for album_id in (source_album_id, target_album_id):
            session.execute(
                text(
                    """
                    UPDATE library_albums
                    SET track_count = stats.track_count,
                        total_size = stats.total_size,
                        total_duration = stats.total_duration,
                        updated_at = NOW()
                    FROM (
                        SELECT
                            COUNT(*)::int AS track_count,
                            COALESCE(SUM(size), 0)::bigint AS total_size,
                            COALESCE(SUM(duration), 0)::float AS total_duration
                        FROM library_tracks
                        WHERE album_id = :album_id
                    ) stats
                    WHERE library_albums.id = :album_id
                    """
                ),
                {"album_id": album_id},
            )
    return target_album_id


def merge_album_folder(old_path: str, new_path: str, album_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"
            ),
            {"name": album_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET path = REPLACE(path, :old_prefix, :new_prefix) WHERE path LIKE :pattern"
            ),
            {
                "old_prefix": old_path + "/",
                "new_prefix": new_path + "/",
                "pattern": old_path + "/%",
            },
        )
        session.execute(
            text(
                "DELETE FROM library_albums WHERE path = :old_path AND EXISTS "
                "(SELECT 1 FROM library_albums WHERE path = :new_path)"
            ),
            {"old_path": old_path, "new_path": new_path},
        )


def get_tracks_by_paths(paths: list[str]) -> list[dict]:
    if not paths:
        return []
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT
                    id,
                    entity_uid::text AS entity_uid,
                    album_id,
                    artist,
                    album,
                    title,
                    filename,
                    path,
                    track_number,
                    disc_number,
                    format,
                    bitrate,
                    sample_rate,
                    bit_depth,
                    duration,
                    size,
                    audio_fingerprint
                FROM library_tracks
                WHERE path = ANY(:paths)
                """
                ),
                {"paths": paths},
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def count_valid_album_tracks(album_id: int) -> int:
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM library_tracks
                WHERE album_id = :album_id
                  AND NULLIF(BTRIM(title), '') IS NOT NULL
                  AND COALESCE(track_number, 0) > 0
                  AND COALESCE(duration, 0) > 1
                """
            ),
            {"album_id": album_id},
        ).scalar_one()
    return int(row or 0)


__all__ = [
    "count_valid_album_tracks",
    "create_split_album_and_move_tracks",
    "get_tracks_by_paths",
    "merge_album_into_album",
    "merge_album_folder",
    "reassign_album_artist",
    "update_album_artist_and_path",
    "update_album_path_and_name",
    "update_track_artist",
]
