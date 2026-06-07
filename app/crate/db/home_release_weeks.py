from __future__ import annotations

from datetime import date, datetime, timedelta


def _coerce_release_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def release_week_start(day: date) -> date:
    """Return the Friday that starts the release week containing day."""
    friday = 4
    return day - timedelta(days=(day.weekday() - friday) % 7)


def release_week_index(today: date, release_date: date) -> int:
    """Return 0 for the current release week, 1 for the previous week, etc."""
    return (release_week_start(today) - release_week_start(release_date)).days // 7


def release_week_label(index: int) -> str:
    if index == 0:
        return "This week"
    if index == 1:
        return "Last week"
    return f"{index} weeks ago"


def group_releases_by_release_week(
    releases: list[dict],
    *,
    today: date,
    max_lookback_weeks: int,
) -> list[list[dict]]:
    groups: list[list[dict]] = [[] for _ in range(max(max_lookback_weeks, 0))]
    seen_album_ids: set[int] = set()

    for release in releases:
        album_id = release.get("album_id")
        release_date = _coerce_release_date(release.get("release_date"))
        if not album_id or release_date is None:
            continue
        try:
            normalized_album_id = int(album_id)
        except (TypeError, ValueError):
            continue
        if normalized_album_id in seen_album_ids:
            continue

        index = release_week_index(today, release_date)
        if index < 0 or index >= max_lookback_weeks:
            continue

        seen_album_ids.add(normalized_album_id)
        groups[index].append(
            {
                **release,
                "album_id": normalized_album_id,
                "release_week": release_week_start(release_date).isoformat(),
                "release_week_index": index,
                "release_week_label": release_week_label(index),
                "source_release_date": release_date.isoformat(),
            }
        )

    for group in groups:
        group.sort(
            key=lambda item: (
                item.get("source_release_date") or "",
                item.get("detected_at") or "",
                item.get("album_title") or "",
            ),
            reverse=True,
        )
    return [group for group in groups if group]


def build_new_arrivals_album_ids(
    releases: list[dict],
    *,
    today: date,
    limit: int,
    max_lookback_weeks: int,
) -> list[int]:
    album_ids: list[int] = []
    for group in group_releases_by_release_week(
        releases, today=today, max_lookback_weeks=max_lookback_weeks
    ):
        for release in group:
            album_ids.append(release["album_id"])
            if len(album_ids) >= limit:
                return album_ids
    return album_ids


def build_new_arrivals_release_index(
    releases: list[dict],
    *,
    today: date,
    max_lookback_weeks: int,
) -> dict[int, dict]:
    index: dict[int, dict] = {}
    for group in group_releases_by_release_week(
        releases, today=today, max_lookback_weeks=max_lookback_weeks
    ):
        for release in group:
            index[release["album_id"]] = release
    return index


__all__ = [
    "build_new_arrivals_album_ids",
    "build_new_arrivals_release_index",
    "group_releases_by_release_week",
    "release_week_index",
    "release_week_label",
    "release_week_start",
]
