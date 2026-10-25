"""Flag top items whose first-ever play falls inside the stats period.

One batched lookup per dashboard build against ``user_entity_firsts`` (or
``instance_entity_firsts`` when ``user_id`` is ``None``), using the entity keys
``_rebuild_firsts`` writes: artist name, ``artist||album`` and the track key
``COALESCE(global_track_uid, track_entity_uid, track_id, track_path)``. Top
items do not carry their entity key, so every identifier the item exposes is
tried and the earliest matching first day wins.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import text

from crate.db.queries.user_stats_periods import StatsPeriod


def _track_keys(item: dict) -> list[str]:
    keys = []
    for field in ("global_track_uid", "track_entity_uid", "track_id", "track_path"):
        value = item.get(field)
        if value is not None and str(value) != "":
            keys.append(str(value))
    return keys


def _artist_keys(item: dict) -> list[str]:
    name = str(item.get("artist_name") or item.get("artist") or "").strip()
    return [name] if name else []


def _album_keys(item: dict) -> list[str]:
    artist = str(item.get("artist") or "")
    album = str(item.get("album") or "")
    return [f"{artist}||{album}"] if artist and album else []


def mark_new_items(
    session,
    user_id: int | None,
    period: StatsPeriod,
    *,
    tracks: list[dict],
    artists: list[dict],
    albums: list[dict],
) -> None:
    """Set ``is_new`` on every item in place; always False for all-time."""
    keyed = [
        (entity_type, item, key_fn(item))
        for entity_type, items, key_fn in (
            ("track", tracks, _track_keys),
            ("artist", artists, _artist_keys),
            ("album", albums, _album_keys),
        )
        for item in items
    ]
    for _entity_type, item, _keys in keyed:
        item["is_new"] = False
    if period.start is None:
        return
    keys_by_type: dict[str, set[str]] = {
        "track": set(),
        "artist": set(),
        "album": set(),
    }
    for entity_type, _item, keys in keyed:
        keys_by_type[entity_type].update(keys)
    if not any(keys_by_type.values()):
        return
    table, scope = (
        ("user_entity_firsts", "user_id = :user_id AND ")
        if user_id is not None
        else ("instance_entity_firsts", "")
    )
    params: dict[str, object] = {
        "tracks": sorted(keys_by_type["track"]),
        "artists": sorted(keys_by_type["artist"]),
        "albums": sorted(keys_by_type["album"]),
    }
    if user_id is not None:
        params["user_id"] = user_id
    rows = session.execute(
        text(
            f"""
            SELECT entity_type, entity_key, first_day
            FROM {table}
            WHERE {scope}(
                (entity_type = 'track' AND entity_key = ANY(:tracks))
                OR (entity_type = 'artist' AND entity_key = ANY(:artists))
                OR (entity_type = 'album' AND entity_key = ANY(:albums))
            )
            """
        ),
        params,
    ).all()
    first_day: dict[tuple[str, str], date] = {
        (row.entity_type, row.entity_key): row.first_day for row in rows
    }
    for entity_type, item, keys in keyed:
        days = [
            first_day[(entity_type, key)]
            for key in keys
            if (entity_type, key) in first_day
        ]
        if not days:
            continue
        first = min(days)
        item["is_new"] = first >= period.start and (
            period.end is None or first < period.end
        )


__all__ = ["mark_new_items"]
