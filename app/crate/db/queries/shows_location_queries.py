from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import read_scope


def get_unique_user_cities() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT DISTINCT ON (LOWER(city))
                    city, country, country_code, latitude, longitude
                FROM users
                WHERE city IS NOT NULL AND latitude IS NOT NULL
                ORDER BY LOWER(city), id
                """
                )
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_show_sync_locations(limit: int = 8) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT DISTINCT ON (
                    ROUND(latitude::numeric, 3),
                    ROUND(longitude::numeric, 3),
                    COALESCE(country_code, ''),
                    COALESCE(show_radius_km, 60)
                )
                    city,
                    country,
                    country_code,
                    latitude,
                    longitude,
                    COALESCE(show_radius_km, 60) AS show_radius_km
                FROM users
                WHERE latitude IS NOT NULL
                  AND longitude IS NOT NULL
                  AND COALESCE(show_radius_km, 60) > 0
                ORDER BY
                    ROUND(latitude::numeric, 3),
                    ROUND(longitude::numeric, 3),
                    COALESCE(country_code, ''),
                    COALESCE(show_radius_km, 60),
                    id
                LIMIT :limit
                """
                ),
                {"limit": limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_show_cities() -> list[str]:
    today = datetime.now(timezone.utc).date()
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT DISTINCT city FROM shows WHERE date >= :today AND city IS NOT NULL AND city != '' ORDER BY city"
                ),
                {"today": today},
            )
            .mappings()
            .all()
        )
    return [row["city"] for row in rows]


def get_show_countries() -> list[str]:
    today = datetime.now(timezone.utc).date()
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT DISTINCT country FROM shows WHERE date >= :today AND country IS NOT NULL ORDER BY country"
                ),
                {"today": today},
            )
            .mappings()
            .all()
        )
    return [row["country"] for row in rows]


__all__ = [
    "get_show_cities",
    "get_show_countries",
    "get_show_sync_locations",
    "get_unique_user_cities",
]
