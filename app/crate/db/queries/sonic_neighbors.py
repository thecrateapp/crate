"""One bounded cosine lookup and projected-listening join, never catalogue analytics."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.sonic_insights import sonic_track_reading
from crate.db.tx import read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION

_WINDOWS = {"30d": 30, "90d": 90, "365d": 365}

_NEIGHBORS_SQL = """
WITH seed AS MATERIALIZED (
    SELECT t.id, t.bliss_embedding AS embedding,
           COALESCE(t.bliss_embedding IS NOT NULL
             AND (t.bliss_embedding <#> t.bliss_embedding) < 0, false) AS available
    FROM library_tracks t
    JOIN library_albums a ON a.id=t.album_id AND a.quarantined_at IS NULL
    JOIN library_artists ar ON ar.name=a.artist
    WHERE t.id=:track_id
), nearest AS MATERIALIZED (
    SELECT t.id, t.bliss_embedding <=> (SELECT embedding FROM seed) AS distance
    FROM library_tracks t
    WHERE (SELECT available FROM seed) AND t.id <> :track_id
      AND t.bliss_embedding IS NOT NULL
      AND (t.bliss_embedding <#> t.bliss_embedding) < 0
      AND EXISTS (
        SELECT 1 FROM library_albums a JOIN library_artists ar ON ar.name=a.artist
        WHERE a.id=t.album_id AND a.quarantined_at IS NULL
      )
    ORDER BY t.bliss_embedding <=> (SELECT embedding FROM seed)
    LIMIT :limit
), eligible AS MATERIALIZED (
    SELECT t.id, t.entity_uid::text AS track_uid, t.path,
           COALESCE(NULLIF(t.title,''),t.filename) AS track_title,
           a.id AS album_id, a.entity_uid::text AS entity_uid,
           a.name AS title, a.slug, a.artist, a.year, ar.slug AS artist_slug,
           a.has_cover <> 0 AS has_cover,
           COALESCE(cardinality(t.bliss_vector),0)>0 AS has_bliss,
           t.acousticness,t.instrumentalness,t.valence,n.distance,
           COALESCE(p.quality IN ('full','partial')
             AND p.profile_version=:profile_version
             AND p.analyzer_version=:analyzer_version
             AND p.source_stale_at IS NULL,false) AS profile_current,
           p.bpm AS mix_bpm,p.bpm_confidence AS mix_bpm_confidence,
           p.global_energy AS mix_energy,p.integrated_lufs AS mix_integrated_lufs,
           p.measurement_version AS mix_measurement_version,
           p.true_peak_dbfs AS mix_true_peak_dbfs,p.key_camelot AS mix_key_camelot,
           p.key_confidence AS mix_key_confidence,
           p.tempo_stability AS mix_tempo_stability,p.quality AS mix_quality
    FROM nearest n JOIN library_tracks t ON t.id=n.id
    JOIN library_albums a ON a.id=t.album_id AND a.quarantined_at IS NULL
    JOIN library_artists ar ON ar.name=a.artist
    LEFT JOIN track_mix_profiles p ON p.track_id=t.id
    WHERE n.distance >= 0 AND n.distance < 'Infinity'::float8
), listening AS MATERIALIZED (
    SELECT e.id,
           SUM(GREATEST(d.play_count,0)) AS current_plays,
           SUM(CASE WHEN d.minutes_listened>=0 AND d.minutes_listened<'Infinity'::float8
               THEN d.minutes_listened ELSE 0 END) AS current_minutes
    FROM eligible e JOIN instance_track_daily d ON (
        (d.track_entity_uid IS NOT NULL AND d.track_entity_uid::text=e.track_uid)
        OR (d.track_entity_uid IS NULL AND d.track_id IS NOT NULL AND d.track_id=e.id)
        OR (d.track_entity_uid IS NULL AND d.track_id IS NULL
            AND d.global_track_uid IS NULL AND d.track_path=e.path)
    ) AND d.day BETWEEN :start AND :end
    GROUP BY e.id
)
SELECT seed.id AS seed_track_id, seed.available,e.*,
       COALESCE(l.current_plays,0) AS current_plays,
       COALESCE(l.current_minutes,0) AS current_minutes
FROM seed LEFT JOIN eligible e ON true LEFT JOIN listening l ON l.id=e.id
ORDER BY e.distance NULLS LAST,e.id
"""


def get_sonic_neighbors(
    track_id: int,
    *,
    window: str = "30d",
    limit: int = 6,
    today: date | None = None,
    session: Session | None = None,
) -> dict | None:
    """Read indexed local neighbors; absent eligible seed differs from unavailable Bliss."""
    if track_id < 1 or window not in _WINDOWS or not 1 <= limit <= 12:
        raise ValueError("Unsupported sonic neighbor request")
    end = today or date.today()
    params = {
        "track_id": track_id,
        "limit": limit,
        "end": end,
        "start": end - timedelta(days=_WINDOWS[window] - 1),
        "profile_version": PROFILE_SCHEMA_VERSION,
        "analyzer_version": ANALYZER_VERSION,
    }

    def _impl(current: Session) -> dict | None:
        rows = current.execute(text(_NEIGHBORS_SQL), params).mappings().all()
        if not rows:
            return None
        return {
            "seed_track_id": rows[0]["seed_track_id"],
            "available": bool(rows[0]["available"]),
            "items": [
                {"track": sonic_track_reading(dict(row)), "distance": row["distance"]}
                for row in rows
                if row["id"] is not None
            ],
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_sonic_neighbors"]
