from __future__ import annotations

from contextlib import contextmanager, nullcontext
import random

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.queries.playable_media_filters import (
    playable_album_clause,
    playable_media_params,
    playable_track_clause,
)
from crate.db.queries.paths_shared import (
    _canonical_reference_params,
    array_distance_sql,
)
from crate.db.tx import optional_scope, read_scope
from crate.track_versions import track_song_identity
from crate.recommendation_policy import PATH_RECENCY_QUALITY_BAND, fresh_path_candidates


@contextmanager
def _path_hnsw_settings(current, *, limit: int, enabled: bool, restore: bool):
    if not enabled:
        yield
        return
    previous = (
        current.execute(
            text("""
                SELECT current_setting('hnsw.ef_search', true) AS ef_search,
                       current_setting('hnsw.iterative_scan', true) AS iterative_scan
            """)
        )
        .mappings()
        .one()
        if restore
        else None
    )
    sql_failed = False
    try:
        current.execute(text(f"SET LOCAL hnsw.ef_search = {min(1000, max(40, limit))}"))
        current.execute(text("SET LOCAL hnsw.iterative_scan = strict_order"))
        yield
    except DBAPIError:
        # The caller must roll back an aborted transaction; preserve its SQL error.
        sql_failed = True
        raise
    finally:
        if previous is not None and not sql_failed:
            current.execute(
                text("""
                    SELECT set_config('hnsw.ef_search', :ef_search, true),
                           set_config('hnsw.iterative_scan', :iterative_scan, true)
                """),
                dict(previous),
            )


def _normalize_track_row(row) -> dict | None:
    if not row:
        return None
    data = dict(row)
    entity_uid = str(data["entity_uid"]) if data.get("entity_uid") is not None else None
    data["entity_uid"] = entity_uid
    if data.get("bliss_vector"):
        data["bliss_vector"] = list(data["bliss_vector"])
    return data


