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
    external_feed_items: Iterable[Mapping[str, Any]] = (),
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    candidates.extend(_release_item(row) for row in releases)
    candidates.extend(_show_item(row) for row in shows)
    candidates.extend(_artist_item(row) for row in followed_artists)
    if bandcamp_connected:
        candidates.extend(_bandcamp_item(row) for row in radar_items)
    candidates.extend(
        _external_feed_item(row)
        for row in external_feed_items
        if bandcamp_connected or _is_global_external_feed_item(row)
    )

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
        winner["feed_clusters"] = _merge_feed_clusters(winner, loser)
        deduped[key] = winner

    items = sorted(deduped.values(), key=_sort_key)
    start = max(0, offset)
    end = start + max(0, limit)
    return items[start:end]


def merge_editorial_releases_into_radar(
    *,
    radar_items: Iterable[Mapping[str, Any]],
    external_feed_items: Iterable[Mapping[str, Any]],
    followed_artists: Iterable[str],
    today: date,
) -> list[dict[str, Any]]:
    """Add reviewed editorial releases to Radar without duplicating local releases."""
    items = [dict(item) for item in radar_items]
    followed = {_normalize(name) for name in followed_artists if _normalize(name)}
    by_release_key = {
        _release_key(_text(item.get("artist")), _text(item.get("title"))): item
        for item in items
        if item.get("type") == "release"
    }

    for row in external_feed_items:
        if _normalize(row.get("artist_name")) not in followed:
            continue
        if _external_feed_classification(row) != "release":
            continue

        normalized = _external_feed_item(row)
        artist = _text(normalized.get("artist"))
        title = _text(normalized.get("title"))
        if not artist or not title:
            continue
        release_key = _release_key(artist, title)
        provenance = _provenance_record(normalized)
        existing = by_release_key.get(release_key)
        if existing is not None:
            _append_unique_provenance(existing, provenance)
            continue

        release_date = _iso(
            row.get("release_date")
            or row.get("event_date")
            or row.get("published_at")
            or row.get("discovered_at")
        )
        release = {
            "type": "release",
            "date": release_date or "",
            "artist": artist,
            "artist_id": row.get("artist_id"),
            "artist_slug": row.get("artist_slug"),
            "title": title,
            "subtitle": "Album",
            "cover_url": normalized.get("cover_url"),
            "status": "editorial",
            "source": normalized.get("source"),
            "source_url": normalized.get("canonical_url"),
            "external_feed_item_id": normalized.get("external_feed_item_id"),
            "is_upcoming": bool(release_date and release_date > today.isoformat()),
            "editorial_provenance": [provenance] if provenance else [],
        }
        for field in (
            "editorial_summary",
            "editorial_summary_key_points",
            "editorial_summary_model",
            "editorial_summary_prompt_version",
            "editorial_summary_generated_at",
        ):
            if field in normalized:
                release[field] = normalized[field]
        items.append(release)
        by_release_key[release_key] = release

    return items


