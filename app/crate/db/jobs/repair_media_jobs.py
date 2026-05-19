from sqlalchemy import text

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
    "get_tracks_by_paths",
    "merge_album_folder",
    "reassign_album_artist",
    "update_album_path_and_name",
    "update_track_artist",
]
