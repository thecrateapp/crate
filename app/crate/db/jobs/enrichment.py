"""DB functions for enrichment worker handlers."""

from collections.abc import Mapping, Sequence
import json
from typing import Any

from sqlalchemy import text

from crate.release_dates import normalize_release_date
from crate.release_track_matching import match_release_track
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.tx import read_scope, transaction_scope


_RELEASE_IDENTITY_CONFLICT_JOIN = """
    LEFT JOIN (
        SELECT DISTINCT ON (LOWER(release.artist_name), LOWER(release.album_title))
               LOWER(release.artist_name) AS artist_key,
               LOWER(release.album_title) AS album_key,
               release.mb_release_group_id AS expected_release_group_id,
               jsonb_array_length(CASE
                 WHEN jsonb_typeof(release.tracklist_json) = 'array'
                 THEN release.tracklist_json ELSE '[]'::jsonb
               END) AS expected_tracks
        FROM new_releases release
        WHERE LOWER(release.release_type) = 'album'
          AND release.status <> 'dismissed'
          AND release.release_date <= CURRENT_DATE
          AND NULLIF(release.mb_release_group_id, '') IS NOT NULL
        ORDER BY LOWER(release.artist_name), LOWER(release.album_title),
                 release.release_date DESC, release.id DESC
    ) expected_release
      ON LOWER(COALESCE(album.release_group_primary_type, '')) IN ('single', 'ep')
     AND expected_release.artist_key = LOWER(album.artist)
     AND expected_release.album_key = LOWER(album.name)
     AND expected_release.expected_release_group_id <> COALESCE(album.musicbrainz_releasegroupid, '')
     AND expected_release.expected_tracks BETWEEN 2 AND album.track_count
"""


def get_albums_without_mbid() -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT * FROM library_albums WHERE musicbrainz_albumid IS NULL OR musicbrainz_albumid = ''"
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def get_albums_needing_release_metadata() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT album.*, artist.mbid AS artist_mbid,
                           expected_release.expected_release_group_id
                    FROM library_albums album
                    LEFT JOIN library_artists artist
                      ON LOWER(artist.name) = LOWER(album.artist)
                    {_RELEASE_IDENTITY_CONFLICT_JOIN}
                    WHERE album.quarantined_at IS NULL
                      AND (album.musicbrainz_albumid IS NULL
                       OR album.musicbrainz_albumid = ''
                       OR album.release_group_primary_type IS NULL
                       OR album.release_group_primary_type = ''
                       OR album.release_date IS NULL
                       OR album.release_date = ''
                       OR expected_release.expected_release_group_id IS NOT NULL)
                    ORDER BY album.artist, album.year NULLS LAST, album.name
                    """
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def get_albums_missing_release_group() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT
                        album.*,
                        expected_release.expected_release_group_id,
                        (
                            SELECT artist.mbid
                            FROM library_artists artist
                            WHERE LOWER(artist.name) = LOWER(album.artist)
                            ORDER BY artist.mbid IS NULL, artist.id
                            LIMIT 1
                        ) AS artist_mbid
                    FROM library_albums album
                    {_RELEASE_IDENTITY_CONFLICT_JOIN}
                    WHERE (COALESCE(album.release_group_primary_type, '') = ''
                           OR expected_release.expected_release_group_id IS NOT NULL)
                      AND album.quarantined_at IS NULL
                    ORDER BY album.id DESC
                    """
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def update_album_mbid(album_id: int, mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"
            ),
            {"mbid": mbid, "id": album_id},
        )


def update_album_release_group_id(album_id: int, release_group_id: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE id = :id"
            ),
            {"rgid": release_group_id, "id": album_id},
        )


def update_track_mbids(track_id: int, album_mbid: str, track_mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET musicbrainz_albumid = :album_mbid, musicbrainz_trackid = :track_mbid "
                "WHERE id = :id"
            ),
            {"album_mbid": album_mbid, "track_mbid": track_mbid, "id": track_id},
        )