def merge_editorial_shows_into_radar(
    *,
    radar_items: Iterable[Mapping[str, Any]],
    external_feed_items: Iterable[Mapping[str, Any]],
    followed_artists: Iterable[str],
    today: date,
) -> list[dict[str, Any]]:
    """Add current accepted show proposals to Radar without duplicating shows."""
    items = [dict(item) for item in radar_items]
    followed = {_normalize(name) for name in followed_artists if _normalize(name)}
    by_show_key = {
        _show_identity_key(
            _text(item.get("artist")),
            _iso(item.get("date")),
            _text(item.get("venue") or item.get("title")),
            _text(item.get("city")),
        ): item
        for item in items
        if item.get("type") == "show"
    }
    today_value = today.isoformat()

    for row in external_feed_items:
        artist = _text(row.get("artist_name"))
        if not artist or _normalize(artist) not in followed:
            continue
        normalized = _external_feed_item(row)
        provenance = _provenance_record(normalized)
        for candidate_index, candidate in enumerate(
            _accepted_external_show_candidates(row)
        ):
            event_date = _iso(candidate.get("event_date"))
            if not event_date or event_date < today_value:
                continue
            venue = _text(candidate.get("venue"))
            city = _text(candidate.get("city"))
            show_key = _show_identity_key(artist, event_date, venue, city)
            if not show_key:
                continue

            existing = by_show_key.get(show_key)
            if existing is not None:
                _append_unique_provenance(existing, provenance)
                continue

            country = _text(candidate.get("country"))
            subtitle = ", ".join(value for value in (city, country) if value)
            item_id = row.get("id") or _normalize(row.get("canonical_url"))
            show = {
                "type": "show",
                "id": None,
                "event_key": f"external-feed-show:{item_id}:{candidate_index}",
                "date": event_date,
                "event_date": event_date,
                "time": _text(candidate.get("local_time")) or None,
                "artist": artist,
                "artist_id": row.get("artist_id"),
                "artist_slug": row.get("artist_slug"),
                "title": venue,
                "subtitle": subtitle,
                "cover_url": normalized.get("cover_url"),
                "image_url": normalized.get("image_url"),
                "status": "editorial",
                "url": _text(
                    candidate.get("tickets_url")
                    or candidate.get("url")
                    or normalized.get("canonical_url")
                )
                or None,
                "tickets_url": _text(candidate.get("tickets_url")) or None,
                "venue": venue,
                "address_line1": _text(candidate.get("address_line1")) or None,
                "city": city,
                "region": _text(candidate.get("region")) or None,
                "postal_code": _text(candidate.get("postal_code")) or None,
                "country": country,
                "country_code": _text(candidate.get("country_code")) or None,
                "editorial_provenance": [provenance] if provenance else [],
                "external_feed_item_id": row.get("id"),
                "is_upcoming": True,
            }
            items.append(show)
            by_show_key[show_key] = show

    return items


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


