"""New releases — detection and tracking of new albums from library artists."""

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from crate.db.serialize import serialize_row
from crate.db.tx import read_scope, transaction_scope
from crate.slugs import build_public_album_slug
from crate.track_versions import canonical_track_title_key, track_variant_rank


def upsert_new_release(
    artist_name: str,
    album_title: str,
    tidal_id: str = "",
    tidal_url: str = "",
    cover_url: str = "",
    year: str = "",
    tracks: int = 0,
    quality: str = "",
    release_date: str = "",
    release_type: str = "",
    mb_release_group_id: str = "",
    source_name: str = "",
    source_url: str = "",
    cover_source: str = "",
    tracklist: list[dict[str, Any]] | None = None,
    preview_tracks: list[dict[str, Any]] | None = None,
    *,
    session=None,
) -> int:
    """Insert or update a detected new release. Returns release ID."""
    if session is None:
        with transaction_scope() as s:
            return upsert_new_release(
                artist_name,
                album_title,
                tidal_id,
                tidal_url,
                cover_url,
                year,
                tracks,
                quality,
                release_date,
                release_type,
                mb_release_group_id,
                source_name,
                source_url,
                cover_source,
                tracklist,
                preview_tracks,
                session=s,
            )
    now = datetime.now(timezone.utc).isoformat()
    row = (
        session.execute(
            text("""
            INSERT INTO new_releases (artist_name, album_title, tidal_id, tidal_url,
                cover_url, year, tracks, quality, status, detected_at,
                release_date, release_type, mb_release_group_id, source_name, source_url,
                cover_source, tracklist_json, preview_tracks_json)
            VALUES (:artist_name, :album_title, :tidal_id, :tidal_url, :cover_url, :year, :tracks, :quality, 'detected', :detected_at, :release_date, :release_type, :mb_release_group_id, :source_name, :source_url, :cover_source, CAST(:tracklist_json AS jsonb), CAST(:preview_tracks_json AS jsonb))
            ON CONFLICT (artist_name, album_title) DO UPDATE SET
                tidal_id = EXCLUDED.tidal_id, tidal_url = EXCLUDED.tidal_url,
                cover_url = EXCLUDED.cover_url, year = EXCLUDED.year,
                tracks = EXCLUDED.tracks, quality = EXCLUDED.quality,
                release_date = EXCLUDED.release_date,
                release_type = EXCLUDED.release_type,
                mb_release_group_id = EXCLUDED.mb_release_group_id,
                source_name = EXCLUDED.source_name,
                source_url = EXCLUDED.source_url,
                cover_source = EXCLUDED.cover_source,
                tracklist_json = EXCLUDED.tracklist_json,
                preview_tracks_json = EXCLUDED.preview_tracks_json
            RETURNING id
        """),
            {
                "artist_name": artist_name,
                "album_title": album_title,
                "tidal_id": tidal_id,
                "tidal_url": tidal_url,
                "cover_url": cover_url,
                "year": year,
                "tracks": tracks,
                "quality": quality,
                "detected_at": now,
                "release_date": release_date or None,
                "release_type": release_type or None,
                "mb_release_group_id": mb_release_group_id or None,
                "source_name": source_name or None,
                "source_url": source_url or None,
                "cover_source": cover_source or None,
                "tracklist_json": json.dumps(tracklist or []),
                "preview_tracks_json": json.dumps(preview_tracks or []),
            },
        )
        .mappings()
        .first()
    )
    return row["id"]


def get_new_releases(
    status: str = "", upcoming: bool = False, limit: int = 200
) -> list[dict]:
    """Get new releases. If upcoming=True, only future releases ordered by release_date."""
    with read_scope() as session:
        select_sql = """
            SELECT
                nr.*,
                la.id AS artist_id,
                la.slug AS artist_slug,
                alb.id AS album_id,
                alb.slug AS album_slug
            FROM new_releases nr
            LEFT JOIN library_artists la ON LOWER(la.name) = LOWER(nr.artist_name)
            LEFT JOIN library_albums alb
              ON LOWER(alb.artist) = LOWER(nr.artist_name)
             AND LOWER(alb.name) = LOWER(nr.album_title)
        """
        if upcoming:
            rows = (
                session.execute(
                    text(
                        select_sql + "WHERE nr.status NOT IN ('dismissed') "
                        "AND nr.release_date IS NOT NULL AND nr.release_date >= :today "
                        "ORDER BY nr.release_date ASC LIMIT :lim"
                    ),
                    {"today": datetime.now(timezone.utc).date(), "lim": limit},
                )
                .mappings()
                .all()
            )
        elif status:
            rows = (
                session.execute(
                    text(
                        select_sql
                        + "WHERE nr.status = :status ORDER BY nr.release_date DESC NULLS LAST, nr.detected_at DESC LIMIT :lim"
                    ),
                    {"status": status, "lim": limit},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        select_sql
                        + "WHERE nr.status NOT IN ('dismissed') ORDER BY nr.release_date DESC NULLS LAST, nr.detected_at DESC LIMIT :lim"
                    ),
                    {"lim": limit},
                )
                .mappings()
                .all()
            )
        return [serialize_row(r) for r in rows]


