"""DB functions for acquisition worker handlers."""

from datetime import datetime, timezone

from crate.db.tx import transaction_scope
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
