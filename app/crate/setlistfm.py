import os
import logging
import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timezone
from typing import Any, NotRequired, TypedDict

import requests
from requests import RequestException

from crate.db.cache_store import delete_cache, get_cache, set_cache

log = logging.getLogger(__name__)

SETLISTFM_BASE = "https://api.setlist.fm/rest/1.0"
_PROBABLE_TTL_SECONDS = 7 * 86400
_PROBABLE_CACHE_VERSION = 2
_ACTIVE_TOUR_WINDOW_DAYS = 120
_ACTIVE_TOUR_MAX_SHOWS = 12
_RECENCY_HALF_LIFE_DAYS = 21.0
_PENDING_TTL_SECONDS = 15 * 60
_NEGATIVE_TTL_SECONDS = 6 * 3600


class RawSetlist(TypedDict):
    date: str
    venue: str
    city: str
    tour: str
    songs: list[str]


class ProbableSetlistContext(TypedDict):
    model_version: int
    mode: str
    source_show_count: int
    source_date_from: str | None
    source_date_to: str | None
    tour_name: NotRequired[str]


class SetlistProviderUnavailable(RuntimeError):
    pass


class SetlistProviderRateLimited(SetlistProviderUnavailable):
    def __init__(self, retry_after_seconds: float = 60.0) -> None:
        super().__init__("Setlist.fm rate limit exceeded")
        self.retry_after_seconds = max(1.0, retry_after_seconds)


def _normalized_artist_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def _probable_cache_key(name: str) -> str:
    return (
        f"setlistfm:probable:v{_PROBABLE_CACHE_VERSION}:"
        f"{_normalized_artist_name(name).casefold()}"
    )


def _probable_status_key(name: str) -> str:
    return f"setlistfm:probable-status:{_normalized_artist_name(name).casefold()}"


def _as_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _song_title(song) -> str:
    if isinstance(song, dict):
        return str(song.get("name") or song.get("title") or "").strip()
    return str(song or "").strip()


def _normalize_cached_songs(value) -> list[dict] | None:
    if isinstance(value, dict) and "song" in value:
        songs = _as_list(value.get("song"))
    else:
        songs = _as_list(value)
    normalized: list[dict] = []
    for song in songs:
        if not isinstance(song, dict):
            title = _song_title(song)
            if title:
                normalized.append({"title": title, "frequency": 1.0, "play_count": 1})
            continue
        title = str(song.get("title") or song.get("name") or "").strip()
        if not title:
            continue
        normalized_song = {**song, "title": title}
        normalized_song.setdefault("frequency", 1.0)
        normalized_song.setdefault("play_count", 1)
        normalized.append(normalized_song)
    return normalized or None


def _api_key() -> str | None:
    env_key = os.environ.get("SETLISTFM_API_KEY")
    if env_key:
        return env_key
    try:
        from crate.db.cache_settings import get_setting

        return get_setting("setlistfm_api_key")
    except Exception:
        log.debug("Could not read Setlist.fm API key from settings", exc_info=True)
        return None


def is_configured() -> bool:
    """Return whether a Setlist.fm API key is available."""
    return bool(_api_key())