def persist_album_release_mbids(
    album_id: int, tracks_db: Sequence[Mapping[str, Any]], release: dict
) -> None:
    release_mbid = release["mbid"]
    release_group_id = release.get("release_group_id", "")
    release_group_primary_type = release.get("release_group_primary_type")
    release_group_secondary_types = list(
        release.get("release_group_secondary_types") or []
    )
    release_date = normalize_release_date(release.get("first_release_date")) or ""
    mb_tracks = release.get("tracks", [])

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_albums
                SET musicbrainz_albumid = :mbid,
                    release_date = COALESCE(
                        NULLIF(:release_date, ''),
                        release_date
                    ),
                    release_group_primary_type = COALESCE(
                        :release_group_primary_type,
                        release_group_primary_type
                    ),
                    release_group_secondary_types =
                        CAST(:release_group_secondary_types AS jsonb),
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            {
                "mbid": release_mbid,
                "release_group_primary_type": release_group_primary_type,
                "release_date": release_date,
                "release_group_secondary_types": json.dumps(
                    release_group_secondary_types
                ),
                "id": album_id,
            },
        )
        if release_group_id:
            session.execute(
                text(
                    "UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE id = :id"
                ),
                {"rgid": release_group_id, "id": album_id},
            )
        entity_uid = session.execute(
            text("SELECT entity_uid::text FROM library_albums WHERE id = :id"),
            {"id": album_id},
        ).scalar_one_or_none()
        if entity_uid:
            enqueue_local_dirty_source(
                "album", str(entity_uid), "upsert", session=session
            )
        for db_track in tracks_db:
            matched_track = match_release_track(db_track, mb_tracks)
            if matched_track is None:
                continue
            track_mbid = matched_track.get("mbid", "")
            if track_mbid:
                track_entity_uid = session.execute(
                    text(
                        "UPDATE library_tracks SET musicbrainz_albumid = :album_mbid, musicbrainz_trackid = :track_mbid "
                        "WHERE id = :id RETURNING entity_uid::text"
                    ),
                    {
                        "album_mbid": release_mbid,
                        "track_mbid": track_mbid,
                        "id": db_track["id"],
                    },
                ).scalar_one_or_none()
                if track_entity_uid:
                    enqueue_local_dirty_source(
                        "track", str(track_entity_uid), "upsert", session=session
                    )


def persist_album_release_group_types(updates: list[dict]) -> int:
    if not updates:
        return 0
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_albums
                SET musicbrainz_releasegroupid = COALESCE(
                        NULLIF(:musicbrainz_releasegroupid, ''),
                        musicbrainz_releasegroupid
                    ),
                    release_group_primary_type = COALESCE(
                        :release_group_primary_type,
                        release_group_primary_type
                    ),
                    release_date = COALESCE(
                        NULLIF(:release_date, ''),
                        release_date
                    ),
                    release_group_secondary_types =
                        CAST(:release_group_secondary_types AS jsonb),
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            [
                {
                    **update,
                    "musicbrainz_releasegroupid": str(
                        update.get("musicbrainz_releasegroupid") or ""
                    ),
                    "release_group_primary_type": update.get(
                        "release_group_primary_type"
                    ),
                    "release_date": normalize_release_date(update.get("release_date"))
                    or "",
                    "release_group_secondary_types": json.dumps(
                        update.get("release_group_secondary_types") or []
                    ),
                }
                for update in updates
            ],
        )
        rows = (
            session.execute(
                text(
                    """
                    SELECT id, entity_uid::text AS entity_uid
                    FROM library_albums
                    WHERE id = ANY(CAST(:ids AS bigint[]))
                    """
                ),
                {"ids": [int(update["id"]) for update in updates]},
            )
            .mappings()
            .all()
        )
        for row in rows:
            if row["entity_uid"]:
                enqueue_local_dirty_source(
                    "album", str(row["entity_uid"]), "upsert", session=session
                )
    return len(updates)


def update_album_mbid_and_propagate(album_id: int, mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"
            ),
            {"mbid": mbid, "id": album_id},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET musicbrainz_albumid = :mbid "
                "WHERE album_id = :album_id AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')"
            ),
            {"mbid": mbid, "album_id": album_id},
        )


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                "WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def update_album_has_cover(album_id: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET has_cover = 1 WHERE id = :id"),
            {"id": album_id},
        )


def update_album_path_after_reorganize(
    old_path: str, new_path: str, clean_name: str
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"
            ),
            {"name": clean_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET path = REPLACE(path, :old_path, :new_path) WHERE path LIKE :pattern"
            ),
            {"old_path": old_path, "new_path": new_path, "pattern": old_path + "%"},
        )


def update_artist_content_hash(artist_name: str, content_hash: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET content_hash = :hash WHERE name = :name"),
            {"hash": content_hash, "name": artist_name},
        )


def get_artists_with_mbid() -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
            SELECT id, slug, name, mbid, album_count, has_photo, listeners
            FROM library_artists
            WHERE mbid IS NOT NULL AND mbid != ''
            ORDER BY name
            """
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def get_album_names_for_artist(artist_name: str) -> set[str]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text("SELECT name FROM library_albums WHERE artist = :artist"),
                {"artist": artist_name},
            )
            .mappings()
            .all()
        )
        return {row["name"].lower() for row in rows}


def get_album_names_for_artists(artist_names: Sequence[str]) -> dict[str, set[str]]:
    """Return normalized local album names grouped by artist in one query."""
    names = [str(name).strip() for name in artist_names if str(name).strip()]
    if not names:
        return {}
    names_by_key = {name.lower(): name for name in names}

    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT artist, name
                    FROM library_albums
                    WHERE LOWER(artist) = ANY(CAST(:artists AS text[]))
                    """
                ),
                {"artists": list(names_by_key)},
            )
            .mappings()
            .all()
        )

    grouped = {name: set() for name in names}
    for row in rows:
        artist = str(row["artist"] or "")
        album_name = str(row["name"] or "").strip().lower()
        canonical_name = names_by_key.get(artist.lower())
        if canonical_name and album_name:
            grouped[canonical_name].add(album_name)
    return grouped
