"""Stable human route claims and historical aliases for global entities."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import text


def _human_candidates(preferred: str, qualifier: str) -> Iterator[str]:
    yield preferred
    base = f"{preferred}-{qualifier}"
    yield base
    suffix = 2
    while True:
        yield f"{base}-{suffix}"
        suffix += 1


def _claim_artist_alias(session, slug: str, global_artist_uid: str) -> bool:
    owner = session.execute(
        text(
            """
            INSERT INTO global_catalog_artist_route_aliases (
                slug, global_artist_uid, is_canonical
            )
            VALUES (:slug, CAST(:uid AS uuid), false)
            ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
            RETURNING global_artist_uid::text
            """
        ),
        {"slug": slug, "uid": global_artist_uid},
    ).scalar_one()
    return str(owner) == global_artist_uid


def claim_artist_public_slug(
    session,
    global_artist_uid: str,
    preferred_slug: str,
) -> str:
    preferred = preferred_slug.strip().lower()
    if not preferred:
        raise ValueError("Artist public slug is required")
    current = session.execute(
        text(
            "SELECT public_slug FROM global_catalog_artists "
            "WHERE global_artist_uid = CAST(:uid AS uuid)"
        ),
        {"uid": global_artist_uid},
    ).scalar_one_or_none()
    if current:
        _claim_artist_alias(session, str(current), global_artist_uid)

    chosen = None
    for candidate in _human_candidates(preferred, "music"):
        if _claim_artist_alias(session, candidate, global_artist_uid):
            chosen = candidate
            break
    if chosen is None:  # pragma: no cover - iterator is intentionally unbounded
        raise RuntimeError("Could not claim an artist route")
    session.execute(
        text(
            "UPDATE global_catalog_artist_route_aliases SET is_canonical = false "
            "WHERE global_artist_uid = CAST(:uid AS uuid)"
        ),
        {"uid": global_artist_uid},
    )
    session.execute(
        text(
            "UPDATE global_catalog_artist_route_aliases SET is_canonical = true "
            "WHERE slug = :slug AND global_artist_uid = CAST(:uid AS uuid)"
        ),
        {"slug": chosen, "uid": global_artist_uid},
    )
    session.execute(
        text(
            "UPDATE global_catalog_artists SET public_slug = :slug "
            "WHERE global_artist_uid = CAST(:uid AS uuid)"
        ),
        {"slug": chosen, "uid": global_artist_uid},
    )
    return chosen


def _claim_album_alias(
    session,
    slug: str,
    global_album_uid: str,
    global_artist_uid: str,
) -> bool:
    owner = session.execute(
        text(
            """
            INSERT INTO global_catalog_album_route_aliases (
                global_artist_uid, slug, global_album_uid, is_canonical
            )
            VALUES (
                CAST(:artist_uid AS uuid), :slug, CAST(:album_uid AS uuid), false
            )
            ON CONFLICT (global_artist_uid, slug) DO UPDATE SET
                slug = EXCLUDED.slug
            RETURNING global_album_uid::text
            """
        ),
        {
            "slug": slug,
            "artist_uid": global_artist_uid,
            "album_uid": global_album_uid,
        },
    ).scalar_one()
    return str(owner) == global_album_uid


def claim_album_public_slug(
    session,
    global_album_uid: str,
    global_artist_uid: str,
    preferred_slug: str,
    *,
    year: str | None,
) -> str:
    preferred = preferred_slug.strip().lower()
    if not preferred:
        raise ValueError("Album public slug is required")
    current = session.execute(
        text(
            "SELECT public_slug FROM global_catalog_albums "
            "WHERE global_album_uid = CAST(:uid AS uuid)"
        ),
        {"uid": global_album_uid},
    ).scalar_one_or_none()
    if current:
        _claim_album_alias(
            session,
            str(current),
            global_album_uid,
            global_artist_uid,
        )
    qualifier = str(year or "release").strip().lower() or "release"
    chosen = None
    for candidate in _human_candidates(preferred, qualifier):
        if _claim_album_alias(
            session,
            candidate,
            global_album_uid,
            global_artist_uid,
        ):
            chosen = candidate
            break
    if chosen is None:  # pragma: no cover - iterator is intentionally unbounded
        raise RuntimeError("Could not claim an album route")
    session.execute(
        text(
            "UPDATE global_catalog_album_route_aliases SET is_canonical = false "
            "WHERE global_album_uid = CAST(:album_uid AS uuid)"
        ),
        {"album_uid": global_album_uid},
    )
    session.execute(
        text(
            """
            UPDATE global_catalog_album_route_aliases
            SET is_canonical = true
            WHERE global_artist_uid = CAST(:artist_uid AS uuid)
              AND slug = :slug
              AND global_album_uid = CAST(:album_uid AS uuid)
            """
        ),
        {
            "artist_uid": global_artist_uid,
            "album_uid": global_album_uid,
            "slug": chosen,
        },
    )
    session.execute(
        text(
            "UPDATE global_catalog_albums SET public_slug = :slug "
            "WHERE global_album_uid = CAST(:album_uid AS uuid)"
        ),
        {"slug": chosen, "album_uid": global_album_uid},
    )
    return chosen


__all__ = ["claim_album_public_slug", "claim_artist_public_slug"]
