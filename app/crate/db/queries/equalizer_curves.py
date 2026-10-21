"""One bounded read for the EQ panel's available-curve inventory."""

from contextlib import nullcontext

from sqlalchemy import text

from crate.db.tx import read_scope


def get_track_eq_curve_context(
    track_id: int, *, user_id: int, session=None
) -> dict | None:
    manager = nullcontext(session) if session is not None else read_scope()
    with manager as current:
        row = (
            current.execute(
                text("""
            WITH context AS (
                SELECT t.id AS track_id, t.entity_uid::text AS track_entity_uid,
                    t.album_id, a.entity_uid::text AS album_entity_uid,
                    t.title, t.artist, t.album, t.energy, t.loudness,
                    t.dynamic_range, t.spectral_complexity, t.danceability,
                    t.valence, t.acousticness, t.instrumentalness
                FROM library_tracks t LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE t.id = :track_id
            ), presets AS (
                SELECT p.* FROM equalizer_presets p, context c WHERE
                    (p.scope = 'user' AND p.target_type = 'track'
                        AND p.target_entity_uid = CAST(c.track_entity_uid AS UUID)
                        AND p.user_id = :user_id)
                    OR (p.scope = 'instance' AND p.user_id IS NULL AND (
                        (p.target_type = 'track' AND p.target_entity_uid = CAST(c.track_entity_uid AS UUID))
                        OR (p.target_type = 'album' AND p.target_entity_uid = CAST(c.album_entity_uid AS UUID))))
            ), album_genres_for_track AS (
                SELECT g.name, g.slug, ag.weight FROM context c
                JOIN album_genres ag ON ag.album_id = c.album_id JOIN genres g ON g.id = ag.genre_id
                ORDER BY ag.weight DESC NULLS LAST, g.name LIMIT 10
            ), artist_genres_for_track AS (
                SELECT g.name, g.slug, MAX(ag.weight) AS weight FROM context c
                LEFT JOIN library_albums a ON a.id = c.album_id
                JOIN artist_genres ag ON ag.artist_name IN (c.artist, a.artist)
                JOIN genres g ON g.id = ag.genre_id GROUP BY g.name, g.slug
                ORDER BY MAX(ag.weight) DESC NULLS LAST, g.name LIMIT 10
            ) SELECT row_to_json(c) AS context,
                COALESCE((SELECT json_agg(p) FROM presets p), '[]'::json) AS presets,
                COALESCE((SELECT json_agg(g) FROM album_genres_for_track g), '[]'::json) AS album_genres,
                COALESCE((SELECT json_agg(g) FROM artist_genres_for_track g), '[]'::json) AS artist_genres
            FROM context c
        """),
                {"track_id": track_id, "user_id": user_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


__all__ = ["get_track_eq_curve_context"]
