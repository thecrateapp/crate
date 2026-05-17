"""Ticketmaster Discovery API client for upcoming artist events/shows.

Free tier: 5000 calls/day, 5 req/sec.
Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
"""

import os
import logging
import re
import threading
import time
import requests

from crate.db.cache_settings import get_setting
from crate.db.cache_store import get_cache, set_cache

log = logging.getLogger(__name__)

API_BASE = "https://app.ticketmaster.com/discovery/v2"
CACHE_TTL_SECONDS = 604800
MIN_REQUEST_INTERVAL_SECONDS = float(
    os.environ.get("CRATE_TICKETMASTER_MIN_REQUEST_INTERVAL_SECONDS", "0.25")
)
MAX_RETRIES = 2
TRIBUTE_MARKERS = (
    "tribute",
    "tributo",
    "homenaje",
    "celebrating",
    "celebration of",
    "experience",
    "performs",
    "plays",
    "the music of",
)
_REQUEST_LOCK = threading.Lock()
_LAST_REQUEST_AT = 0.0


def _api_key() -> str:
    return get_setting(
        "ticketmaster_api_key", os.environ.get("TICKETMASTER_API_KEY", "")
    )


def is_configured() -> bool:
    return bool(_api_key())


def _throttle_ticketmaster_request() -> None:
    global _LAST_REQUEST_AT
    if MIN_REQUEST_INTERVAL_SECONDS <= 0:
        return
    with _REQUEST_LOCK:
        now = time.monotonic()
        wait_seconds = MIN_REQUEST_INTERVAL_SECONDS - (now - _LAST_REQUEST_AT)
        if wait_seconds > 0:
            time.sleep(wait_seconds)
            now = time.monotonic()
        _LAST_REQUEST_AT = now


def _ticketmaster_get(path: str, params: dict) -> requests.Response | None:
    last_response: requests.Response | None = None
    for attempt in range(MAX_RETRIES + 1):
        _throttle_ticketmaster_request()
        response = requests.get(f"{API_BASE}/{path}", params=params, timeout=10)
        last_response = response
        if response.status_code != 429:
            return response
        retry_after = (getattr(response, "headers", {}) or {}).get("Retry-After")
        try:
            wait_seconds = float(retry_after) if retry_after else 2.0 * (attempt + 1)
        except ValueError:
            wait_seconds = 2.0 * (attempt + 1)
        log.warning("Ticketmaster rate limited; retrying in %.1fs", wait_seconds)
        time.sleep(min(wait_seconds, 10.0))
    return last_response


def _normalize_artist_name(value: str) -> str:
    normalized = value.lower().replace("&", " and ")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def _is_tribute_candidate(value: str) -> bool:
    normalized = _normalize_artist_name(value)
    return any(marker in normalized for marker in TRIBUTE_MARKERS)


def _artist_names_match(candidate: str, target: str) -> bool:
    candidate_norm = _normalize_artist_name(candidate)
    target_norm = _normalize_artist_name(target)
    if not candidate_norm or not target_norm:
        return False
    if candidate_norm == target_norm:
        return True
    return candidate_norm.removeprefix("the ") == target_norm.removeprefix("the ")


def _matching_attractions(raw_attractions: list[dict], artist_name: str) -> list[dict]:
    matches: list[dict] = []
    for attraction in raw_attractions:
        name = str(attraction.get("name") or "")
        if _is_tribute_candidate(name):
            continue
        if _artist_names_match(name, artist_name):
            matches.append(attraction)
    return matches


def _search_attractions(artist_name: str) -> list[dict]:
    key = _api_key()
    if not key:
        return []

    cache_key = f"ticketmaster:attractions:v1:{_normalize_artist_name(artist_name)}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    try:
        resp = _ticketmaster_get(
            "attractions.json",
            params={
                "apikey": key,
                "keyword": artist_name,
                "classificationName": "music",
                "size": 20,
                "sort": "relevance,desc",
            },
        )
        if resp is None or resp.status_code != 200:
            return []
        raw_attractions = resp.json().get("_embedded", {}).get("attractions", [])
        attractions = _matching_attractions(raw_attractions, artist_name)
        set_cache(cache_key, attractions, ttl=CACHE_TTL_SECONDS)
        return attractions
    except Exception:
        log.debug(
            "Ticketmaster attraction lookup failed for %s", artist_name, exc_info=True
        )
        return []


def _event_matches_artist(event: dict, artist_name: str) -> bool:
    attractions = event.get("_embedded", {}).get("attractions", [])
    return bool(_matching_attractions(attractions, artist_name))


def _location_cache_part(
    *, latitude: float | None, longitude: float | None, radius_km: int | None
) -> str:
    if latitude is None or longitude is None:
        return "global"
    return f"{latitude:.3f}:{longitude:.3f}:{radius_km or 0}"


