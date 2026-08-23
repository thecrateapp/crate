from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, timezone
from typing import Any


def build_updates_feed(
    *,
    releases: Iterable[Mapping[str, Any]],
    shows: Iterable[Mapping[str, Any]],
    radar_items: Iterable[Mapping[str, Any]],
    followed_artists: Iterable[Mapping[str, Any]],
    bandcamp_connected: bool,
    limit: int = 30,
    offset: int = 0,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    candidates.extend(_release_item(row) for row in releases)
    candidates.extend(_show_item(row) for row in shows)
    candidates.extend(_artist_item(row) for row in followed_artists)
    if bandcamp_connected:
        candidates.extend(_bandcamp_item(row) for row in radar_items)

    deduped: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        key = candidate["dedupe_key"]
        previous = deduped.get(key)
        if previous is None:
            candidate["provenance"] = _merge_provenance(candidate)
            deduped[key] = candidate
            continue

        winner = (
            candidate
            if _item_priority(candidate) < _item_priority(previous)
            else previous
        )
        loser = previous if winner is candidate else candidate
        winner["provenance"] = _merge_provenance(winner, loser)
        deduped[key] = winner

    items = sorted(deduped.values(), key=_sort_key)
    start = max(0, offset)
    end = start + max(0, limit)
    return items[start:end]


def _release_item(row: Mapping[str, Any]) -> dict[str, Any]:
    artist = _text(row.get("artist_name") or row.get("artist"))
    title = _text(row.get("album_title") or row.get("title"))
    release_date = _iso(row.get("release_date"))
    published_at = _iso(
        row.get("detected_at") or row.get("published_at") or row.get("date")
    )
    date_value = release_date or _iso(row.get("date")) or published_at
    item = dict(row)
    item.update(
        {
            "type": "release",
            "source": _text(row.get("source")) or "new_releases",
            "canonical_url": _text(row.get("canonical_url") or row.get("source_url"))
            or None,
            "published_at": published_at,
            "event_date": None,
            "artist": artist or None,
            "title": title or None,
            "image_url": _text(row.get("image_url") or row.get("cover_url")) or None,
            "cover_url": _text(row.get("cover_url") or row.get("image_url")) or None,
            "date": date_value,
            "dedupe_key": _release_key(artist, title),
        }
    )
    return item


def _show_item(row: Mapping[str, Any]) -> dict[str, Any]:
    artist = _text(row.get("artist_name") or row.get("artist"))
    venue = _text(row.get("venue") or row.get("title"))
    city = _text(row.get("city"))
    event_date = _iso(row.get("event_date") or row.get("date"))
    item = dict(row)
    item.update(
        {
            "type": "show",
            "source": _text(row.get("source")) or "shows",
            "canonical_url": _text(row.get("canonical_url") or row.get("url")) or None,
            "published_at": _iso(row.get("published_at") or row.get("updated_at"))
            or event_date,
            "event_date": event_date,
            "artist": artist or None,
            "title": venue or None,
            "image_url": _text(row.get("image_url") or row.get("cover_url")) or None,
            "cover_url": _text(row.get("cover_url") or row.get("image_url")) or None,
            "date": event_date,
            "dedupe_key": _show_key(artist, event_date, venue, city),
        }
    )
    return item


def _artist_item(row: Mapping[str, Any]) -> dict[str, Any]:
    artist = _text(row.get("artist_name") or row.get("artist"))
    published_at = _iso(row.get("created_at") or row.get("followed_at"))
    item = dict(row)
    item.update(
        {
            "type": "artist",
            "source": "user_follows",
            "canonical_url": _text(row.get("canonical_url")) or None,
            "published_at": published_at,
            "event_date": None,
            "artist": artist or None,
            "title": artist or None,
            "image_url": _text(row.get("photo_url") or row.get("image_url")) or None,
            "cover_url": _text(row.get("photo_url") or row.get("image_url")) or None,
            "date": published_at,
            "dedupe_key": f"artist:{_normalize(artist)}",
        }
    )
    return item


def _bandcamp_item(row: Mapping[str, Any]) -> dict[str, Any]:
    artist = _text(row.get("artist_name") or row.get("artist"))
    title = _text(
        row.get("album_title") or row.get("track_title") or row.get("title") or artist
    )
    release_date = _iso(row.get("release_date"))
    published_at = _iso(row.get("updated_at") or row.get("published_at"))
    item_url = _text(row.get("item_url") or row.get("canonical_url")) or None
    item = dict(row)
    item.update(
        {
            "type": "bandcamp",
            "source": "bandcamp",
            "source_detail": _text(row.get("source")) or None,
            "canonical_url": item_url,
            "published_at": published_at,
            "event_date": None,
            "artist": artist or None,
            "title": title or None,
            "image_url": _text(row.get("cover_url") or row.get("image_url")) or None,
            "cover_url": _text(row.get("cover_url") or row.get("image_url")) or None,
            "date": release_date or published_at,
            "dedupe_key": _release_key(artist, title),
        }
    )
    return item


def _item_priority(item: Mapping[str, Any]) -> int:
    return {"release": 0, "show": 0, "artist": 1, "bandcamp": 2}.get(
        str(item.get("type")), 3
    )


def _merge_provenance(*items: Mapping[str, Any]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for item in items:
        existing = item.get("provenance")
        if isinstance(existing, list):
            for value in existing:
                if isinstance(value, Mapping):
                    record = _provenance_record(value)
                    if record and record not in records:
                        records.append(record)
        record = _provenance_record(item)
        if record and record not in records:
            records.append(record)
    return records


def _provenance_record(item: Mapping[str, Any]) -> dict[str, str]:
    source = _text(item.get("source"))
    if not source:
        return {}
    record = {"source": source}
    for field in ("source_detail", "canonical_url"):
        value = _text(item.get(field))
        if value:
            record[field] = value
    return record


def _sort_key(item: Mapping[str, Any]) -> tuple[float, str, str]:
    value = item.get("event_date") or item.get("date") or item.get("published_at")
    return (-_timestamp(value), str(item.get("type") or ""), str(item["dedupe_key"]))


def _timestamp(value: Any) -> float:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time())
    else:
        raw = _text(value)
        if not raw:
            return 0.0
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _release_key(artist: str, title: str) -> str:
    return f"release:{_normalize(artist)}:{_normalize(title)}"


def _show_key(artist: str, event_date: str | None, venue: str, city: str) -> str:
    return f"show:{_normalize(artist)}:{event_date or ''}:{_normalize(venue)}:{_normalize(city)}"


def _normalize(value: Any) -> str:
    return " ".join(_text(value).casefold().split())


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    text = _text(value)
    return text or None
