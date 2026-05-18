"""Seed-building queries for the shaped radio engine."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import optional_scope


def _seed_context_from_rows(rows) -> dict:
    artists: list[str] = []
    track_ids: list[int] = []
    seen_artists: set[str] = set()
    seen_track_ids: set[int] = set()
    for row in rows:
        artist = (row.get("artist") or "").strip()
        artist_key = artist.lower()
        if artist and artist_key not in seen_artists:
            seen_artists.add(artist_key)
            artists.append(artist)
        track_id = row.get("track_id")
        if track_id is None:
            track_id = row.get("id")
        if track_id is not None:
            track_id = int(track_id)
            if track_id not in seen_track_ids:
                seen_track_ids.add(track_id)
                track_ids.append(track_id)
    return {
        "seed_artists": artists[:24],
        "seed_genres": [],
        "seed_track_ids": track_ids[:80],
    }


def get_track_seed_context(
    track_ref: str, *, session=None
) -> tuple[list[float], str, dict] | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text(
                    """
                SELECT
                    id AS track_id,
                    bliss_vector,
                    title,
                    artist
                FROM library_tracks
                WHERE bliss_vector IS NOT NULL
                  AND (
                    CAST(id AS text) = :track_ref
                    OR (entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :track_ref)
                    OR (storage_id IS NOT NULL AND CAST(storage_id AS text) = :track_ref)
                    OR path = :track_ref
                  )
                ORDER BY
                  CASE
                    WHEN CAST(id AS text) = :track_ref THEN 0
                    WHEN entity_uid IS NOT NULL AND CAST(entity_uid AS text) = :track_ref THEN 1
                    WHEN storage_id IS NOT NULL AND CAST(storage_id AS text) = :track_ref THEN 2
                    WHEN path = :track_ref THEN 3
                    ELSE 4
                  END
                LIMIT 1
                """
                ),
                {"track_ref": track_ref},
            )
            .mappings()
            .first()
        )
    if not row:
        return None
    return (
        list(row["bliss_vector"]),
        f"{row['title']} — {row['artist']}",
        _seed_context_from_rows([row]),
    )


def get_track_seed(track_ref: str, *, session=None) -> tuple[list[float], str] | None:
    resolved = get_track_seed_context(track_ref, session=session)
    if not resolved:
        return None
    vector, label, _context = resolved
    return vector, label


def get_album_seed_context(
    album_ref: str, *, session=None
) -> tuple[list[list[float]], str, dict] | None:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    """
                SELECT
                    t.id AS track_id,
                    t.artist,
                    t.bliss_vector,
                    a.name AS album,
                    a.artist AS album_artist
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE t.bliss_vector IS NOT NULL
                  AND (
                    CAST(a.id AS text) = :album_ref
                    OR (a.entity_uid IS NOT NULL AND CAST(a.entity_uid AS text) = :album_ref)
                  )
                ORDER BY t.disc_number, t.track_number, t.id
                """
                ),
                {"album_ref": album_ref},
            )
            .mappings()
            .all()
        )

    vectors = [list(row["bliss_vector"]) for row in rows]
    if not vectors:
        return None

    first = rows[0]
    label = f"{first['album']} — {first['album_artist']}"
    context = _seed_context_from_rows(rows)
    album_artist = (first.get("album_artist") or "").strip()
    if album_artist:
        artists = context["seed_artists"]
        if album_artist.lower() not in {artist.lower() for artist in artists}:
            context["seed_artists"] = [album_artist, *artists]
    return vectors, label, context


def get_playlist_seed_context(
    playlist_id: int, limit: int = 30, *, session=None
) -> tuple[list[list[float]], str, dict] | None:
    with optional_scope(session) as s:
        playlist = (
            s.execute(
                text("SELECT name FROM playlists WHERE id = :playlist_id"),
                {"playlist_id": playlist_id},
            )
            .mappings()
            .first()
        )
        if not playlist:
            return None

        rows = (
            s.execute(
                text(
                    """
                SELECT lt.id AS track_id, lt.artist, lt.bliss_vector
                FROM (
                    SELECT
                        pt.*,
                        COALESCE(lt_id.id, lt_entity.id, lt_storage.id, lt_path.id) AS resolved_track_id
                    FROM playlist_tracks pt
                    LEFT JOIN library_tracks lt_id
                      ON lt_id.id = pt.track_id
                    LEFT JOIN library_tracks lt_entity
                      ON lt_id.id IS NULL
                     AND pt.track_entity_uid IS NOT NULL
                     AND lt_entity.entity_uid = pt.track_entity_uid
                    LEFT JOIN library_tracks lt_storage
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND pt.track_storage_id IS NOT NULL
                     AND lt_storage.storage_id = pt.track_storage_id
                    LEFT JOIN library_tracks lt_path
                      ON lt_id.id IS NULL
                     AND lt_entity.id IS NULL
                     AND lt_storage.id IS NULL
                     AND pt.track_path IS NOT NULL
                     AND lt_path.path = pt.track_path
                    WHERE pt.playlist_id = :playlist_id
                ) pt
                JOIN library_tracks lt
                  ON lt.id = pt.resolved_track_id
                 AND (lt.entity_uid IS NOT NULL OR lt.storage_id IS NOT NULL)
                WHERE lt.bliss_vector IS NOT NULL
                ORDER BY pt.position
                LIMIT :limit
                """
                ),
                {"playlist_id": playlist_id, "limit": limit},
            )
            .mappings()
            .all()
        )

    vectors = [list(row["bliss_vector"]) for row in rows]
    if not vectors:
        return None
    return vectors, str(playlist["name"]), _seed_context_from_rows(rows)


def get_playlist_seed(
    playlist_id: int, limit: int = 30, *, session=None
) -> tuple[list[list[float]], str] | None:
    resolved = get_playlist_seed_context(playlist_id, limit, session=session)
    if not resolved:
        return None
    vectors, label, _context = resolved
    return vectors, label


def _get_track_seed_contexts_batch(
    track_refs: list[str], *, session=None
) -> list[dict]:
    """Resolve multiple track references to bliss vectors in one query."""
    if not track_refs:
        return []

    refs = [ref for ref in track_refs if ref]
    if not refs:
        return []

    with optional_scope(session) as s:
        rows = (
            s.execute(
                text(
                    """
                SELECT ranked.id AS track_id, ranked.bliss_vector, ranked.title, ranked.artist
                FROM (
                    SELECT
                        lt.id, lt.bliss_vector, lt.title, lt.artist,
                        refs.match_ref,
                        refs.ordinal,
                        ROW_NUMBER() OVER (
                            PARTITION BY refs.ordinal
                            ORDER BY
                                CASE
                                    WHEN CAST(lt.id AS text) = refs.match_ref THEN 0
                                    WHEN lt.entity_uid IS NOT NULL AND CAST(lt.entity_uid AS text) = refs.match_ref THEN 1
                                    WHEN lt.storage_id IS NOT NULL AND CAST(lt.storage_id AS text) = refs.match_ref THEN 2
                                    WHEN lt.path = refs.match_ref THEN 3
                                    ELSE 4
                                END
                        ) AS rn
                    FROM library_tracks lt
                    JOIN unnest(:track_refs) WITH ORDINALITY AS refs(match_ref, ordinal) ON (
                        CAST(lt.id AS text) = refs.match_ref
                        OR (lt.entity_uid IS NOT NULL AND CAST(lt.entity_uid AS text) = refs.match_ref)
                        OR (lt.storage_id IS NOT NULL AND CAST(lt.storage_id AS text) = refs.match_ref)
                        OR lt.path = refs.match_ref
                    )
                    WHERE lt.bliss_vector IS NOT NULL
                      AND refs.match_ref IS NOT NULL
                      AND refs.match_ref != ''
                ) ranked
                WHERE rn = 1
                ORDER BY ordinal
                """
                ),
                {"track_refs": refs},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_home_playlist_seed_context(
    user_id: int,
    playlist_id: str,
    limit: int = 30,
    *,
    session=None,
) -> tuple[list[list[float]], str, dict] | None:
    from crate.db.home import get_home_playlist

    playlist = get_home_playlist(user_id, playlist_id, limit=max(limit, 40))
    if not playlist:
        return None

    refs: list[str] = []
    for track in (playlist.get("tracks") or [])[: limit * 2]:
        track_ref = (
            str(track.get("track_id"))
            if track.get("track_id") is not None
            else str(
                track.get("track_entity_uid")
                or track.get("track_storage_id")
                or track.get("track_path")
                or ""
            )
        )
        if track_ref:
            refs.append(track_ref)

    resolved_rows = _get_track_seed_contexts_batch(refs, session=session)
    if not resolved_rows:
        return None

    vectors: list[list[float]] = []
    context_rows: list[dict] = []
    for row in resolved_rows[:limit]:
        vectors.append(list(row["bliss_vector"]))
        context_rows.append(
            {
                "track_id": row["track_id"],
                "artist": (row.get("artist") or "").strip(),
            }
        )

    if not vectors:
        return None
    return (
        vectors,
        str(playlist.get("name") or playlist_id),
        _seed_context_from_rows(context_rows),
    )


def get_home_playlist_seed(
    user_id: int, playlist_id: str, limit: int = 30, *, session=None
) -> tuple[list[list[float]], str] | None:
    resolved = get_home_playlist_seed_context(
        user_id, playlist_id, limit, session=session
    )
    if not resolved:
        return None
    vectors, label, _context = resolved
    return vectors, label


__all__ = [
    "get_album_seed_context",
    "get_home_playlist_seed_context",
    "get_home_playlist_seed",
    "get_playlist_seed_context",
    "get_playlist_seed",
    "get_track_seed_context",
    "get_track_seed",
]
