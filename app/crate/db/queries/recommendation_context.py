"""Batched musical context for recommendation endpoints."""

from __future__ import annotations

from math import isfinite
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.genre_taxonomy import resolve_genre_slug, split_genre_names

_CONTEXT_SQL = """
    WITH requested AS (
        SELECT * FROM unnest(
            CAST(:kinds AS text[]), CAST(:values AS text[]),
            CAST(:ids AS bigint[]), CAST(:uids AS uuid[])
        ) WITH ORDINALITY AS r(kind, value, local_id, entity_uid, ordinal)
    ), tracks AS MATERIALIZED (
        SELECT r.ordinal, t.id, t.album_id, t.artist, t.genre
        FROM requested r
        JOIN library_tracks t ON r.kind = 'track' AND (
            t.id = r.local_id OR t.entity_uid = r.entity_uid
        )
    ), albums AS MATERIALIZED (
        SELECT r.ordinal, a.id, a.artist
        FROM requested r
        JOIN library_albums a ON r.kind = 'album' AND (
            a.id = r.local_id OR a.entity_uid = r.entity_uid
        )
    ), scoped_albums AS (
        SELECT ordinal, album_id AS id FROM tracks WHERE album_id IS NOT NULL
        UNION
        SELECT ordinal, id FROM albums
    ), context_artists AS MATERIALIZED (
        SELECT ordinal, artist FROM tracks
        UNION
        SELECT ordinal, artist FROM albums
        UNION
        SELECT a.ordinal, t.artist FROM albums a
        JOIN library_tracks t ON t.album_id = a.id
        UNION
        SELECT r.ordinal, artist.name
        FROM requested r
        JOIN LATERAL (
            SELECT name FROM library_artists
            WHERE r.kind = 'artist' AND (
                id = r.local_id OR entity_uid = r.entity_uid
                OR slug = r.value OR lower(name) = lower(r.value)
            )
            ORDER BY CASE WHEN id = r.local_id THEN 0
                          WHEN entity_uid = r.entity_uid THEN 1
                          WHEN slug = r.value THEN 2 ELSE 3 END, id
            LIMIT 1
        ) artist ON TRUE
    ), signals AS (
        SELECT ordinal, artist, NULL::text AS raw_genre,
               NULL::text AS source, NULL::text AS provider, NULL::float AS weight
        FROM context_artists
        UNION ALL
        SELECT ordinal, NULL, genre, 'track_tag', 'file', 1.0 FROM tracks
        WHERE genre IS NOT NULL
        UNION ALL
        SELECT a.ordinal, NULL, g.name, 'album_genre', ag.source, ag.weight
        FROM scoped_albums a
        JOIN album_genres ag ON ag.album_id = a.id
        JOIN genres g ON g.id = ag.genre_id
        UNION ALL
        SELECT a.ordinal, a.artist, g.name, 'artist_genre', ag.source, ag.weight
        FROM context_artists a
        JOIN artist_genres ag ON lower(ag.artist_name) = lower(a.artist)
        JOIN genres g ON g.id = ag.genre_id
    )
    SELECT * FROM signals
    ORDER BY ordinal, source NULLS FIRST, lower(artist), artist,
             raw_genre, provider, weight DESC
"""


def _positive_id(value: str) -> int | None:
    try:
        number = int(value)
        return number if 0 < number <= 2**63 - 1 and str(number) == value else None
    except ValueError:
        return None


def _entity_uid(value: str) -> str | None:
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _add_signal(context: dict, row: dict) -> None:
    try:
        weight = float(row.get("weight") or 0.0)
    except (ValueError, TypeError):
        return
    if not isfinite(weight) or weight <= 0:
        return
    raw = str(row.get("raw_genre") or "")
    for name in split_genre_names(raw):
        slug = resolve_genre_slug(name)
        if not slug:
            continue
        signal = {
            "slug": slug,
            "weight": weight,
            "source": row["source"],
            "provider": row.get("provider"),
            "raw_genre": raw,
        }
        if row.get("artist"):
            signal["artist"] = row["artist"]
        if signal not in context["genre_signals"]:
            context["genre_signals"].append(signal)


def load_endpoint_contexts(
    endpoints: list[tuple[str, str]], *, session: Session | None = None
) -> list[dict]:
    """Resolve musical identities and genre evidence without presentation labels."""
    contexts = [
        {"artists": [], "genre_weights": {}, "genre_signals": []} for _ in endpoints
    ]
    if not endpoints:
        return contexts
    kinds = [kind for kind, _ in endpoints]
    values = [str(value) for _, value in endpoints]
    if any(kind in {"track", "album", "artist"} for kind in kinds):
        params = {
            "kinds": kinds,
            "values": values,
            "ids": [_positive_id(value) for value in values],
            "uids": [_entity_uid(value) for value in values],
        }

        def load(current):
            return current.execute(text(_CONTEXT_SQL), params).mappings().all()

        if session is not None:
            rows = load(session)
        else:
            with read_scope() as current:
                rows = load(current)
        for row in rows:
            context = contexts[row["ordinal"] - 1]
            artist = str(row.get("artist") or "").strip()
            if artist and artist.casefold() not in {
                name.casefold() for name in context["artists"]
            }:
                context["artists"].append(artist)
            if row.get("source"):
                _add_signal(context, dict(row))

    for (kind, value), context in zip(endpoints, contexts):
        if kind == "genre":
            _add_signal(
                context,
                {
                    "raw_genre": value,
                    "source": "endpoint_genre",
                    "provider": "explicit",
                    "weight": 1.0,
                },
            )
        for source in ("endpoint_genre", "track_tag", "album_genre", "artist_genre"):
            weights: dict[str, float] = {}
            for signal in context["genre_signals"]:
                if signal["source"] == source:
                    slug = signal["slug"]
                    weights[slug] = max(weights.get(slug, 0.0), signal["weight"])
            if weights:
                context["genre_weights"] = weights
                break
    return contexts


__all__ = ["load_endpoint_contexts"]
