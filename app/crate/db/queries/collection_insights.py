"""Worker-only collection-versus-listening report for a warmed UI snapshot.

The single statement materializes local identity resolution once. Python then
folds per-track aggregates into distinct sets and fractional genre shares; no
row-by-row database queries or filesystem assumptions are involved.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.collection_insights_sql import _REPORT_SQL
from crate.db.queries.sonic_insights import build_sonic_insights
from crate.db.tx import read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION

_WINDOWS = {"30d": 30, "90d": 90, "365d": 365}


def _number(value) -> float:
    number = float(value or 0)
    return number if math.isfinite(number) and number >= 0 else 0.0


def _active(track: dict, prefix: str) -> bool:
    return track[f"{prefix}_plays"] > 0 or track[f"{prefix}_minutes"] > 0


def _album(tracks: list[dict], *, affected: list[dict] | None = None) -> dict:
    first = tracks[0]
    listening = tracks if affected is None else affected
    last = max((t["last_day"] for t in tracks if t["last_day"]), default=None)
    return {
        "id": first["album_id"],
        "entity_uid": first["entity_uid"],
        "slug": first["slug"],
        "title": first["title"],
        "artist": first["artist"],
        "artist_slug": first["artist_slug"],
        "year": first["year"],
        "has_cover": bool(first["has_cover"]),
        "tracks": len(tracks),
        "played_tracks": sum(_active(t, "current") for t in listening),
        "minutes": sum(t["current_minutes"] for t in listening),
        "last_day": last,
    }


def _summary(tracks: list[dict], prefix: str) -> dict:
    active = [t for t in tracks if _active(t, prefix)]
    by_artist: dict[int, float] = defaultdict(float)
    for track in active:
        by_artist[track["artist_id"]] += track[f"{prefix}_minutes"]
    minutes = sum(by_artist.values())
    return {
        "plays": sum(t[f"{prefix}_plays"] for t in active),
        "minutes": minutes,
        "tracks": len(active),
        "albums": len({t["album_id"] for t in active}),
        "concentration_pct": min(
            100.0, sum(sorted(by_artist.values(), reverse=True)[:10]) / minutes * 100
        )
        if minutes
        else None,
    }


def _comparisons(
    tracks: list[dict], albums: dict[int, list[dict]], kind: str
) -> list[dict]:
    groups: dict[str, dict] = {}
    total_plays = sum(t["current_plays"] for t in tracks)
    previous_plays = sum(t["previous_plays"] for t in tracks)
    for t in tracks:
        if kind == "genre":
            categories = t["genres"] or [{"key": "unknown", "label": "Unknown"}]
        else:
            year = str(t["track_year"] or "").strip()
            decade = (
                int(year[:4]) // 10 * 10
                if re.match(r"^[12]\d{3}(?:$|[-/])", year)
                else None
            )
            categories = (
                [{"key": str(decade), "label": f"{decade}s"}]
                if decade
                else [{"key": "unknown", "label": "Unknown"}]
            )
        weight = 1 / len(categories)
        for category in categories:
            key = category["key"]
            if key not in groups:
                groups[key] = {
                    "key": key,
                    "label": category["label"],
                    "genre_slug": key if kind == "genre" and key != "unknown" else None,
                    "tracks": set(),
                    "albums": set(),
                    "played_tracks": set(),
                    "plays": 0.0,
                    "minutes": 0.0,
                    "effective_tracks": 0.0,
                    "previous_plays": 0.0,
                }
            g = groups[key]
            g["tracks"].add(t["id"])
            g["albums"].add(t["album_id"])
            if _active(t, "current"):
                g["played_tracks"].add(t["id"])
            g["plays"] += t["current_plays"] * weight
            g["minutes"] += t["current_minutes"] * weight
            g["effective_tracks"] += weight
            g["previous_plays"] += t["previous_plays"] * weight
    result = []
    ordered = sorted(groups.values(), key=lambda g: (-g["effective_tracks"], g["key"]))
    chosen = [g for g in ordered if g["key"] != "unknown"][:24]
    chosen += [g for g in ordered if g["key"] == "unknown"]
    for g in chosen:
        effective = g.pop("effective_tracks")
        prior = g.pop("previous_plays")
        sample_ids = sorted(
            g["albums"],
            key=lambda aid: (-sum(t["current_minutes"] for t in albums[aid]), aid),
        )[:3]
        g["examples"] = [_album(albums[aid]) for aid in sample_ids]
        for field in ("tracks", "albums", "played_tracks"):
            g[field] = len(g[field])
        g["catalogue_share"] = (
            min(100.0, effective / len(tracks) * 100) if tracks else 0.0
        )
        g["listening_share"] = (
            min(100.0, g["plays"] / total_plays * 100) if total_plays else 0.0
        )
        g["previous_listening_share"] = (
            min(100.0, prior / previous_plays * 100) if previous_plays else 0.0
        )
        result.append(g)
    return result


def _movers(tracks: list[dict], complete: bool) -> tuple[list[dict], list[dict]]:
    if not complete:
        return [], []
    artists: dict[int, dict] = {}
    for t in tracks:
        aid = t["artist_id"]
        if aid not in artists:
            artists[aid] = {
                "id": aid,
                "entity_uid": t["artist_uid"],
                "slug": t["artist_slug"],
                "name": t["artist"],
                "has_photo": bool(t["has_photo"]),
                "current_minutes": 0.0,
                "previous_minutes": 0.0,
            }
        artists[aid]["current_minutes"] += t["current_minutes"]
        artists[aid]["previous_minutes"] += t["previous_minutes"]
    for a in artists.values():
        a["delta_minutes"] = a["current_minutes"] - a["previous_minutes"]
    ordered = sorted(
        artists.values(), key=lambda a: (-abs(a["delta_minutes"]), a["id"])
    )
    return (
        [a for a in ordered if a["delta_minutes"] > 0][:6],
        [a for a in ordered if a["delta_minutes"] < 0][:6],
    )


def build_collection_insights(
    window: str = "30d", *, today: date | None = None, session: Session | None = None
) -> dict:
    """Build a bounded local inventory report, exclusively from a worker.

    Dates retain the instance projection's listener-local reported calendar.
    Current inventory is the denominator for both historical periods.
    """
    if window not in _WINDOWS:
        raise ValueError(f"Unsupported collection insights window: {window}")
    end = today or date.today()
    days = _WINDOWS[window]
    start = end - timedelta(days=days - 1)
    previous_end = start - timedelta(days=1)
    previous_start = start - timedelta(days=days)
    params = {
        "today": end,
        "start": start,
        "previous_start": previous_start,
        "previous_end": previous_end,
        "profile_version": PROFILE_SCHEMA_VERSION,
        "analyzer_version": ANALYZER_VERSION,
    }

    def _impl(current: Session) -> dict:
        tracks: list[dict] = []
        daily_rows: list[dict] = []
        raw: dict = {}
        for kind, payload in current.execute(text(_REPORT_SQL), params):
            if kind == "track":
                tracks.append(payload)
            elif kind == "daily":
                daily_rows.append(payload)
            else:
                raw = payload
        tracks.sort(key=lambda t: t["id"])
        for t in tracks:
            for field in (
                "current_plays",
                "current_minutes",
                "previous_plays",
                "previous_minutes",
            ):
                t[field] = _number(t[field])
        history = raw["history_start"]
        complete = bool(
            history and history <= previous_start.isoformat() and not raw["incomplete"]
        )
        albums: dict[int, list[dict]] = defaultdict(list)
        for t in tracks:
            albums[t["album_id"]].append(t)
        album_rows = [_album(group) for group in albums.values()]
        unheard = sorted(
            (a for a in album_rows if a["last_day"] is None), key=lambda a: a["id"]
        )
        cutoff = (end - timedelta(days=90)).isoformat()
        rediscover = sorted(
            (a for a in album_rows if a["last_day"] and a["last_day"] <= cutoff),
            key=lambda a: (a["last_day"], a["id"]),
        )
        improvements = []
        for key, flag in (("full", "full_current"), ("bliss", "has_bliss")):
            affected = [t for t in tracks if _active(t, "current") and not t[flag]]
            affected_albums: dict[int, list[dict]] = defaultdict(list)
            for t in affected:
                affected_albums[t["album_id"]].append(t)
            samples = [
                _album(albums[aid], affected=group)
                for aid, group in affected_albums.items()
            ]
            samples.sort(key=lambda a: (-a["minutes"], a["id"]))
            improvements.append(
                {
                    "key": key,
                    "tracks": len(affected),
                    "minutes": sum(t["current_minutes"] for t in affected),
                    "albums": samples[:6],
                }
            )
        daily = {d["day"]: _number(d["minutes"]) for d in daily_rows}
        timeline = [
            {
                "day": (start + timedelta(days=offset)).isoformat(),
                "minutes": daily.get((start + timedelta(days=offset)).isoformat(), 0.0),
                "previous_minutes": daily.get(
                    (previous_start + timedelta(days=offset)).isoformat(), 0.0
                ),
            }
            for offset in range(days)
        ]
        rising, falling = _movers(tracks, complete)
        return {
            "ready": True,
            "window": window,
            "period": {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "previous_start": previous_start.isoformat(),
                "previous_end": previous_end.isoformat(),
                "history_start": history,
                "history_complete": not bool(raw["incomplete"]),
                "calendar": "listener_local_days",
                "previous_complete": complete,
            },
            "catalogue": {"tracks": len(tracks), "albums": len(albums)},
            "current": _summary(tracks, "current"),
            "previous": _summary(tracks, "previous"),
            "excluded": {
                "plays": int(raw["excluded_plays"]),
                "minutes": _number(raw["excluded_minutes"]),
            },
            "timeline": timeline,
            "genres": _comparisons(tracks, albums, "genre"),
            "decades": _comparisons(tracks, albums, "decade"),
            "rising": rising,
            "falling": falling,
            "unheard": {"total": len(unheard), "items": unheard[:6]},
            "rediscover": {"total": len(rediscover), "items": rediscover[:6]},
            "improvements": improvements,
            "sonic": build_sonic_insights(tracks),
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["build_collection_insights"]
