from crate.db.tx import read_scope
from sqlalchemy import text


def get_artists_with_folder() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT name, folder_name FROM library_artists WHERE folder_name IS NOT NULL"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_orphan_albums() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT name, artist, path FROM library_albums "
                    "WHERE artist NOT IN (SELECT name FROM library_artists)"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_orphan_tracks() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT path, album_id FROM library_tracks "
                    "WHERE album_id NOT IN (SELECT id FROM library_albums)"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_all_artists() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("SELECT name, folder_name, entity_uid FROM library_artists")
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_all_albums() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(text("SELECT name, artist, path FROM library_albums"))
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_tracks_sample(total_threshold: int = 5000, modulo: int = 10) -> list[dict]:
    with read_scope() as session:
        total_row = (
            session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks"))
            .mappings()
            .first()
        )
        total = int(total_row["cnt"] or 0) if total_row is not None else 0
        if total < total_threshold:
            rows = (
                session.execute(text("SELECT path, artist FROM library_tracks"))
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        "SELECT path, artist FROM library_tracks WHERE MOD(id, :modulo) = 0"
                    ),
                    {"modulo": modulo},
                )
                .mappings()
                .all()
            )
    return [dict(r) for r in rows]


def get_zombie_artists() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT la.name FROM library_artists la "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM library_albums alb "
                    "  WHERE LOWER(alb.artist) = LOWER(la.name)"
                    ") "
                    "AND NOT EXISTS ("
                    "  SELECT 1 FROM library_tracks lt "
                    "  WHERE LOWER(lt.artist) = LOWER(la.name)"
                    ")"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_artists_with_photo() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("SELECT name, folder_name, has_photo FROM library_artists")
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_duplicate_albums() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT artist, LOWER(name) AS album_key, MIN(name) AS album_name, COUNT(*) AS cnt, "
                    "array_agg(path ORDER BY path) AS paths "
                    "FROM library_albums GROUP BY artist, LOWER(name) HAVING COUNT(*) > 1"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_all_track_paths() -> set[str]:
    with read_scope() as session:
        rows = session.execute(text("SELECT path FROM library_tracks")).mappings().all()
    return {r["path"] for r in rows}


def get_tracks_tag_sample(total_threshold: int = 5000, modulo: int = 20) -> list[dict]:
    with read_scope() as session:
        total_row = (
            session.execute(text("SELECT COUNT(*) AS cnt FROM library_tracks"))
            .mappings()
            .first()
        )
        total = int(total_row["cnt"] or 0) if total_row is not None else 0
        if total < total_threshold:
            rows = (
                session.execute(text("SELECT path, artist FROM library_tracks"))
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        "SELECT path, artist FROM library_tracks WHERE MOD(id, :modulo) = 0"
                    ),
                    {"modulo": modulo},
                )
                .mappings()
                .all()
            )
    return [dict(r) for r in rows]