def search_events(
    artist_name: str,
    country_code: str = "",
    size: int = 10,
    latitude: float | None = None,
    longitude: float | None = None,
    radius_km: int | None = None,
) -> list[dict]:
    """Search upcoming music events for an artist.

    Args:
        artist_name: Artist/attraction name to search for.
        country_code: ISO 2-letter country code to filter (e.g. 'ES', 'US', 'GB'). Empty = worldwide.
        size: Max results (1-200).
        latitude/longitude/radius_km: Optional local search filter.

    Returns list of normalized event dicts.
    """
    key = _api_key()
    if not key:
        return []

    requested_size = max(1, min(size, 200))
    normalized_country = country_code.strip().upper()
    cache_key = (
        "ticketmaster:events:v2:"
        f"{_normalize_artist_name(artist_name)}:{normalized_country}:"
        f"{requested_size}:{_location_cache_part(latitude=latitude, longitude=longitude, radius_km=radius_km)}"
    )
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    try:
        attractions = _search_attractions(artist_name)
        attraction_ids = [
            str(attraction.get("id") or "").strip()
            for attraction in attractions
            if attraction.get("id")
        ]
        params = {
            "apikey": key,
            "classificationName": "music",
            "size": requested_size,
            "sort": "date,asc",
        }
        if attraction_ids:
            params["attractionId"] = ",".join(attraction_ids[:10])
        else:
            params["keyword"] = artist_name
        if normalized_country:
            params["countryCode"] = normalized_country
        if latitude is not None and longitude is not None:
            params["latlong"] = f"{latitude:.6f},{longitude:.6f}"
            params["radius"] = str(max(1, radius_km or 60))
            params["unit"] = "km"

        resp = _ticketmaster_get("events.json", params=params)
        if resp is None or resp.status_code != 200:
            status_code = resp.status_code if resp is not None else 0
            log.debug("Ticketmaster %d for %s", status_code, artist_name)
            return []

        data = resp.json()
        raw_events = data.get("_embedded", {}).get("events", [])

        events = []
        seen_ids: set[str] = set()
        for e in raw_events:
            if not _event_matches_artist(e, artist_name):
                continue
            event_id = str(e.get("id") or "").strip()
            if event_id and event_id in seen_ids:
                continue
            if event_id:
                seen_ids.add(event_id)

            venue_data = (e.get("_embedded", {}).get("venues") or [{}])[0]
            dates = e.get("dates", {})
            start = dates.get("start", {})

            # Validate coordinates
            lat = venue_data.get("location", {}).get("latitude")
            lon = venue_data.get("location", {}).get("longitude")
            try:
                lat_f = float(lat) if lat else None
                lon_f = float(lon) if lon else None
                if lat_f is not None and (lat_f < -90 or lat_f > 90):
                    lat = lon = None
                if lon_f is not None and (lon_f < -180 or lon_f > 180):
                    lat = lon = None
            except (ValueError, TypeError):
                lat = lon = None

            event = {
                "id": e.get("id", ""),
                "name": e.get("name", ""),
                "date": start.get("localDate")
                or (start.get("dateTime", "")[:10] if start.get("dateTime") else ""),
                "local_date": start.get("localDate", ""),
                "local_time": start.get("localTime", ""),
                "venue": venue_data.get("name", ""),
                "address_line1": venue_data.get("address", {}).get("line1", ""),
                "city": venue_data.get("city", {}).get("name", ""),
                "region": venue_data.get("state", {}).get("name", ""),
                "postal_code": venue_data.get("postalCode", ""),
                "country": venue_data.get("country", {}).get("name", ""),
                "country_code": venue_data.get("country", {}).get("countryCode", ""),
                "latitude": lat,
                "longitude": lon,
                "url": e.get("url", ""),
                "image": _best_image(e.get("images", [])),
                "price_range": _price_range(e.get("priceRanges", [])),
                "status": dates.get("status", {}).get("code", ""),
                "lineup": [a.get("name", "") for a in attractions],
            }
            events.append(event)

        # Cache for 7 days (shows don't change often)
        set_cache(cache_key, events, ttl=CACHE_TTL_SECONDS)
        return events

    except Exception:
        log.debug("Ticketmaster failed for %s", artist_name, exc_info=True)
        return []


def get_next_show(artist_name: str, country_code: str = "") -> dict | None:
    """Get the next upcoming show. Returns None if no shows."""
    events = search_events(artist_name, country_code=country_code, size=1)
    return events[0] if events else None


def get_upcoming_shows(
    artist_name: str,
    country_code: str = "",
    limit: int = 10,
    latitude: float | None = None,
    longitude: float | None = None,
    radius_km: int | None = None,
) -> list[dict]:
    """Get upcoming shows, limited to N."""
    return search_events(
        artist_name,
        country_code=country_code,
        size=limit,
        latitude=latitude,
        longitude=longitude,
        radius_km=radius_km,
    )


def _best_image(images: list[dict]) -> str:
    """Pick the best image from Ticketmaster image array (prefer 16:9 ratio, larger)."""
    if not images:
        return ""
    # Prefer 16_9 ratio images
    for img in images:
        if img.get("ratio") == "16_9" and img.get("width", 0) >= 640:
            return img.get("url", "")
    # Fallback to largest
    images_sorted = sorted(images, key=lambda i: i.get("width", 0), reverse=True)
    return images_sorted[0].get("url", "") if images_sorted else ""


def _price_range(ranges: list[dict]) -> dict | None:
    """Extract price range from event."""
    if not ranges:
        return None
    r = ranges[0]
    return {
        "min": r.get("min"),
        "max": r.get("max"),
        "currency": r.get("currency", ""),
    }
