"""DB functions for management worker handlers."""

from uuid import uuid4

from sqlalchemy import text

from crate.db.tx import transaction_scope


def find_album_path(artist_name: str, album_name: str, escape_like_fn) -> str | None:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT path FROM library_albums WHERE artist = :artist AND name = :name LIMIT 1"
                ),
                {"artist": artist_name, "name": album_name},
            )
            .mappings()
            .first()
        )
        if not row:
            row = (
                session.execute(
                    text(
                        "SELECT path FROM library_albums WHERE artist = :artist AND name LIKE :pattern ESCAPE '\\' LIMIT 1"
                    ),
                    {"artist": artist_name, "pattern": escape_like_fn(album_name)},
                )
                .mappings()
                .first()
            )
        return row["path"] if row else None


def rename_artist_in_db(old_name: str, new_name: str, old_folder: str) -> None:
    if not old_name or not new_name:
        raise ValueError("Artist names cannot be empty")
    if old_name == new_name:
        return

    with transaction_scope() as session:
        source_exists = session.execute(
            text("SELECT 1 FROM library_artists WHERE name = :name"),
            {"name": old_name},
        ).scalar_one_or_none()
        if source_exists is None:
            raise ValueError(f"Artist not found: {old_name}")

        target_exists = session.execute(
            text("SELECT 1 FROM library_artists WHERE name = :name"),
            {"name": new_name},
        ).scalar_one_or_none()
        if target_exists is not None:
            raise ValueError(f"Artist already exists: {new_name}")

        temp_name = f"__crate_tmp__{uuid4().hex}"
        session.execute(
            text(
                "INSERT INTO library_artists (name, folder_name) VALUES (:name, :folder)"
            ),
            {"name": temp_name, "folder": new_name},
        )
        session.execute(
            text("UPDATE library_albums SET artist = :temp WHERE artist = :old"),
            {"temp": temp_name, "old": old_name},
        )
        session.execute(
            text(
                "UPDATE artist_genres SET artist_name = :temp WHERE artist_name = :old"
            ),
            {"temp": temp_name, "old": old_name},
        )
        session.execute(
            text(
                "UPDATE library_artists "
                "SET name = :new, folder_name = :new "
                "WHERE name = :old"
            ),
            {"new": new_name, "old": old_name},
        )
        session.execute(
            text(
                """
                UPDATE library_albums
                SET artist = :new,
                    path = REPLACE(path, :old_segment, :new_segment),
                    updated_at = NOW()
                WHERE artist = :temp
                """
            ),
            {
                "new": new_name,
                "temp": temp_name,
                "old_segment": f"/{old_folder}/",
                "new_segment": f"/{new_name}/",
            },
        )
        session.execute(
            text(
                """
                UPDATE library_tracks
                SET artist = CASE WHEN artist = :old THEN :new ELSE artist END,
                    albumartist = CASE
                        WHEN albumartist = :old THEN :new
                        ELSE albumartist
                    END,
                    path = REPLACE(path, :old_segment, :new_segment),
                    updated_at = NOW()
                WHERE artist = :old
                   OR albumartist = :old
                """
            ),
            {
                "old": old_name,
                "new": new_name,
                "old_segment": f"/{old_folder}/",
                "new_segment": f"/{new_name}/",
            },
        )
        session.execute(
            text(
                """
                DELETE FROM user_follows AS old_follow
                USING user_follows AS new_follow
                WHERE old_follow.user_id = new_follow.user_id
                  AND old_follow.artist_name = :old
                  AND new_follow.artist_name = :new
                """
            ),
            {"old": old_name, "new": new_name},
        )
        session.execute(
            text("UPDATE user_follows SET artist_name = :new WHERE artist_name = :old"),
            {"old": old_name, "new": new_name},
        )
        session.execute(
            text(
                "UPDATE artist_genres SET artist_name = :new WHERE artist_name = :temp"
            ),
            {"new": new_name, "temp": temp_name},
        )
        session.execute(
            text("DELETE FROM library_artists WHERE name = :temp"),
            {"temp": temp_name},
        )


def find_album_path_for_match(
    artist_name: str, album_name: str, album_db_path: str, escape_like_fn
) -> str:
    with transaction_scope() as session:
        row = (
            session.execute(
                text("SELECT path FROM library_albums WHERE path = :path"),
                {"path": album_db_path},
            )
            .mappings()
            .first()
        )
        if not row:
            row = (
                session.execute(
                    text(
                        "SELECT path FROM library_albums WHERE artist = :artist AND (name = :name OR name LIKE :pattern ESCAPE '\\') LIMIT 1"
                    ),
                    {
                        "artist": artist_name,
                        "name": album_name,
                        "pattern": escape_like_fn(album_name),
                    },
                )
                .mappings()
                .first()
            )
        return row["path"] if row else album_db_path


def apply_mbid_to_album(
    mbid: str, album_db_path: str, release_group_id: str | None
) -> int | None:
    with transaction_scope() as session:
        album_row = (
            session.execute(
                text(
                    "UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE path = :path RETURNING id"
                ),
                {"mbid": mbid, "path": album_db_path},
            )
            .mappings()
            .first()
        )
        if release_group_id:
            session.execute(
                text(
                    "UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE path = :path"
                ),
                {"rgid": release_group_id, "path": album_db_path},
            )
        if album_row:
            session.execute(
                text(
                    "UPDATE library_tracks SET musicbrainz_albumid = :mbid "
                    "WHERE album_id = :album_id AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')"
                ),
                {"mbid": mbid, "album_id": album_row["id"]},
            )
            return album_row["id"]
        return None
