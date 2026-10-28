from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

_CARD_SQL = """
    WITH artist AS (
        SELECT id, slug, name, album_count, track_count, listeners
        FROM library_artists
        WHERE LOWER(name) = LOWER(:name)
        LIMIT 1
    ),
    genres AS (
        SELECT COALESCE(
            jsonb_agg(g.name ORDER BY top.weight DESC), '[]'::jsonb
        ) AS names
        FROM (
            SELECT ag.genre_id, ag.weight
            FROM artist_genres ag
            WHERE ag.artist_name = COALESCE((SELECT name FROM artist), :name)
            ORDER BY ag.weight DESC
            LIMIT :genre_limit
        ) top
        JOIN genres g ON g.id = top.genre_id
    ),
    linked AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'name', ranked.artist_name,
                    'score', ranked.score,
                    'artist_id', la.id,
                    'artist_slug', la.slug
                )
                ORDER BY ranked.score DESC
            ),
            '[]'::jsonb
        ) AS items
        FROM (
            SELECT artist_name, MAX(score) AS score
            FROM artist_similarities
            WHERE LOWER(similar_name) = LOWER(:name)
              AND LOWER(artist_name) <> LOWER(:name)
            GROUP BY artist_name
            ORDER BY MAX(score) DESC
            LIMIT :linked_limit
        ) ranked
        LEFT JOIN library_artists la ON la.name = ranked.artist_name
    )
    SELECT artist.id, artist.slug, artist.name, artist.album_count,
           artist.track_count, artist.listeners,
           genres.names AS genres, linked.items AS linked_by
    FROM genres
    CROSS JOIN linked
    LEFT JOIN artist ON TRUE
"""


def get_network_artist_card(
    name: str,
    *,
    genre_limit: int = 5,
    linked_limit: int = 8,
    session: Session | None = None,
) -> dict:
    def _impl(current: Session) -> dict:
        row = (
            current.execute(
                text(_CARD_SQL),
                {
                    "name": name,
                    "genre_limit": genre_limit,
                    "linked_limit": linked_limit,
                },
            )
            .mappings()
            .one()
        )
        in_library = row["id"] is not None
        return {
            "name": row["name"] if in_library else name,
            "in_library": in_library,
            "artist_id": row["id"],
            "artist_slug": row["slug"],
            "album_count": row["album_count"],
            "track_count": row["track_count"],
            "listeners": row["listeners"],
            "genres": list(row["genres"] or []),
            "linked_by": [
                {
                    "name": item["name"],
                    "score": float(item["score"]),
                    "artist_id": item.get("artist_id"),
                    "artist_slug": item.get("artist_slug"),
                }
                for item in (row["linked_by"] or [])
            ],
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_network_artist_card"]