def is_shows_sync_enabled() -> bool:
    """Return whether the experimental future-shows sync is explicitly enabled."""
    return os.environ.get("SETLISTFM_SHOWS_SYNC_ENABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def shows_sync_max_artists() -> int:
    """Return the bounded number of artists queried by one shows sync."""
    try:
        configured = int(os.environ.get("SETLISTFM_SHOWS_SYNC_MAX_ARTISTS", "100"))
    except ValueError:
        configured = 100
    return max(0, min(configured, 1000))


def _api_get(endpoint: str, params: dict | None = None) -> dict | None:
    key = _api_key()
    if not key:
        log.debug("Setlist.fm API key is not configured")
        return None
    try:
        from crate.provider_rate_limits import wait_for_provider_slot

        wait_for_provider_slot("setlistfm", 1.0)
        resp = requests.get(
            f"{SETLISTFM_BASE}/{endpoint}",
            headers={"x-api-key": key, "Accept": "application/json"},
            params=params or {},
            timeout=10,
        )
        if resp.status_code == 429:
            retry_after = (getattr(resp, "headers", {}) or {}).get("Retry-After")
            try:
                retry_after_seconds = float(retry_after or 60)
            except (TypeError, ValueError):
                retry_after_seconds = 60.0
            raise SetlistProviderRateLimited(retry_after_seconds)
        if resp.status_code >= 500:
            raise SetlistProviderUnavailable(
                f"Setlist.fm returned HTTP {resp.status_code}"
            )
        if resp.status_code >= 400:
            log.warning(
                "Setlist.fm API call failed: endpoint=%s status=%s params=%s body=%s",
                endpoint,
                resp.status_code,
                params or {},
                resp.text[:300],
            )
            return None
        return resp.json()
    except (SetlistProviderRateLimited, SetlistProviderUnavailable):
        raise
    except RequestException as exc:
        log.warning(
            "Setlist.fm API request failed: endpoint=%s params=%s error=%s",
            endpoint,
            params or {},
            exc,
        )
        raise SetlistProviderUnavailable("Setlist.fm request failed") from exc
    except ValueError as exc:
        log.warning(
            "Setlist.fm API returned invalid JSON: endpoint=%s params=%s error=%s",
            endpoint,
            params or {},
            exc,
        )
        return None


def search_artist(name: str) -> str | None:
    data = _api_get("search/artists", {"artistName": name, "sort": "relevance"})
    if not data:
        return None
    artists = _as_list(data.get("artist"))
    if not artists:
        return None
    for a in artists:
        if not isinstance(a, dict):
            continue
        if a.get("name", "").lower() == name.lower():
            return a.get("mbid")
    first = artists[0]
    return first.get("mbid") if isinstance(first, dict) else None


def get_setlists(mbid: str, page: int = 1, per_page: int = 20) -> dict | None:
    return _api_get(f"artist/{mbid}/setlists", {"p": page})


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _parse_setlist_date(value: object) -> date | None:
    raw_date = _clean_text(value)
    if not raw_date:
        return None
    for date_format in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw_date, date_format).date()
        except ValueError:
            continue
    return None


def _normalized_tour_name(value: object) -> str:
    return re.sub(r"\s+", " ", _clean_text(value) or "").casefold()


def _unique_show_songs(show: RawSetlist) -> list[str]:
    songs: list[str] = []
    seen: set[str] = set()
    for raw_title in show.get("songs", []):
        title = _clean_text(raw_title)
        if title and title not in seen:
            songs.append(title)
            seen.add(title)
    return songs


