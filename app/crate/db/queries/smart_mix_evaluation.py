"""Read-only inputs for the offline Smart Mix evaluation harness (Smart Mix 3, SM0).

Only ``tools/smart-mix-eval`` calls this module; no request or task does. The
harness runs against a development database, so it first makes every pooled
connection read-only at the PostgreSQL level: any write fails instead of
relying on each query being a SELECT.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import event, text

from crate.db.engine import get_engine
from crate.db.tx import read_scope


@dataclass(frozen=True, slots=True)
class EvaluationSeed:
    track_entity_uid: str
    genre: str | None


_SEEDS_SQL = text(
    """
    WITH sample AS MATERIALIZED (
        SELECT track.id AS track_id,
               track.entity_uid,
               track.genre AS track_genre,
               track.artist AS track_artist,
               album.id AS album_id,
               album.genre AS album_genre,
               album.artist AS album_artist
        FROM track_mix_profiles profile
        JOIN library_tracks track ON track.id = profile.track_id
        JOIN library_albums album ON album.id = track.album_id
        WHERE profile.source_stale_at IS NULL
          AND profile.quality <> 'unavailable'
          AND profile.bpm IS NOT NULL
          AND album.quarantined_at IS NULL
          AND NULLIF(track.path, '') IS NOT NULL
        ORDER BY md5(track.entity_uid::text || :seed), track.entity_uid
        LIMIT :sample_size
    )
    SELECT sample.entity_uid::text AS track_entity_uid,
           COALESCE(
               NULLIF(BTRIM(sample.track_genre), ''),
               NULLIF(BTRIM(sample.album_genre), ''),
               album_tag.name,
               artist_tag.name
           ) AS genre
    FROM sample
    LEFT JOIN LATERAL (
        SELECT genre.name
        FROM album_genres link
        JOIN genres genre ON genre.id = link.genre_id
        WHERE link.album_id = sample.album_id
        ORDER BY link.weight DESC NULLS LAST, genre.name
        LIMIT 1
    ) album_tag ON TRUE
    LEFT JOIN LATERAL (
        SELECT genre.name
        FROM artist_genres link
        JOIN genres genre ON genre.id = link.genre_id
        WHERE link.artist_name IN (sample.track_artist, sample.album_artist)
        ORDER BY (link.artist_name = sample.track_artist) DESC,
                 link.weight DESC NULLS LAST,
                 genre.name
        LIMIT 1
    ) artist_tag ON TRUE
    ORDER BY md5(sample.entity_uid::text || :seed), sample.entity_uid
    """
)


def enforce_read_only_connections() -> None:
    """Make every connection of the shared engine read-only from now on.

    Pooled connections opened before the call are discarded, so the next
    checkout runs the listener. Calling it twice is harmless.
    """
    engine = get_engine()
    if not event.contains(engine, "connect", _make_connection_read_only):
        event.listen(engine, "connect", _make_connection_read_only)
    engine.dispose()


def session_is_read_only() -> bool:
    with read_scope() as session:
        value = session.execute(text("SHOW transaction_read_only")).scalar_one()
    return value == "on"


def sample_evaluation_seeds(*, sample_size: int, seed: str) -> list[EvaluationSeed]:
    """A deterministic pseudo-random sample of tracks with a usable mix profile.

    Eligibility matches the compatible-tracks seed (fresh profile, playable
    track, album not quarantined) plus a BPM. The genre falls back from the
    track tag to the album tag, the album's strongest genre and the artist's
    strongest genre. The same ``seed`` returns the same order.
    """
    with read_scope() as session:
        rows = (
            session.execute(
                _SEEDS_SQL,
                {"sample_size": max(0, int(sample_size)), "seed": seed},
            )
            .mappings()
            .all()
        )
    return [
        EvaluationSeed(
            track_entity_uid=str(row["track_entity_uid"]),
            genre=str(row["genre"]) if row["genre"] else None,
        )
        for row in rows
    ]


_POOL_STATES_SQL = text(
    """
    SELECT track.id AS track_id,
           track.entity_uid::text AS entity_uid,
           profile.analyzer_version,
           profile.quality,
           -- The analyzer writes [] when it finds no phrases. CASE: AND does not
           -- guarantee the order, and jsonb_array_length fails on anything but an
           -- array.
           CASE
               WHEN jsonb_typeof(profile.phrases) = 'array'
               THEN jsonb_array_length(profile.phrases) > 0
               ELSE false
           END AS has_phrases,
           profile.source_stale_at IS NOT NULL AS stale
    FROM library_tracks track
    LEFT JOIN track_mix_profiles profile ON profile.track_id = track.id
    WHERE track.id = ANY(CAST(:ids AS bigint[]))
    ORDER BY track.id
    """
)


def get_pool_profile_states(track_ids: list[int]) -> list[dict[str, Any]]:
    """Each track's profile state for building an evaluation pool, in one query.

    ``analyzer_version`` and ``quality`` are None without a profile; ``has_phrases``
    means at least one phrase. No title or path is read.
    """
    ids = sorted({int(track_id) for track_id in track_ids})
    if not ids:
        return []
    with read_scope() as session:
        rows = session.execute(_POOL_STATES_SQL, {"ids": ids}).mappings().all()
    return [
        {
            "track_id": int(row["track_id"]),
            "entity_uid": str(row["entity_uid"]),
            "analyzer_version": row["analyzer_version"],
            "quality": row["quality"],
            "has_phrases": bool(row["has_phrases"]),
            "stale": bool(row["stale"]),
        }
        for row in rows
    ]


def _make_connection_read_only(dbapi_connection: Any, _connection_record: Any) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    finally:
        cursor.close()
    dbapi_connection.commit()


__all__ = [
    "EvaluationSeed",
    "enforce_read_only_connections",
    "get_pool_profile_states",
    "sample_evaluation_seeds",
    "session_is_read_only",
]