def get_albums_with_year() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT name, artist, year, path FROM library_albums "
                    "WHERE year IS NOT NULL AND year != '' AND length(year) >= 4"
                )
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_all_albums_for_covers() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(text("SELECT artist, name, path FROM library_albums"))
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_duplicate_tracks(album_id: int | None = None) -> list[dict]:
    """Find real duplicate tracks inside the same album.

    Rows with broken metadata (empty title, track number 0, duration 0) are
    handled by shadow-quality repair instead of being reported as duplicates.
    Ambiguous candidates are deliberately excluded because the duplicate-track
    fixer is destructive and only safe when every copy belongs to the same
    physical album directory, has matching duration, and matches the canonical
    album identity. Conflicting audio fingerprints are only reported when the
    durations are near-identical; the fixer then requires readable tags before
    it quarantines anything.
    """
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            WITH candidates AS (
                SELECT
                    lt.album_id,
                    la.artist AS artist,
                    la.name AS album,
                    lt.title,
                    lt.track_number,
                    lt.disc_number,
                    COUNT(*) AS cnt,
                    array_agg(lt.path ORDER BY lt.path) AS paths,
                    array_agg(lt.id ORDER BY lt.path) AS track_ids,
                    jsonb_agg(
                        jsonb_build_object(
                            'id', lt.id,
                            'path', lt.path,
                            'filename', lt.filename,
                            'format', lt.format,
                            'bitrate', lt.bitrate,
                            'sample_rate', lt.sample_rate,
                            'bit_depth', lt.bit_depth,
                            'duration', lt.duration,
                            'size', lt.size,
                            'has_audio_fingerprint',
                                NULLIF(lt.audio_fingerprint, '') IS NOT NULL,
                            'audio_fingerprint_source',
                                lt.audio_fingerprint_source
                        )
                        ORDER BY lt.path
                    ) AS tracks,
                    COUNT(*) FILTER (
                        WHERE NULLIF(lt.audio_fingerprint, '') IS NOT NULL
                    ) AS fingerprinted_count,
                    COUNT(*) FILTER (
                        WHERE NULLIF(lt.audio_fingerprint, '') IS NULL
                    ) AS missing_fingerprint_count,
                    COUNT(DISTINCT regexp_replace(lt.path, '/[^/]+$', '')) AS parent_count,
                    MAX(lt.duration) - MIN(lt.duration) AS duration_delta,
                    COUNT(DISTINCT NULLIF(lt.audio_fingerprint, '')) AS fingerprint_count,
                    COUNT(*) FILTER (
                        WHERE LOWER(COALESCE(lt.artist, '')) <> LOWER(COALESCE(la.artist, ''))
                           OR LOWER(COALESCE(lt.album, '')) <> LOWER(COALESCE(la.name, ''))
                    ) AS db_identity_mismatches
                FROM library_tracks lt
                JOIN library_albums la ON la.id = lt.album_id
                WHERE lt.album_id IS NOT NULL
                  AND (:album_id IS NULL OR lt.album_id = :album_id)
                  AND NULLIF(BTRIM(lt.title), '') IS NOT NULL
                  AND COALESCE(lt.track_number, 0) > 0
                  AND COALESCE(lt.duration, 0) > 1
                GROUP BY
                    lt.album_id,
                    la.artist,
                    la.name,
                    lt.title,
                    lt.track_number,
                    lt.disc_number
                HAVING COUNT(*) > 1
            )
            SELECT
                album_id,
                artist,
                title,
                album,
                track_number,
                disc_number,
                cnt,
                paths,
                track_ids,
                tracks,
                fingerprinted_count,
                missing_fingerprint_count
            FROM candidates
            WHERE parent_count = 1
              AND duration_delta <= 1.0
              AND (
                fingerprint_count <= 1
                OR duration_delta <= 0.25
              )
              AND db_identity_mismatches = 0
            ORDER BY artist, album, disc_number, track_number, title
        """),
                {"album_id": album_id},
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]


def get_shadow_quality_tracks() -> list[dict]:
    """Find legacy lower-quality rows left behind after quality upgrades.

    These rows usually still point to old artist/year folders while the album row
    points to the canonical entity_uid folder. They have broken metadata because
    the better copy already owns the real track identity.
    """
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            WITH valid_counts AS (
                SELECT album_id, COUNT(*) AS valid_count
                FROM library_tracks
                WHERE album_id IS NOT NULL
                  AND NULLIF(BTRIM(title), '') IS NOT NULL
                  AND COALESCE(track_number, 0) > 0
                  AND COALESCE(duration, 0) > 1
                GROUP BY album_id
            )
            SELECT
                lt.album_id,
                la.artist,
                la.name AS album,
                la.path AS canonical_album_path,
                vc.valid_count,
                COUNT(*) AS cnt,
                array_agg(DISTINCT LOWER(COALESCE(lt.format, '')) ORDER BY LOWER(COALESCE(lt.format, ''))) AS formats,
                array_agg(lt.path ORDER BY lt.path) AS paths
            FROM library_tracks lt
            JOIN library_albums la ON la.id = lt.album_id
            JOIN valid_counts vc ON vc.album_id = lt.album_id
            WHERE vc.valid_count > 0
              AND la.path IS NOT NULL
              AND lt.path NOT LIKE la.path || '/%'
              AND (
                NULLIF(BTRIM(lt.title), '') IS NULL
                OR COALESCE(lt.track_number, 0) <= 0
                OR COALESCE(lt.duration, 0) <= 1
              )
            GROUP BY lt.album_id, la.artist, la.name, la.path, vc.valid_count
            ORDER BY la.artist, la.name
        """)
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]