def get_upcoming_releases_for_artist(
    artist_name: str, *, limit: int = 50
) -> list[dict]:
    """Upcoming release rows for a library artist, excluding dismissed items."""
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
                SELECT
                    nr.*,
                    la.id AS artist_id,
                    la.slug AS artist_slug,
                    alb.id AS album_id,
                    alb.slug AS album_slug
                FROM new_releases nr
                LEFT JOIN library_artists la ON LOWER(la.name) = LOWER(nr.artist_name)
                LEFT JOIN library_albums alb
                  ON LOWER(alb.artist) = LOWER(nr.artist_name)
                 AND LOWER(alb.name) = LOWER(nr.album_title)
                WHERE LOWER(nr.artist_name) = LOWER(:artist_name)
                  AND nr.status NOT IN ('dismissed')
                  AND nr.release_date IS NOT NULL
                  AND nr.release_date >= :today
                ORDER BY nr.release_date ASC, nr.album_title ASC
                LIMIT :limit
                """),
                {
                    "artist_name": artist_name,
                    "today": datetime.now(timezone.utc).date(),
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
        return [serialize_row(r) for r in rows]


def find_upcoming_release_by_artist_album_slug(
    artist_name: str, album_slug: str
) -> dict | None:
    wanted = build_public_album_slug(album_slug)
    artist_slug = build_public_album_slug(artist_name)
    candidates = {wanted}
    if artist_slug and wanted.startswith(f"{artist_slug}-"):
        candidates.add(wanted[len(artist_slug) + 1 :])
    for release in get_upcoming_releases_for_artist(artist_name):
        if build_public_album_slug(release.get("album_title")) in candidates:
            return release
    return None


def get_artist_release_track_matches(artist_name: str) -> dict[str, list[dict]]:
    """Index local tracks for pre-release availability matching."""
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
                SELECT
                    t.id,
                    t.entity_uid::text AS entity_uid,
                    t.storage_id::text AS storage_id,
                    t.filename,
                    t.title,
                    t.artist,
                    t.album,
                    t.track_number,
                    t.disc_number,
                    t.format,
                    t.bitrate,
                    t.sample_rate,
                    t.bit_depth,
                    t.duration,
                    t.size,
                    t.year,
                    t.genre,
                    t.albumartist,
                    t.musicbrainz_albumid,
                    t.musicbrainz_trackid,
                    t.path,
                    t.bpm,
                    t.audio_key,
                    t.audio_scale,
                    t.energy,
                    t.danceability,
                    t.valence,
                    t.bliss_vector,
                    t.popularity,
                    t.popularity_score,
                    t.popularity_confidence,
                    t.rating,
                    a.id AS album_id,
                    a.slug AS album_slug,
                    a.entity_uid::text AS album_entity_uid,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug,
                    ar.entity_uid::text AS artist_entity_uid
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON LOWER(ar.name) = LOWER(t.artist)
                WHERE LOWER(t.artist) = LOWER(:artist_name)
                   OR LOWER(t.albumartist) = LOWER(:artist_name)
                   OR LOWER(a.artist) = LOWER(:artist_name)
                ORDER BY COALESCE(a.year, t.year, '') DESC,
                         COALESCE(t.track_number, 9999) ASC,
                         t.title ASC
                """),
                {"artist_name": artist_name},
            )
            .mappings()
            .all()
        )

    indexed: dict[str, list[dict]] = {}
    for row in rows:
        current = serialize_row(row)
        key = canonical_track_title_key(str(current.get("title") or ""))
        if not key:
            continue
        indexed.setdefault(key, []).append(current)

    for candidates in indexed.values():
        candidates.sort(
            key=lambda track: (
                track_variant_rank(str(track.get("title") or "")),
                -int(track.get("bitrate") or 0),
                int(track.get("id") or 0),
            )
        )
    return indexed


def mark_release_downloading(release_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return mark_release_downloading(release_id, session=s)
    session.execute(
        text("UPDATE new_releases SET status = 'downloading' WHERE id = :id"),
        {"id": release_id},
    )


def mark_release_downloaded(release_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return mark_release_downloaded(release_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text(
            "UPDATE new_releases SET status = 'downloaded', downloaded_at = :now WHERE id = :id"
        ),
        {"now": now, "id": release_id},
    )


def mark_release_dismissed(release_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return mark_release_dismissed(release_id, session=s)
    session.execute(
        text("UPDATE new_releases SET status = 'dismissed' WHERE id = :id"),
        {"id": release_id},
    )


def is_album_in_library(artist_name: str, album_title: str) -> bool:
    """Check if an album already exists in the library (fuzzy: case-insensitive)."""
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT 1 FROM library_albums WHERE LOWER(artist) = LOWER(:artist) AND LOWER(name) = LOWER(:album) LIMIT 1"
                ),
                {"artist": artist_name, "album": album_title},
            )
            .mappings()
            .first()
        )
        return row is not None


def cleanup_old_releases(days: int = 90, *, session=None):
    """Remove dismissed/downloaded releases older than N days."""
    if session is None:
        with transaction_scope() as s:
            return cleanup_old_releases(days, session=s)
    from datetime import timedelta

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    session.execute(
        text(
            "DELETE FROM new_releases WHERE status IN ('downloaded', 'dismissed') AND detected_at < :cutoff"
        ),
        {"cutoff": cutoff},
    )
