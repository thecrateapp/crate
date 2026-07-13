from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.user_library_shared import (
    normalize_stats_window,
    window_day_cutoff,
)
from crate.db.tx import read_scope
from crate.federation.global_policy import global_catalog_surface_enabled


def _global_stats_refs_enabled() -> bool:
    return global_catalog_surface_enabled("stats") or global_catalog_surface_enabled(
        "home"
    )


def get_play_stats(user_id: int) -> dict:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT COALESCE(SUM(play_count), 0) AS total_plays FROM user_daily_listening WHERE user_id = :user_id"
                ),
                {"user_id": user_id},
            )
            .mappings()
            .first()
        )
        total = row["total_plays"] if row is not None else 0
        top_artists_rows = (
            session.execute(
                text(
                    """
                SELECT artist_name AS artist, play_count AS plays
                FROM user_artist_stats
                WHERE user_id = :user_id AND stat_window = 'all_time'
                ORDER BY play_count DESC, minutes_listened DESC, artist_name ASC
                LIMIT 10
                """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        top_artists = [dict(r) for r in top_artists_rows]

    return {"total_plays": total, "top_artists": top_artists}


def _get_stats_overview_payload(
    user_id: int, *, window: str, day_cutoff: str | None
) -> dict:
    allow_global_catalog = _global_stats_refs_enabled()
    with read_scope() as session:
        if day_cutoff is None:
            overview_row = (
                session.execute(
                    text(
                        """
                    SELECT
                        COALESCE(SUM(play_count), 0) AS play_count,
                        COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                        COALESCE(SUM(skip_count), 0) AS skip_count,
                        COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                        COUNT(*)::INTEGER AS active_days
                    FROM user_daily_listening
                    WHERE user_id = :user_id
                    """
                    ),
                    {"user_id": user_id},
                )
                .mappings()
                .first()
            )
        else:
            overview_row = (
                session.execute(
                    text(
                        """
                    SELECT
                        COALESCE(SUM(play_count), 0) AS play_count,
                        COALESCE(SUM(complete_play_count), 0) AS complete_play_count,
                        COALESCE(SUM(skip_count), 0) AS skip_count,
                        COALESCE(SUM(minutes_listened), 0) AS minutes_listened,
                        COUNT(*)::INTEGER AS active_days
                    FROM user_daily_listening
                    WHERE user_id = :user_id AND day >= :day_cutoff
                    """
                    ),
                    {"user_id": user_id, "day_cutoff": day_cutoff},
                )
                .mappings()
                .first()
            )
        overview = dict(overview_row or {})

        top_artist_row = (
            session.execute(
                text(
                    """
                SELECT
                    uas.artist_name,
                    CASE
                        WHEN :allow_global_catalog THEN gca.global_artist_uid::text
                        ELSE NULL
                    END AS global_artist_uid,
                    la.id AS artist_id,
                    la.slug AS artist_slug,
                    uas.play_count,
                    uas.minutes_listened
                FROM user_artist_stats uas
                LEFT JOIN library_artists la ON la.name = uas.artist_name
                LEFT JOIN LATERAL (
                    SELECT global_artist_uid
                    FROM global_catalog_artists gca
                    WHERE (
                        la.entity_uid IS NOT NULL
                        AND gca.local_artist_entity_uid = la.entity_uid
                    )
                    OR LOWER(gca.canonical_name) = LOWER(uas.artist_name)
                    ORDER BY gca.has_local DESC, gca.has_remote DESC, gca.source_count DESC
                    LIMIT 1
                ) gca ON :allow_global_catalog
                WHERE uas.user_id = :user_id AND uas.stat_window = :window
                ORDER BY uas.play_count DESC, uas.minutes_listened DESC, uas.artist_name ASC
                LIMIT 1
                """
                ),
                {
                    "user_id": user_id,
                    "window": window,
                    "allow_global_catalog": allow_global_catalog,
                },
            )
            .mappings()
            .first()
        )
        top_artist = dict(top_artist_row) if top_artist_row else None

    return {
        "overview": overview,
        "top_artist": dict(top_artist) if top_artist else None,
    }


def get_stats_overview(user_id: int, window: str = "30d") -> dict:
    normalized = normalize_stats_window(window)
    day_cutoff = window_day_cutoff(normalized)
    payload = _get_stats_overview_payload(
        user_id, window=normalized, day_cutoff=day_cutoff
    )
    overview = payload["overview"]
    top_artist = payload["top_artist"]
    play_count = overview.get("play_count", 0) or 0
    skip_count = overview.get("skip_count", 0) or 0
    return {
        "window": normalized,
        "play_count": play_count,
        "complete_play_count": overview.get("complete_play_count", 0) or 0,
        "skip_count": skip_count,
        "minutes_listened": overview.get("minutes_listened", 0) or 0,
        "active_days": overview.get("active_days", 0) or 0,
        "skip_rate": (skip_count / play_count) if play_count else 0,
        "top_artist": dict(top_artist) if top_artist else None,
    }


__all__ = [
    "get_play_stats",
    "_get_stats_overview_payload",
    "get_stats_overview",
]