def _coordinate(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        return None
    return coordinate if math.isfinite(coordinate) else None


def normalize_upcoming_show(
    event: Mapping[str, Any],
    *,
    fallback_artist_name: str | None = None,
    today: date | None = None,
) -> dict[str, Any] | None:
    """Normalize one Setlist.fm event that is dated today or in the future.

    Setlist.fm is primarily a setlist catalogue. The API does not provide the
    ticketing fields needed to represent an on-sale event, so those fields are
    deliberately kept empty in the normalized show.
    """
    event_id = _clean_text(event.get("id"))
    raw_date = _clean_text(event.get("eventDate"))
    if not event_id or not raw_date or not re.fullmatch(r"\d{2}-\d{2}-\d{4}", raw_date):
        return None

    try:
        event_date = datetime.strptime(raw_date, "%d-%m-%Y").date()
    except ValueError:
        return None
    reference_date = today or datetime.now(timezone.utc).date()
    if event_date < reference_date:
        return None

    artist = _mapping(event.get("artist"))
    artist_name = _clean_text(artist.get("name")) or _clean_text(fallback_artist_name)
    venue = _mapping(event.get("venue"))
    venue_name = _clean_text(venue.get("name"))
    if not artist_name or not venue_name:
        return None

    city = _mapping(venue.get("city"))
    country = _mapping(city.get("country"))
    coords = _mapping(city.get("coords"))

    return {
        "external_id": f"setlistfm:{event_id}",
        "artist_name": artist_name,
        "date": event_date.isoformat(),
        "local_time": None,
        "venue": venue_name,
        "address_line1": None,
        "city": _clean_text(city.get("name")),
        "region": _clean_text(city.get("state")) or _clean_text(city.get("stateCode")),
        "postal_code": None,
        "country": _clean_text(country.get("name")),
        "country_code": _clean_text(country.get("code")),
        "latitude": _coordinate(coords.get("lat")),
        "longitude": _coordinate(coords.get("long")),
        "url": _clean_text(event.get("url")),
        "image_url": None,
        "lineup": [artist_name],
        "price_range": None,
        "tickets_url": None,
        "status": "scheduled",
        "source": "setlistfm",
    }


def get_upcoming_shows(
    mbid: str,
    limit: int = 20,
    *,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Return future-dated events already present in Setlist.fm.

    There is no documented upcoming-events endpoint. This makes a bounded
    request to the artist setlists resource and keeps only future-dated rows.
    """
    normalized_mbid = _clean_text(mbid)
    requested_limit = max(0, min(int(limit), 100))
    if not normalized_mbid or requested_limit == 0:
        return []

    page_size = 20
    pages_needed = min(5, max(1, (requested_limit + page_size - 1) // page_size))
    events: dict[str, dict[str, Any]] = {}
    for page in range(1, pages_needed + 1):
        data = get_setlists(normalized_mbid, page=page, per_page=page_size)
        if not data:
            break
        raw_events = _as_list(data.get("setlist"))
        if not raw_events:
            break
        for raw_event in raw_events:
            if not isinstance(raw_event, Mapping):
                continue
            normalized = normalize_upcoming_show(raw_event, today=today)
            if normalized:
                events[normalized["external_id"]] = normalized
        if len(events) >= requested_limit or len(raw_events) < page_size:
            break

    return sorted(
        events.values(), key=lambda item: (item["date"], item["external_id"])
    )[:requested_limit]


def get_cached_probable_setlist(artist_name: str) -> list[dict] | None:
    cached = get_cache(
        _probable_cache_key(artist_name), max_age_seconds=_PROBABLE_TTL_SECONDS
    )
    if not cached:
        return None
    if isinstance(cached, dict):
        return _normalize_cached_songs(cached.get("songs"))
    return _normalize_cached_songs(cached)


def get_cached_probable_setlist_context(
    artist_name: str,
) -> ProbableSetlistContext | None:
    """Return metadata for the versioned probable-setlist cache entry."""
    cached = get_cache(
        _probable_cache_key(artist_name), max_age_seconds=_PROBABLE_TTL_SECONDS
    )
    if not isinstance(cached, Mapping):
        return None
    raw_context = cached.get("context")
    if not isinstance(raw_context, Mapping):
        return None
    model_version = raw_context.get("model_version")
    mode = _clean_text(raw_context.get("mode"))
    source_show_count = raw_context.get("source_show_count")
    source_date_from = raw_context.get("source_date_from")
    source_date_to = raw_context.get("source_date_to")
    if (
        not isinstance(model_version, int)
        or isinstance(model_version, bool)
        or model_version != _PROBABLE_CACHE_VERSION
        or not mode
        or not isinstance(source_show_count, int)
        or isinstance(source_show_count, bool)
        or source_show_count < 1
        or (source_date_from is not None and not isinstance(source_date_from, str))
        or (source_date_to is not None and not isinstance(source_date_to, str))
    ):
        return None
    context: ProbableSetlistContext = {
        "model_version": model_version,
        "mode": mode,
        "source_show_count": source_show_count,
        "source_date_from": source_date_from,
        "source_date_to": source_date_to,
    }
    tour_name = _clean_text(raw_context.get("tour_name"))
    if tour_name:
        context["tour_name"] = tour_name
    return context


def queue_probable_setlist_refresh(
    artist_name: str, *, force: bool = False
) -> str | None:
    task_ids = queue_probable_setlist_refreshes([artist_name], force=force)
    return task_ids[0] if task_ids else None


def queue_probable_setlist_refreshes(
    artist_names: list[str], *, force: bool = False
) -> list[str]:
    """Queue cache refreshes without performing provider I/O in the caller."""
    from crate.db.repositories.tasks import (
        create_task_dedup,
        find_active_task_by_type_params,
    )

    queued: list[str] = []
    seen: set[str] = set()
    for raw_name in artist_names:
        artist_name = _normalized_artist_name(raw_name)
        normalized = artist_name.casefold()
        if not artist_name or normalized in seen:
            continue
        seen.add(normalized)
        if not force:
            if get_cached_probable_setlist(artist_name):
                continue
            status = get_cache(
                _probable_status_key(artist_name),
                max_age_seconds=_NEGATIVE_TTL_SECONDS,
            )
            if isinstance(status, dict) and status.get("status") in {
                "pending",
                "missing",
            }:
                continue
        set_cache(
            _probable_status_key(artist_name),
            {"status": "pending"},
            ttl=_PENDING_TTL_SECONDS,
        )
        params: dict[str, Any] = {"artist_name": artist_name}
        if force:
            params["force"] = True
        task_id = create_task_dedup(
            "refresh_probable_setlist",
            params,
            dedup_key=normalized,
        )
        if not task_id:
            task_id = find_active_task_by_type_params(
                "refresh_probable_setlist",
                params,
                dedup_key=normalized,
            )
        if task_id:
            queued.append(task_id)
    return queued


def refresh_probable_setlist(artist_name: str, *, force: bool = False) -> dict:
    """Refresh one probable setlist from a worker-owned provider call."""
    normalized_name = _normalized_artist_name(artist_name)
    songs = get_probable_setlist(normalized_name, force=force)
    if songs:
        set_cache(
            _probable_status_key(normalized_name),
            {"status": "ready"},
            ttl=_PROBABLE_TTL_SECONDS,
        )
        delete_cache(f"enrichment:{normalized_name.casefold()}")
        return {
            "status": "ready",
            "artist_name": normalized_name,
            "songs": len(songs),
        }
    set_cache(
        _probable_status_key(normalized_name),
        {"status": "missing"},
        ttl=_NEGATIVE_TTL_SECONDS,
    )
    return {"status": "missing", "artist_name": normalized_name, "songs": 0}


def get_probable_setlist(
    artist_name: str, num_setlists: int = 30, *, force: bool = False
) -> list[dict] | None:
    if not force:
        cached = get_cached_probable_setlist(artist_name)
        if cached:
            return cached

    mbid = search_artist(artist_name)
    if not mbid:
        return None

    raw_setlists = _fetch_raw_setlists(mbid, num_setlists)
    if not raw_setlists:
        return None

    result, context = _predict_setlist_with_context(raw_setlists)

    if result and context:
        cache_ttl = (
            24 * 60 * 60 if context["mode"] == "active_tour" else _PROBABLE_TTL_SECONDS
        )
        set_cache(
            _probable_cache_key(artist_name),
            {
                "model_version": _PROBABLE_CACHE_VERSION,
                "context": context,
                "songs": result,
            },
            ttl=cache_ttl,
        )
    return result


def _fetch_raw_setlists(mbid: str, num_setlists: int) -> list[RawSetlist]:
    """Fetch raw setlist data from setlist.fm API."""
    setlists: list[RawSetlist] = []
    pages_needed = (num_setlists + 19) // 20

    for page in range(1, pages_needed + 1):
        data = get_setlists(mbid, page=page)
        if not data:
            break
        page_setlists = _as_list(data.get("setlist"))
        if not page_setlists:
            break
        for sl in page_setlists:
            if not isinstance(sl, Mapping):
                continue
            if len(setlists) >= num_setlists:
                break
            songs = []
            raw_sets = sl.get("sets")
            sets = _mapping(raw_sets)
            for s in _as_list(sets.get("set")):
                if not isinstance(s, Mapping):
                    continue
                for song in _as_list(s.get("song")):
                    title = _song_title(song)
                    if title:
                        songs.append(title)
            if songs:
                venue = _mapping(sl.get("venue"))
                city = _mapping(venue.get("city"))
                tour = _mapping(sl.get("tour"))
                setlists.append(
                    {
                        "date": _clean_text(sl.get("eventDate")) or "",
                        "venue": _clean_text(venue.get("name")) or "",
                        "city": _clean_text(city.get("name")) or "",
                        "tour": _clean_text(tour.get("name")) or "",
                        "songs": songs,
                    }
                )

    return setlists


def _select_prediction_setlists(
    setlists: Sequence[RawSetlist],
    *,
    today: date,
) -> tuple[list[RawSetlist], str, str, date | None]:
    ordered = sorted(
        setlists,
        key=lambda show: _parse_setlist_date(show.get("date")) or date.min,
        reverse=True,
    )
    dated = [
        (show, parsed_date)
        for show in ordered
        if (parsed_date := _parse_setlist_date(show.get("date"))) is not None
    ]
    if not dated:
        return ordered, "historical_weighted", "", None

    latest_date = dated[0][1]
    latest_tour = _clean_text(dated[0][0].get("tour")) or ""
    latest_age = max(0, (today - latest_date).days)
    recent = [
        show
        for show, parsed_date in dated
        if 0 <= (latest_date - parsed_date).days <= _ACTIVE_TOUR_WINDOW_DAYS
    ]

    if latest_age <= _ACTIVE_TOUR_WINDOW_DAYS and recent:
        if latest_tour:
            normalized_latest_tour = _normalized_tour_name(latest_tour)
            matching_tour = [
                show
                for show in recent
                if _normalized_tour_name(show.get("tour")) == normalized_latest_tour
            ]
            unlabeled = [
                show for show in recent if not _normalized_tour_name(show.get("tour"))
            ]
            if len(matching_tour) >= 2:
                return (
                    matching_tour[:_ACTIVE_TOUR_MAX_SHOWS],
                    "active_tour",
                    latest_tour,
                    latest_date,
                )
            if len(matching_tour) + len(unlabeled) >= 2:
                return (
                    (matching_tour + unlabeled)[:_ACTIVE_TOUR_MAX_SHOWS],
                    "active_tour",
                    latest_tour,
                    latest_date,
                )
            if matching_tour:
                return matching_tour, "recent_shows", latest_tour, latest_date
            if unlabeled:
                return unlabeled, "recent_shows", latest_tour, latest_date
        elif len(recent) >= 2:
            return (
                recent[:_ACTIVE_TOUR_MAX_SHOWS],
                "active_tour",
                "",
                latest_date,
            )
        else:
            return recent, "recent_shows", "", latest_date

    return ordered, "historical_weighted", latest_tour, latest_date


def _recency_weight(show_date: date | None, latest_date: date | None) -> float:
    if show_date is None or latest_date is None:
        return 1.0
    age_days = max(0, (latest_date - show_date).days)
    return 0.5 ** (age_days / _RECENCY_HALF_LIFE_DAYS)


def _predict_setlist_with_context(
    setlists: Sequence[RawSetlist],
    *,
    today: date | None = None,
) -> tuple[list[dict] | None, ProbableSetlistContext | None]:
    if not setlists:
        return None, None

    reference_date = today or datetime.now(timezone.utc).date()
    selected, mode, tour_name, latest_date = _select_prediction_setlists(
        setlists, today=reference_date
    )
    if not selected:
        return None, None

    global_counts: Counter[str] = Counter()
    weighted_counts: dict[str, float] = {}
    last_played: dict[str, str] = {}
    last_played_dates: dict[str, date | None] = {}
    position_songs: dict[int, dict[str, float]] = {}
    total_show_weight = 0.0

    for show in selected:
        songs = _unique_show_songs(show)
        show_date = _parse_setlist_date(show.get("date"))
        weight = _recency_weight(show_date, latest_date)
        total_show_weight += weight
        for title in songs:
            global_counts[title] += 1
            weighted_counts[title] = weighted_counts.get(title, 0.0) + weight
            previous_date = last_played_dates.get(title)
            if title not in last_played or (
                show_date is not None
                and (previous_date is None or show_date > previous_date)
            ):
                last_played[title] = _clean_text(show.get("date")) or ""
                last_played_dates[title] = show_date

        seen_positions: set[str] = set()
        for position, title in enumerate(songs):
            if title in seen_positions:
                continue
            seen_positions.add(title)
            position_scores = position_songs.setdefault(position, {})
            position_scores[title] = position_scores.get(title, 0.0) + weight

    if not global_counts:
        return None, None

    def song_frequency(title: str) -> float:
        return round(weighted_counts[title] / total_show_weight, 3)

    def add_song(title: str, *, position: int | None = None) -> dict:
        song = {
            "title": title,
            "frequency": song_frequency(title),
            "play_count": global_counts[title],
            "last_played": last_played.get(title, ""),
        }
        if position is not None:
            song["position"] = position + 1
        return song

    predicted: list[dict] = []
    used_songs: set[str] = set()
    for position in range(max(position_songs, default=-1) + 1):
        scores = position_songs.get(position)
        if scores is None:
            continue
        score_map = scores
        ranked_titles = sorted(
            score_map,
            key=lambda title: (
                -score_map[title],
                -weighted_counts[title],
                -global_counts[title],
            ),
        )
        for title in ranked_titles:
            if title not in used_songs:
                predicted.append(add_song(title, position=position))
                used_songs.add(title)
                break

    remaining_titles = sorted(
        global_counts,
        key=lambda title: (
            -weighted_counts[title],
            -global_counts[title],
            -(last_played_dates.get(title) or date.min).toordinal(),
        ),
    )
    for title in remaining_titles:
        if title not in used_songs and global_counts[title] >= 2:
            predicted.append(add_song(title))
            used_songs.add(title)

    source_dates = [
        parsed_date
        for show in selected
        if (parsed_date := _parse_setlist_date(show.get("date"))) is not None
    ]
    context: ProbableSetlistContext = {
        "model_version": _PROBABLE_CACHE_VERSION,
        "mode": mode,
        "source_show_count": len(selected),
        "source_date_from": min(source_dates).isoformat() if source_dates else None,
        "source_date_to": max(source_dates).isoformat() if source_dates else None,
    }
    if tour_name:
        context["tour_name"] = tour_name

    is_recent = latest_date is not None and (reference_date - latest_date).days <= 180
    for song in predicted:
        song["on_tour"] = is_recent
        if tour_name:
            song["tour_name"] = tour_name

    return (predicted or None), context


def _predict_setlist(
    setlists: Sequence[RawSetlist], *, today: date | None = None
) -> list[dict] | None:
    """Predict a setlist, prioritizing an active tour when recent data exists."""
    result, _context = _predict_setlist_with_context(setlists, today=today)
    return result