def _eligible_anchor_row(
    rows,
    exclude_song_keys,
    *,
    recent_song_keys=None,
    previous_song_keys=None,
    previous_track_ids=None,
    selection_seed=None,
):
    eligible = [
        track
        for row in rows
        if (track := _normalize_track_row(row)) is not None
        and track_song_identity(track) not in (exclude_song_keys or set())
    ]
    if not eligible:
        return None
    scores = {track["id"]: float(track.get("distance") or 0.0) for track in eligible}
    preferred = min(eligible, key=lambda track: scores[track["id"]])
    pool = fresh_path_candidates(
        [(track, -scores[track["id"]]) for track in eligible],
        preferred=preferred,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    if selection_seed is not None:
        floor = min(scores[track["id"]] for track in pool) + PATH_RECENCY_QUALITY_BAND
        pool = [track for track in pool if scores[track["id"]] <= floor]
        fatigued = (recent_song_keys or set()) | (previous_song_keys or set())
        fresh = [
            track
            for track in pool
            if track_song_identity(track) not in fatigued
            and track["id"] not in (previous_track_ids or set())
        ]
        return random.Random(selection_seed).choice(
            sorted(fresh or pool, key=lambda track: track["id"])
        )
    return min(pool, key=lambda track: scores[track["id"]])


def find_anchor_track_row(
    endpoint_type: str,
    endpoint_value: str,
    target_vec: list[float],
    exclude: set[int],
    *,
    session=None,
    exclude_song_keys: set[tuple[str, str]] | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
) -> dict | None:
    policy: dict = {}
    if endpoint_type != "track":
        policy = {
            "recent_song_keys": recent_song_keys,
            "previous_song_keys": previous_song_keys,
            "previous_track_ids": previous_track_ids,
            "selection_seed": selection_seed,
        }
    broad_pool = (
        exclude_song_keys
        or recent_song_keys
        or previous_song_keys
        or previous_track_ids
        or selection_seed is not None
    )
    probe_vector = to_pgvector_literal(target_vec)
    probe_array = list(target_vec)
    exclude_clause = "AND t.id != ALL(:exclude)" if exclude else ""
    params: dict = {
        "probe_vector": probe_vector,
        "probe_array": probe_array,
        "anchor_limit": 240 if broad_pool and endpoint_type != "track" else 1,
    }
    if exclude:
        params["exclude"] = list(exclude)

    with (
        nullcontext(session) if session is not None else read_scope() as current,
        _path_hnsw_settings(
            current,
            limit=params["anchor_limit"],
            enabled=endpoint_type != "track",
            restore=session is not None,
        ),
    ):
        if endpoint_type == "track":
            row = _eligible_anchor_row(
                current.execute(
                    text(
                        f"""
                    SELECT t.id, t.entity_uid, t.title, t.artist, a.artist AS album_artist, a.name AS album,
                           t.album_id, a.entity_uid::text AS album_entity_uid,
                           ar.entity_uid::text AS artist_entity_uid,
                           t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
                           t.bpm, t.audio_key, t.audio_scale, t.energy,
                           t.danceability, t.valence,
                           t.bliss_vector, 0.0 AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    LEFT JOIN library_artists ar ON ar.name = t.artist
                    WHERE t.bliss_vector IS NOT NULL
                      AND (
                        t.id = CAST(:reference_id AS bigint)
                        OR t.entity_uid = CAST(:reference_uid AS uuid)
                      )
                      AND {playable_track_clause("t", "a")}
                      {exclude_clause}
                    ORDER BY
                      CASE
                        WHEN t.id = CAST(:reference_id AS bigint) THEN 0
                        ELSE 1
                      END
                    LIMIT :anchor_limit
                    """
                    ),
                    {
                        **params,
                        **_canonical_reference_params(endpoint_value),
                        **playable_media_params(),
                    },
                )
                .mappings()
                .all(),
                exclude_song_keys,
                **policy,
            )
            return row

        if endpoint_type == "artist":
            scope_clause = """AND (
                SELECT name
                FROM library_artists
                WHERE CAST(id AS text) = :scope_ref
                   OR (entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :scope_ref)
                ORDER BY
                  CASE
                    WHEN CAST(id AS text) = :scope_ref THEN 0
                    ELSE 1
                  END
                LIMIT 1
            ) IN (a.artist, t.artist)"""
            params["scope_ref"] = endpoint_value
        elif endpoint_type == "album":
            scope_clause = """AND (
                CAST(t.album_id AS text) = :scope_ref
                OR (a.entity_uid IS NOT NULL AND CAST(a.entity_uid AS text) = :scope_ref)
            )"""
            params["scope_ref"] = endpoint_value
        elif endpoint_type == "genre":
            scope_clause = """AND EXISTS (
                SELECT 1 FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE g.slug = :scope_slug
                  AND ag.artist_name IN (a.artist, t.artist)
            )"""
            params["scope_slug"] = endpoint_value
        else:
            scope_clause = ""

        row = _eligible_anchor_row(
            current.execute(
                text(
                    f"""
                SELECT t.id, t.entity_uid, t.title, t.artist, a.artist AS album_artist, a.name AS album,
                       t.album_id, a.entity_uid::text AS album_entity_uid,
                       ar.entity_uid::text AS artist_entity_uid,
                       t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
                       t.bpm, t.audio_key, t.audio_scale, t.energy,
                       t.danceability, t.valence,
                       t.bliss_vector,
                       (t.bliss_embedding <=> CAST(:probe_vector AS vector(20))) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = t.artist
                WHERE t.bliss_embedding IS NOT NULL
                AND {playable_track_clause("t", "a")}
                {scope_clause}
                {exclude_clause}
                ORDER BY t.bliss_embedding <=> CAST(:probe_vector AS vector(20))
                LIMIT :anchor_limit
                """
                ),
                {**params, **playable_media_params()},
            )
            .mappings()
            .all(),
            exclude_song_keys,
            **policy,
        )

        if not row:
            fallback_distance = array_distance_sql("t.bliss_vector")
            row = _eligible_anchor_row(
                current.execute(
                    text(
                        f"""
                    SELECT t.id, t.entity_uid, t.title, t.artist, a.artist AS album_artist, a.name AS album,
                           t.album_id, a.entity_uid::text AS album_entity_uid,
                           ar.entity_uid::text AS artist_entity_uid,
                           t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
                           t.bpm, t.audio_key, t.audio_scale, t.energy,
                           t.danceability, t.valence,
                           t.bliss_vector,
                           {fallback_distance} AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    LEFT JOIN library_artists ar ON ar.name = t.artist
                    WHERE t.bliss_vector IS NOT NULL
                    AND {playable_track_clause("t", "a")}
                    {scope_clause}
                    {exclude_clause}
                    ORDER BY {fallback_distance}
                    LIMIT :anchor_limit
                    """
                    ),
                    {**params, **playable_media_params()},
                )
                .mappings()
                .all(),
                exclude_song_keys,
                **policy,
            )

    return row


def find_candidate_rows(
    target: list[float],
    exclude_ids: set[int],
    *,
    limit: int,
    session=None,
    use_track_artist: bool = False,
) -> list[dict]:
    artist_column = "t.artist" if use_track_artist else "a.artist"
    album_artist_column = "a.artist AS album_artist," if use_track_artist else ""
    probe_vector = to_pgvector_literal(target)
    probe_array = list(target)

    exclude_clause = ""
    params: dict = {"probe_vector": probe_vector, "probe_array": probe_array}
    if exclude_ids:
        exclude_clause = "AND t.id != ALL(:exclude)"
        params["exclude"] = list(exclude_ids)

    with (
        nullcontext(session) if session is not None else read_scope() as s,
        _path_hnsw_settings(
            s, limit=int(limit), enabled=use_track_artist, restore=session is not None
        ),
    ):
        s.execute(text("SET LOCAL ivfflat.probes = 10"))
        rows = (
            s.execute(
                text(
                    f"""
                SELECT t.id, t.entity_uid, t.title, {artist_column} AS artist,
                       {album_artist_column}
                       a.name AS album, t.album_id, a.entity_uid::text AS album_entity_uid,
                       ar.entity_uid::text AS artist_entity_uid,
                       t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
                       t.bpm, t.audio_key, t.audio_scale, t.energy,
                       t.danceability, t.valence,
                       t.bliss_vector,
                       (t.bliss_embedding <=> CAST(:probe_vector AS vector(20))) AS distance
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                LEFT JOIN library_artists ar ON ar.name = {artist_column}
                WHERE t.bliss_embedding IS NOT NULL
                AND {playable_track_clause("t", "a")}
                {exclude_clause}
                ORDER BY t.bliss_embedding <=> CAST(:probe_vector AS vector(20))
                LIMIT {int(limit)}
                """
                ),
                {**params, **playable_media_params()},
            )
            .mappings()
            .all()
        )

        if not rows:
            fallback_distance = array_distance_sql("t.bliss_vector")
            rows = (
                s.execute(
                    text(
                        f"""
                    SELECT t.id, t.entity_uid, t.title, {artist_column} AS artist,
                       {album_artist_column}
                           a.name AS album, t.album_id, a.entity_uid::text AS album_entity_uid,
                           ar.entity_uid::text AS artist_entity_uid,
                           t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
                           t.bpm, t.audio_key, t.audio_scale, t.energy,
                           t.danceability, t.valence,
                           t.bliss_vector,
                           {fallback_distance} AS distance
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    LEFT JOIN library_artists ar ON ar.name = {artist_column}
                    WHERE t.bliss_vector IS NOT NULL
                    AND {playable_track_clause("t", "a")}
                    {exclude_clause}
                    ORDER BY {fallback_distance}
                    LIMIT {int(limit)}
                    """
                    ),
                    {**params, **playable_media_params()},
                )
                .mappings()
                .all()
            )

    normalized_rows: list[dict] = []
    for row in rows:
        normalized = _normalize_track_row(row)
        if normalized is not None:
            normalized_rows.append(normalized)
    return normalized_rows


def _optimized_seeded_radio_sql(exclude_clause: str) -> str:
    # OFFSET 0 keeps playback checks after popularity ordering and before each
    # artist cap. Only eligible picks need their paths, vectors and metadata.
    return f"""
WITH genre_artists AS (
    SELECT LOWER(ag.artist_name) AS artist_key
    FROM artist_genres ag
    JOIN genres g ON g.id = ag.genre_id
    WHERE LOWER(g.name) = ANY(:seed_genres)
       OR LOWER(g.slug) = ANY(:seed_genres)
    GROUP BY LOWER(ag.artist_name)
),
context_artists AS MATERIALIZED (
    SELECT ar.name, LOWER(ar.name) AS artist_key,
           CASE WHEN LOWER(ar.name) = ANY(:seed_artist_keys) THEN 0
                WHEN LOWER(ar.name) = ANY(:similar_artist_keys) THEN 1
                ELSE 2 END AS radio_source_rank
    FROM library_artists ar
    WHERE (LOWER(ar.name) = ANY(:seed_artist_keys)
           OR LOWER(ar.name) = ANY(:similar_artist_keys)
           OR LOWER(ar.name) IN (SELECT artist_key FROM genre_artists))
      AND NOT (LOWER(ar.name) = ANY(:excluded_artist_keys))
      AND LOWER(ar.name) <> '.crate-trash'
),
artist_albums AS MATERIALIZED (
    SELECT ca.artist_key, ca.radio_source_rank, array_agg(a.id) AS album_ids
    FROM context_artists ca
    CROSS JOIN LATERAL (
        SELECT a.id FROM library_albums a
        WHERE a.artist = ca.name
          AND {playable_album_clause("a")}
        OFFSET 0
    ) a
    GROUP BY ca.artist_key, ca.radio_source_rank
),
picked AS MATERIALIZED (
    SELECT picks.id, aa.radio_source_rank,
           ROW_NUMBER() OVER (PARTITION BY aa.artist_key ORDER BY picks.plays DESC, picks.rating DESC, picks.id) AS artist_pick
    FROM artist_albums aa
    CROSS JOIN LATERAL (
        SELECT ordered.id, ordered.plays, ordered.rating
        FROM (
            SELECT t.id,
                   COALESCE(t.lastfm_playcount,0) AS plays, COALESCE(t.rating,0) AS rating
            FROM library_tracks t
            WHERE t.album_id = ANY(aa.album_ids)
              AND t.bliss_vector IS NOT NULL
              {exclude_clause}
            ORDER BY COALESCE(t.lastfm_playcount,0) DESC, COALESCE(t.rating,0) DESC, t.id
            OFFSET 0
        ) ordered
        CROSS JOIN LATERAL (
            SELECT t.id FROM library_tracks t
            WHERE t.id = ordered.id
              AND {playable_track_clause("t", None)}
            OFFSET 0
        ) playable
        ORDER BY ordered.plays DESC, ordered.rating DESC, ordered.id
        LIMIT (CASE aa.radio_source_rank WHEN 0 THEN 4 WHEN 1 THEN 6 ELSE 2 END)
              * :artist_pick_multiplier
    ) picks
)
SELECT t.id, t.entity_uid, t.title, a.artist,
       a.name AS album, t.album_id, a.entity_uid::text AS album_entity_uid,
       ar.entity_uid::text AS artist_entity_uid,
       t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
       t.bpm, t.audio_key, t.audio_scale, t.energy,
       t.danceability, t.valence, t.bliss_vector,
       COALESCE(t.bliss_embedding <=> CAST(:probe_vector AS vector(20)), 1.0) AS distance,
       CASE p.radio_source_rank WHEN 0 THEN 'seed' WHEN 1 THEN 'similar' ELSE 'genre' END AS radio_source,
       p.radio_source_rank, p.artist_pick
FROM picked p
JOIN library_tracks t ON t.id = p.id
JOIN library_albums a ON a.id = t.album_id
LEFT JOIN library_artists ar ON ar.name = a.artist
ORDER BY p.radio_source_rank, p.artist_pick, distance, t.id
LIMIT :limit
    """


def find_seeded_radio_candidate_rows(
    target: list[float],
    exclude_ids: set[int],
    *,
    seed_artists: list[str] | None = None,
    similar_artist_keys: list[str] | None = None,
    seed_genres: list[str] | None = None,
    excluded_artist_keys: list[str] | None = None,
    limit: int,
    optimized: bool = False,
    artist_pick_multiplier: int = 1,
    session=None,
) -> list[dict]:
    """Fetch contextual candidates, with an opt-in plan and stable ID tie breaks."""
    seed_artist_keys = [
        artist.lower().strip() for artist in (seed_artists or []) if artist
    ]
    seed_artist_keys = list(dict.fromkeys(key for key in seed_artist_keys if key))
    similar_keys = [
        key.lower().strip()
        for key in (similar_artist_keys or [])
        if key and key.lower().strip() not in seed_artist_keys
    ]
    similar_keys = list(dict.fromkeys(key for key in similar_keys if key))
    genre_terms = [term.lower().strip() for term in (seed_genres or []) if term]
    excluded_keys = [key.lower().strip() for key in (excluded_artist_keys or []) if key]
    excluded_keys = list(dict.fromkeys(key for key in excluded_keys if key))
    if not seed_artist_keys and not similar_keys and not genre_terms:
        return []

    probe_vector = to_pgvector_literal(target)
    exclude_clause = ""
    params: dict = {
        "probe_vector": probe_vector,
        "seed_artist_keys": seed_artist_keys or ["__no_seed_artist__"],
        "similar_artist_keys": similar_keys or ["__no_similar_artist__"],
        "seed_genres": genre_terms or ["__no_seed_genre__"],
        "excluded_artist_keys": excluded_keys or ["__no_excluded_artist__"],
        "limit": int(limit),
    }
    if optimized:
        params["artist_pick_multiplier"] = min(4, max(1, int(artist_pick_multiplier)))
    if exclude_ids:
        exclude_clause = "AND t.id != ALL(:exclude)"
        params["exclude"] = list(exclude_ids)

    with optional_scope(session) as s:
        s.execute(
            text(
                "SET LOCAL jit = off" if optimized else "SET LOCAL ivfflat.probes = 10"
            )
        )
        rows = (
            s.execute(
                text(
                    _optimized_seeded_radio_sql(exclude_clause)
                    if optimized
                    else f"""
                WITH genre_artists AS (
                    SELECT LOWER(ag.artist_name) AS artist_key
                    FROM artist_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE LOWER(g.name) = ANY(:seed_genres)
                       OR LOWER(g.slug) = ANY(:seed_genres)
                    GROUP BY LOWER(ag.artist_name)
                ),
                ranked AS (
                    SELECT
                        t.id, t.entity_uid, t.title, a.artist,
                        a.name AS album, t.album_id,
                        a.entity_uid::text AS album_entity_uid,
                        ar.entity_uid::text AS artist_entity_uid,
                        t.duration, t.format, t.bitrate, t.sample_rate, t.bit_depth, t.year,
                        t.bpm, t.audio_key, t.audio_scale, t.energy,
                        t.danceability, t.valence,
                        t.bliss_vector,
                        COALESCE(
                            t.bliss_embedding <=> CAST(:probe_vector AS vector(20)),
                            1.0
                        ) AS distance,
                        CASE
                            WHEN LOWER(a.artist) = ANY(:seed_artist_keys) THEN 'seed'
                            WHEN LOWER(a.artist) = ANY(:similar_artist_keys) THEN 'similar'
                            ELSE 'genre'
                        END AS radio_source,
                        CASE
                            WHEN LOWER(a.artist) = ANY(:seed_artist_keys) THEN 0
                            WHEN LOWER(a.artist) = ANY(:similar_artist_keys) THEN 1
                            ELSE 2
                        END AS radio_source_rank,
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(a.artist)
                            ORDER BY
                                COALESCE(t.lastfm_playcount, 0) DESC,
                                COALESCE(t.rating, 0) DESC,
                                t.id
                        ) AS artist_pick
                    FROM library_tracks t
                    JOIN library_albums a ON a.id = t.album_id
                    LEFT JOIN library_artists ar ON ar.name = a.artist
                    WHERE t.bliss_vector IS NOT NULL
                      AND {playable_track_clause("t", "a")}
                      {exclude_clause}
                      AND (
                          LOWER(a.artist) = ANY(:seed_artist_keys)
                          OR LOWER(a.artist) = ANY(:similar_artist_keys)
                          OR LOWER(a.artist) IN (SELECT artist_key FROM genre_artists)
                      )
                      AND NOT (LOWER(a.artist) = ANY(:excluded_artist_keys))
                )
                SELECT *
                FROM ranked
                WHERE artist_pick <= CASE
                    WHEN radio_source = 'seed' THEN 4
                    WHEN radio_source = 'similar' THEN 6
                    ELSE 2
                END
                ORDER BY radio_source_rank, artist_pick, distance
                LIMIT :limit
                """
                ),
                {**params, **playable_media_params()},
            )
            .mappings()
            .all()
        )

    normalized_rows: list[dict] = []
    for row in rows:
        normalized = _normalize_track_row(row)
        if normalized is not None:
            normalized_rows.append(normalized)
    return normalized_rows


__all__ = [
    "find_anchor_track_row",
    "find_seeded_radio_candidate_rows",
    "find_candidate_rows",
]