def _external_feed_item(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = row.get("payload_json")
    payload = payload if isinstance(payload, Mapping) else {}
    source_kind = _normalize(row.get("source_kind"))
    artist = _text(row.get("artist_name"))
    if not artist and source_kind != "publisher_rss":
        artist = _text(row.get("author"))
    title = _text(row.get("title") or artist)
    item_kind = _normalize(row.get("item_kind"))
    published_at = _iso(
        row.get("published_at") or row.get("discovered_at") or row.get("updated_at")
    )
    canonical_url = _text(row.get("canonical_url") or row.get("source_url")) or None
    item_type = (
        "bandcamp"
        if source_kind == "bandcamp_rss" and item_kind == "release"
        else "news"
    )
    image_url = _text(row.get("image_url") or payload.get("image_url")) or None
    item = {
        "type": item_type,
        "source": _text(row.get("source_kind")) or "bandcamp_rss",
        "source_detail": (
            _text(row.get("display_name") or row.get("publisher_name"))
            if source_kind == "publisher_rss"
            else None
        ),
        "canonical_url": canonical_url,
        "published_at": published_at,
        "event_date": None,
        "artist": artist or None,
        "title": title or None,
        "image_url": image_url,
        "cover_url": image_url,
        "date": published_at,
        "excerpt": _text(row.get("excerpt")) or None,
        "author": _text(row.get("author")) or None,
        "dedupe_key": (
            _release_key(artist, title)
            if item_type == "bandcamp"
            else _news_key(artist, title, canonical_url)
        ),
    }
    external_feed_item_id = row.get("id")
    if isinstance(external_feed_item_id, int):
        item["external_feed_item_id"] = external_feed_item_id
    feed_clusters = _feed_clusters(row.get("feed_clusters"))
    if feed_clusters:
        item["feed_clusters"] = feed_clusters
    item.update(_editorial_summary(row))
    classification = _external_feed_classification(row)
    if classification:
        item["editorial_classification"] = classification
    return item


def _external_feed_classification(row: Mapping[str, Any]) -> str | None:
    result = row.get("accepted_classification_json")
    if isinstance(result, Mapping):
        classification = _text(result.get("classification"))
        if classification:
            return classification
    if (
        _normalize(row.get("source_kind")) == "bandcamp_rss"
        and _normalize(row.get("item_kind")) == "release"
    ):
        return "release"
    return None


def _accepted_external_show_candidates(
    row: Mapping[str, Any],
) -> list[Mapping[str, Any]]:
    proposal = row.get("accepted_show_json")
    if not isinstance(proposal, Mapping):
        return []
    candidates = proposal.get("shows")
    if not isinstance(candidates, list):
        return []
    return [candidate for candidate in candidates if isinstance(candidate, Mapping)]


def _append_unique_provenance(item: dict[str, Any], value: dict[str, str]) -> None:
    if not value:
        return
    records = item.setdefault("editorial_provenance", [])
    if isinstance(records, list) and value not in records:
        records.append(value)


def _is_global_external_feed_item(row: Mapping[str, Any]) -> bool:
    return _normalize(row.get("source_kind")) == "publisher_rss"


def _editorial_summary(row: Mapping[str, Any]) -> dict[str, Any]:
    result = row.get("accepted_enrichment_json")
    if not isinstance(result, Mapping):
        return {}

    summary = _text(result.get("summary"))
    if not summary:
        return {}

    key_points_value = result.get("key_points")
    key_points = (
        [_text(point) for point in key_points_value if _text(point)]
        if isinstance(key_points_value, list)
        else []
    )
    item: dict[str, Any] = {
        "editorial_summary": summary,
        "editorial_summary_key_points": key_points,
    }
    generated_at = _iso(result.get("generated_at"))
    model = _text(row.get("accepted_enrichment_model") or result.get("model"))
    prompt_version = _text(
        row.get("accepted_enrichment_prompt_version") or result.get("prompt_version")
    )
    if generated_at:
        item["editorial_summary_generated_at"] = generated_at
    if model:
        item["editorial_summary_model"] = model
    if prompt_version:
        item["editorial_summary_prompt_version"] = prompt_version
    return item


def _item_priority(item: Mapping[str, Any]) -> int:
    return {"release": 0, "show": 0, "artist": 1, "bandcamp": 2, "news": 2}.get(
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


def _merge_feed_clusters(*items: Mapping[str, Any]) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    for item in items:
        for cluster in _feed_clusters(item.get("feed_clusters")):
            cluster_id = cluster.get("cluster_id")
            if not cluster_id or any(
                existing.get("cluster_id") == cluster_id for existing in clusters
            ):
                continue
            clusters.append(cluster)
    return clusters


def _feed_clusters(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    clusters: list[dict[str, Any]] = []
    for raw_cluster in value:
        if not isinstance(raw_cluster, Mapping):
            continue
        cluster_id = _text(raw_cluster.get("cluster_id"))
        if not cluster_id:
            continue
        cluster: dict[str, Any] = {
            "cluster_id": cluster_id,
            "cluster_type": _text(raw_cluster.get("cluster_type")) or "other",
            "confidence": _bounded_confidence(raw_cluster.get("confidence")),
            "rationale": _text(raw_cluster.get("rationale")),
            "applied": bool(raw_cluster.get("applied")),
            "members": _feed_cluster_members(raw_cluster.get("members")),
        }
        enrichment_id = raw_cluster.get("enrichment_id")
        if isinstance(enrichment_id, int):
            cluster["enrichment_id"] = enrichment_id
        clusters.append(cluster)
    return clusters


def _feed_cluster_members(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    members: list[dict[str, Any]] = []
    for raw_member in value:
        if not isinstance(raw_member, Mapping):
            continue
        item_id = raw_member.get("id")
        if not isinstance(item_id, int):
            continue
        member: dict[str, Any] = {
            "id": item_id,
            "role": _text(raw_member.get("role")) or "related",
            "reason": _text(raw_member.get("reason")),
            "visible": bool(raw_member.get("visible")),
        }
        for field in ("title", "source", "canonical_url", "published_at"):
            value = _text(raw_member.get(field))
            if value:
                member[field] = value
        members.append(member)
    return members


def _bounded_confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


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


def _news_key(artist: str, title: str, canonical_url: str | None) -> str:
    return f"news:{_normalize(canonical_url or '')}:{_normalize(artist)}:{_normalize(title)}"


def _show_key(artist: str, event_date: str | None, venue: str, city: str) -> str:
    return f"show:{_normalize(artist)}:{event_date or ''}:{_normalize(venue)}:{_normalize(city)}"


def _show_identity_key(
    artist: str, event_date: str | None, venue: str, city: str
) -> str:
    if not _normalize(artist) or not event_date:
        return ""
    return _show_key(artist, event_date, venue, city)


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
