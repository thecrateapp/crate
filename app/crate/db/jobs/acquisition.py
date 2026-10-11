"""DB functions for acquisition worker handlers."""

from datetime import date, datetime, timedelta, timezone

from crate.db.serialize import serialize_row
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text


def update_artist_latest_release_date(artist_name: str, release_date: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_artists SET latest_release_date = :date WHERE name = :name"
            ),
            {"date": release_date, "name": artist_name},
        )


def mark_artist_new_releases_checked(
    artist_name: str, checked_at: datetime | None = None
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_artists SET new_releases_checked_at = :checked_at WHERE name = :name"
            ),
            {
                "checked_at": checked_at or datetime.now(timezone.utc),
                "name": artist_name,
            },
        )


def get_due_prereleases(today: date, *, lookback_days: int) -> list[dict]:
    """Releases detected before their release date that are now out but not
    yet downloaded, newest first."""
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
                SELECT
                    nr.id,
                    nr.artist_name,
                    nr.album_title,
                    nr.release_date,
                    nr.tidal_url,
                    nr.cover_url,
                    nr.tracks,
                    COALESCE(MAX(alb.track_count), 0) AS library_track_count
                FROM new_releases nr
                LEFT JOIN library_albums alb
                  ON LOWER(alb.artist) = LOWER(nr.artist_name)
                 AND LOWER(alb.name) = LOWER(nr.album_title)
                WHERE nr.status = 'detected'
                  AND nr.release_date <= :today
                  AND nr.release_date >= :since
                  AND nr.detected_at::date < nr.release_date
                GROUP BY nr.id
                ORDER BY nr.release_date DESC, nr.id
                """),
                {"today": today, "since": today - timedelta(days=lookback_days)},
            )
            .mappings()
            .all()
        )
    return [serialize_row(row) for row in rows]


def set_new_release_tidal_source(
    release_id: int, *, tidal_id: str, tidal_url: str
) -> None:
    with transaction_scope() as session:
        session.execute(
            text("""
            UPDATE new_releases
            SET tidal_id = :tidal_id,
                tidal_url = :tidal_url,
                source_name = 'tidal',
                source_url = :tidal_url
            WHERE id = :id
            """),
            {"id": release_id, "tidal_id": tidal_id, "tidal_url": tidal_url},
        )
