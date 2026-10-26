from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

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
                    "SELECT DISTINCT city FROM shows WHERE date >= :today AND merged_into_id IS NULL AND city IS NOT NULL AND city != '' ORDER BY city"
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
                    "SELECT DISTINCT country FROM shows WHERE date >= :today AND merged_into_id IS NULL AND country IS NOT NULL ORDER BY country"
                ),
                {"today": today},
            )
            .mappings()
            .all()
        )
    return [row["country"] for row in rows]


def get_show_venue_location_candidates(
    venue: str,
    city: str,
    *,
    region: str | None = None,
    country_code: str | None = None,
    limit: int = 20,
    session: Session | None = None,
) -> list[dict]:
    """Return existing venue locations in a city, preferring manual data."""
    normalized_venue = " ".join((venue or "").strip().casefold().split())
    normalized_city = " ".join((city or "").strip().casefold().split())
    if not normalized_venue or not normalized_city:
        return []

    # Venue names often include a generic "Sala" prefix in one source but not
    # another. Keep the SQL predicate bounded by city while normalizing that
    # prefix and whitespace; the caller applies its stricter Unicode match.
    venue_key = normalized_venue
    for prefix in ("sala ", "venue ", "music venue "):
        if venue_key.startswith(prefix):
            venue_key = venue_key[len(prefix) :]
            break

    sql = text(
        r"""
        SELECT id, venue, city, region, country, country_code,
               address_line1, postal_code, latitude, longitude,
               CASE WHEN source IN ('manual', 'mcp')
                          OR field_provenance->'address_line1'->>'provider'
                               IN ('manual', 'mcp')
                          OR field_provenance->'postal_code'->>'provider'
                               IN ('manual', 'mcp')
                          OR field_provenance->'latitude'->>'provider'
                               IN ('manual', 'mcp')
                          OR field_provenance->'longitude'->>'provider'
                               IN ('manual', 'mcp')
                    THEN TRUE ELSE FALSE END AS manually_verified,
               updated_at
        FROM shows
        WHERE merged_into_id IS NULL
          AND venue IS NOT NULL AND btrim(venue) <> ''
          AND city IS NOT NULL AND btrim(city) <> ''
          AND regexp_replace(lower(btrim(city)), '\s+', ' ', 'g') = :city
          AND lower(regexp_replace(
                regexp_replace(btrim(venue), '^(sala|venue|music venue)\s+', '', 'i'),
                '\s+', ' ', 'g')) = :venue
          AND (address_line1 IS NOT NULL OR postal_code IS NOT NULL
               OR (latitude IS NOT NULL AND longitude IS NOT NULL))
          AND (:region IS NULL OR region IS NULL OR lower(btrim(region)) = :region)
          AND (:country_code IS NULL OR country_code IS NULL
               OR lower(btrim(country_code)) = :country_code)
        ORDER BY manually_verified DESC,
                 (address_line1 IS NOT NULL) DESC,
                 (latitude IS NOT NULL AND longitude IS NOT NULL) DESC,
                 updated_at DESC, id DESC
        LIMIT :limit
        """
    )
    params = {
        "venue": venue_key,
        "city": normalized_city,
        "region": (region or "").strip().casefold() or None,
        "country_code": (country_code or "").strip().casefold() or None,
        "limit": min(max(int(limit), 1), 100),
    }

    def _impl(current):
        return [dict(row) for row in current.execute(sql, params).mappings().all()]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "get_show_cities",
    "get_show_countries",
    "get_show_sync_locations",
    "get_show_venue_location_candidates",
    "get_unique_user_cities",
]
