"""Read-only Smart Mix coverage and checkpoint status."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


SMART_MIX_PROFILE_VERSION = 1
SMART_MIX_ANALYZER_VERSION = "smart-mix-v1"


def get_smart_mix_admin_status() -> dict:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    WITH eligible_tracks AS MATERIALIZED (
                        SELECT track.id
                        FROM library_tracks track
                        LEFT JOIN library_albums album ON album.id = track.album_id
                        WHERE album.quarantined_at IS NULL
                    ),
                    profile_counts AS (
                        SELECT
                            COUNT(*) FILTER (
                                WHERE profile.profile_version = :profile_version
                                  AND profile.analyzer_version = :analyzer_version
                                  AND profile.quality <> 'unavailable'
                            )::int AS current_profiles,
                            COUNT(*) FILTER (
                                WHERE profile.quality = 'full'
                            )::int AS full_profiles,
                            COUNT(*) FILTER (
                                WHERE profile.quality = 'partial'
                            )::int AS partial_profiles,
                            COUNT(*) FILTER (
                                WHERE profile.quality = 'legacy'
                            )::int AS legacy_profiles,
                            COUNT(*) FILTER (
                                WHERE profile.quality = 'unavailable'
                            )::int AS unavailable_profiles
                        FROM eligible_tracks eligible
                        LEFT JOIN track_mix_profiles profile
                            ON profile.track_id = eligible.id
                    ),
                    processing_counts AS (
                        SELECT
                            COUNT(*) FILTER (
                                WHERE processing.state = 'pending'
                            )::int AS pending,
                            COUNT(*) FILTER (
                                WHERE processing.state = 'analyzing'
                            )::int AS active,
                            COUNT(*) FILTER (
                                WHERE processing.state = 'failed'
                            )::int AS failed,
                            COUNT(*) FILTER (
                                WHERE processing.state = 'done'
                            )::int AS completed
                        FROM eligible_tracks eligible
                        LEFT JOIN track_processing_state processing
                            ON processing.track_id = eligible.id
                           AND processing.pipeline = 'smart_mix'
                    )
                    SELECT
                        (SELECT COUNT(*)::int FROM eligible_tracks) AS total_tracks,
                        profile_counts.*,
                        processing_counts.*
                    FROM profile_counts
                    CROSS JOIN processing_counts
                    """
                ),
                {
                    "profile_version": SMART_MIX_PROFILE_VERSION,
                    "analyzer_version": SMART_MIX_ANALYZER_VERSION,
                },
            )
            .mappings()
            .one()
        )

    total_tracks = int(row["total_tracks"] or 0)
    current_profiles = int(row["current_profiles"] or 0)
    coverage_percent = (
        round((current_profiles / total_tracks) * 100, 1) if total_tracks else 0.0
    )
    return {
        "profile_version": SMART_MIX_PROFILE_VERSION,
        "analyzer_version": SMART_MIX_ANALYZER_VERSION,
        "total_tracks": total_tracks,
        "current_profiles": current_profiles,
        "missing_profiles": max(total_tracks - current_profiles, 0),
        "coverage_percent": coverage_percent,
        "quality": {
            "full": int(row["full_profiles"] or 0),
            "partial": int(row["partial_profiles"] or 0),
            "legacy": int(row["legacy_profiles"] or 0),
            "unavailable": int(row["unavailable_profiles"] or 0),
        },
        "processing": {
            "pending": int(row["pending"] or 0),
            "active": int(row["active"] or 0),
            "failed": int(row["failed"] or 0),
            "completed": int(row["completed"] or 0),
        },
    }


__all__ = [
    "SMART_MIX_ANALYZER_VERSION",
    "SMART_MIX_PROFILE_VERSION",
    "get_smart_mix_admin_status",
]
