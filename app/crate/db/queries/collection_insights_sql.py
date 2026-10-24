"""Single-statement inputs for the worker-only collection report.

History is resolved before aggregation, so aliases of the same local file share
one identity. Genre membership is deduplicated before any listening attribution.
"""

_REPORT_SQL = """
WITH eligible AS MATERIALIZED (
    SELECT t.id, t.entity_uid::text AS track_uid, t.path, t.genre,
           COALESCE(NULLIF(t.year, ''), a.year) AS track_year,
           a.id AS album_id, a.entity_uid::text AS entity_uid, a.slug,
           a.name AS title, a.artist, a.year, a.has_cover <> 0 AS has_cover,
           ar.id AS artist_id, ar.entity_uid::text AS artist_uid,
           ar.slug AS artist_slug, ar.has_photo <> 0 AS has_photo,
           COALESCE(p.quality = 'full' AND p.profile_version = :profile_version
               AND p.analyzer_version = :analyzer_version
               AND p.source_stale_at IS NULL, false) AS full_current,
           COALESCE(cardinality(t.bliss_vector), 0) > 0 AS has_bliss
    FROM library_tracks t
    JOIN library_albums a ON a.id = t.album_id AND a.quarantined_at IS NULL
    JOIN library_artists ar ON ar.name = a.artist
    LEFT JOIN track_mix_profiles p ON p.track_id = t.id
), resolved AS MATERIALIZED (
    SELECT d.day, COALESCE(u.id, i.id, f.id) AS id,
           GREATEST(d.play_count, 0) AS plays,
           CASE WHEN d.minutes_listened >= 0
                 AND d.minutes_listened < 'Infinity'::float8
                THEN d.minutes_listened ELSE 0 END AS minutes
    FROM instance_track_daily d
    LEFT JOIN eligible u ON d.track_entity_uid IS NOT NULL
        AND u.track_uid = d.track_entity_uid::text
    LEFT JOIN eligible i ON d.track_entity_uid IS NULL
        AND d.track_id IS NOT NULL AND i.id = d.track_id
    LEFT JOIN eligible f ON d.track_entity_uid IS NULL AND d.track_id IS NULL
        AND d.global_track_uid IS NULL AND f.path = NULLIF(d.track_path, '')
    WHERE d.day <= :today
), listened AS (
    SELECT id,
           COALESCE(SUM(plays) FILTER (WHERE day >= :start), 0) AS current_plays,
           COALESCE(SUM(minutes) FILTER (WHERE day >= :start), 0) AS current_minutes,
           COALESCE(SUM(plays) FILTER (WHERE day BETWEEN :previous_start AND :previous_end), 0) AS previous_plays,
           COALESCE(SUM(minutes) FILTER (WHERE day BETWEEN :previous_start AND :previous_end), 0) AS previous_minutes,
           MAX(day) FILTER (WHERE plays > 0 OR minutes > 0) AS last_day
    FROM resolved WHERE id IS NOT NULL GROUP BY id
), canonical_raw AS MATERIALIZED (
    SELECT DISTINCT g.id, n.slug, n.name
    FROM genres g
    LEFT JOIN genre_taxonomy_raw_tag_classifications c ON c.genre_id = g.id
    LEFT JOIN genre_taxonomy_aliases a ON a.alias_slug = g.slug
    JOIN genre_taxonomy_nodes n ON n.id = a.genre_id OR (a.genre_id IS NULL AND n.slug = g.slug)
    WHERE COALESCE(c.classification, 'genre') NOT IN ('facet', 'ignore')
), label_map AS MATERIALIZED (
    SELECT LOWER(TRIM(g.name)) AS label, c.slug, c.name
    FROM canonical_raw c JOIN genres g ON g.id = c.id
    UNION
    SELECT g.slug, c.slug, c.name
    FROM canonical_raw c JOIN genres g ON g.id = c.id
    UNION
    SELECT LOWER(TRIM(label)), n.slug, n.name
    FROM genre_taxonomy_aliases a JOIN genre_taxonomy_nodes n ON n.id = a.genre_id
    CROSS JOIN LATERAL unnest(ARRAY[a.alias_name, a.alias_slug]) label
    WHERE NOT EXISTS (
        SELECT 1 FROM genres g
        JOIN genre_taxonomy_raw_tag_classifications c ON c.genre_id = g.id
        WHERE (g.slug = a.alias_slug OR LOWER(TRIM(g.name)) = LOWER(TRIM(label)))
          AND c.classification IN ('facet', 'ignore')
    )
    UNION
    SELECT LOWER(TRIM(label)), n.slug, n.name
    FROM genre_taxonomy_nodes n
    CROSS JOIN LATERAL unnest(ARRAY[n.name, n.slug]) label
    WHERE NOT EXISTS (
        SELECT 1 FROM genre_taxonomy_aliases a
        WHERE (a.alias_slug = n.slug OR LOWER(TRIM(a.alias_name)) = LOWER(TRIM(label)))
          AND a.genre_id <> n.id
    ) AND NOT EXISTS (
        SELECT 1 FROM genres g
        JOIN genre_taxonomy_raw_tag_classifications c ON c.genre_id = g.id
        WHERE (g.slug = n.slug OR LOWER(TRIM(g.name)) = LOWER(TRIM(label)))
          AND c.classification IN ('facet', 'ignore')
    )
), memberships AS (
    SELECT DISTINCT e.id, 1 AS priority, m.slug, m.name
    FROM eligible e
    CROSS JOIN LATERAL unnest(string_to_array(e.genre, ',')) AS part(label)
    JOIN label_map m ON m.label = LOWER(TRIM(part.label))
    UNION
    SELECT e.id, 2, c.slug, c.name FROM eligible e
    JOIN album_genres g ON g.album_id = e.album_id
    JOIN canonical_raw c ON c.id = g.genre_id
    UNION
    SELECT e.id, 3, c.slug, c.name FROM eligible e
    JOIN artist_genres g ON g.artist_name = e.artist
    JOIN canonical_raw c ON c.id = g.genre_id
), ranked_memberships AS (
    SELECT *, MIN(priority) OVER (PARTITION BY id) AS chosen FROM memberships
), track_genres AS (
    SELECT id, jsonb_agg(jsonb_build_object('key', slug, 'label', name) ORDER BY slug) AS genres
    FROM ranked_memberships WHERE priority = chosen GROUP BY id
), track_rows AS (
    SELECT e.*, COALESCE(g.genres, '[]'::jsonb) AS genres,
           COALESCE(l.current_plays, 0) AS current_plays,
           COALESCE(l.current_minutes, 0) AS current_minutes,
           COALESCE(l.previous_plays, 0) AS previous_plays,
           COALESCE(l.previous_minutes, 0) AS previous_minutes,
           l.last_day::text
    FROM eligible e LEFT JOIN listened l USING (id) LEFT JOIN track_genres g USING (id)
), daily AS (
    SELECT day::text, SUM(minutes) AS minutes FROM resolved
    WHERE id IS NOT NULL AND day >= :previous_start GROUP BY day
), history AS (
    SELECT MIN(day) AS first_day FROM resolved
), user_history AS (
    SELECT MIN(day) AS first_day FROM user_track_daily WHERE day <= :today
)
SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM track_rows t), '[]'::jsonb) AS tracks,
    COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM daily d), '[]'::jsonb) AS daily,
    LEAST(h.first_day, u.first_day)::text AS history_start,
    (u.first_day IS NOT NULL AND (h.first_day IS NULL OR u.first_day < h.first_day)) AS incomplete,
    COALESCE((SELECT SUM(plays) FROM resolved WHERE id IS NULL AND day >= :start), 0) AS excluded_plays,
    COALESCE((SELECT SUM(minutes) FROM resolved WHERE id IS NULL AND day >= :start), 0) AS excluded_minutes
FROM history h CROSS JOIN user_history u
"""

__all__: list[str] = []
