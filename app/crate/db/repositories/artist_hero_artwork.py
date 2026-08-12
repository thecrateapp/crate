"""Persistence for editorial artist-hero artwork profiles."""

from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


def get_artist_hero_artwork(artist_id: int, *, session=None) -> dict | None:
    def _read(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT artist_id, provenance, review_status, source_width,
                           source_height, desktop_source_width,
                           desktop_source_height, desktop_source_origin,
                           mobile_source_width, mobile_source_height,
                           mobile_source_origin, desktop_recipe, mobile_recipe,
                           revision, updated_at
                    FROM artist_hero_artwork
                    WHERE artist_id = :artist_id
                    """
                ),
                {"artist_id": artist_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _read(session)
    with read_scope() as active_session:
        return _read(active_session)


def upsert_artist_hero_artwork(
    *,
    artist_id: int,
    provenance: str,
    review_status: str,
    source_width: int,
    source_height: int,
    desktop_recipe: dict,
    mobile_recipe: dict,
    revision: str,
    desktop_source_width: int | None = None,
    desktop_source_height: int | None = None,
    desktop_source_origin: str | None = None,
    mobile_source_width: int | None = None,
    mobile_source_height: int | None = None,
    mobile_source_origin: str | None = None,
    session=None,
) -> None:
    def _write(active_session) -> None:
        active_session.execute(
            text(
                """
                INSERT INTO artist_hero_artwork (
                    artist_id, provenance, review_status, source_width,
                    source_height, desktop_source_width,
                    desktop_source_height, desktop_source_origin,
                    mobile_source_width, mobile_source_height,
                    mobile_source_origin, desktop_recipe, mobile_recipe,
                    revision, updated_at
                ) VALUES (
                    :artist_id, :provenance, :review_status, :source_width,
                    :source_height, :desktop_source_width,
                    :desktop_source_height, :desktop_source_origin,
                    :mobile_source_width, :mobile_source_height,
                    :mobile_source_origin, CAST(:desktop_recipe AS JSONB),
                    CAST(:mobile_recipe AS JSONB), :revision, NOW()
                )
                ON CONFLICT (artist_id) DO UPDATE SET
                    provenance = EXCLUDED.provenance,
                    review_status = EXCLUDED.review_status,
                    source_width = EXCLUDED.source_width,
                    source_height = EXCLUDED.source_height,
                    desktop_source_width = EXCLUDED.desktop_source_width,
                    desktop_source_height = EXCLUDED.desktop_source_height,
                    desktop_source_origin = EXCLUDED.desktop_source_origin,
                    mobile_source_width = EXCLUDED.mobile_source_width,
                    mobile_source_height = EXCLUDED.mobile_source_height,
                    mobile_source_origin = EXCLUDED.mobile_source_origin,
                    desktop_recipe = EXCLUDED.desktop_recipe,
                    mobile_recipe = EXCLUDED.mobile_recipe,
                    revision = EXCLUDED.revision,
                    updated_at = NOW()
                """
            ),
            {
                "artist_id": artist_id,
                "provenance": provenance,
                "review_status": review_status,
                "source_width": source_width,
                "source_height": source_height,
                "desktop_source_width": desktop_source_width,
                "desktop_source_height": desktop_source_height,
                "desktop_source_origin": desktop_source_origin,
                "mobile_source_width": mobile_source_width,
                "mobile_source_height": mobile_source_height,
                "mobile_source_origin": mobile_source_origin,
                "desktop_recipe": json.dumps(desktop_recipe),
                "mobile_recipe": json.dumps(mobile_recipe),
                "revision": revision,
            },
        )

    if session is not None:
        _write(session)
    else:
        with transaction_scope() as active_session:
            _write(active_session)


def update_artist_hero_review_status(
    artist_id: int, review_status: str, *, session=None
) -> bool:
    def _write(active_session) -> bool:
        result = active_session.execute(
            text(
                """
                UPDATE artist_hero_artwork
                SET review_status = :review_status,
                    revision = SUBSTRING(
                        MD5(
                            revision || ':' || :review_status || ':' ||
                            clock_timestamp()::text
                        ),
                        1,
                        16
                    ),
                    updated_at = NOW()
                WHERE artist_id = :artist_id
                """
            ),
            {"artist_id": artist_id, "review_status": review_status},
        )
        return result.rowcount > 0

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def list_artist_hero_backfill_candidates(
    *, after_id: int = 0, limit: int = 25
) -> list[dict]:
    capped_limit = max(1, min(int(limit), 100))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT artist.id, artist.name, artist.entity_uid
                    FROM library_artists artist
                    LEFT JOIN artist_hero_artwork hero
                      ON hero.artist_id = artist.id
                    WHERE artist.id > :after_id
                      AND artist.name NOT LIKE '.%'
                      AND COALESCE(artist.folder_name, '') NOT LIKE '.%'
                      AND (hero.artist_id IS NULL OR hero.provenance <> 'manual')
                    ORDER BY artist.id
                    LIMIT :limit
                    """
                ),
                {"after_id": max(0, int(after_id)), "limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]
