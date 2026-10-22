"""Geolocation — IP-based city detection and Nominatim geocoding.

IP detection uses ip-api.com (free, 45 req/min, no key).
Geocoding uses Nominatim/OpenStreetMap (free, 1 req/sec).
Both are cached in Redis to avoid repeated calls.
"""

from __future__ import annotations

import logging
import hashlib
import re
import threading
import time
import unicodedata
from contextlib import contextmanager

import requests

log = logging.getLogger(__name__)

_NOMINATIM_DELAY = 1.1  # seconds between Nominatim requests
_NOMINATIM_LAST_REQUEST = 0.0
_NOMINATIM_LOCAL_LOCK = threading.Lock()
_NOMINATIM_LOCK_KEY = "geolocation:nominatim:request-lock"
_NOMINATIM_LAST_REQUEST_KEY = "geolocation:nominatim:last-request"


@contextmanager
def _nominatim_request_slot():
    """Serialize Nominatim requests and keep at least one second between starts."""
    global _NOMINATIM_LAST_REQUEST

    from crate.db.cache_runtime import get_redis

    redis_client = get_redis()
    token = f"{time.time_ns()}:{threading.get_ident()}"
    acquired = False
    if redis_client:
        try:
            while not acquired:
                acquired = bool(
                    redis_client.set(_NOMINATIM_LOCK_KEY, token, nx=True, ex=30)
                )
                if not acquired:
                    time.sleep(0.1)
        except Exception:
            redis_client = None

    if redis_client and acquired:
        try:
            try:
                last_request = float(redis_client.get(_NOMINATIM_LAST_REQUEST_KEY) or 0)
            except (TypeError, ValueError):
                last_request = 0.0
            wait = _NOMINATIM_DELAY - (time.time() - last_request)
            if wait > 0:
                time.sleep(wait)
            try:
                redis_client.set(_NOMINATIM_LAST_REQUEST_KEY, time.time(), ex=86400)
            except Exception:
                pass
            yield
        finally:
            try:
                redis_client.eval(
                    "if redis.call('get', KEYS[1]) == ARGV[1] then "
                    "return redis.call('del', KEYS[1]) else return 0 end",
                    1,
                    _NOMINATIM_LOCK_KEY,
                    token,
                )
            except Exception:
                pass
        return

    with _NOMINATIM_LOCAL_LOCK:
        wait = _NOMINATIM_DELAY - (time.monotonic() - _NOMINATIM_LAST_REQUEST)
        if wait > 0:
            time.sleep(wait)
        _NOMINATIM_LAST_REQUEST = time.monotonic()
        yield


def _nominatim_search(params: dict) -> list[dict]:
    with _nominatim_request_slot():
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params=params,
            headers={"User-Agent": "crate/1.0 (https://github.com/crate)"},
            timeout=10,
        )
    response.raise_for_status()
    return response.json()


def detect_location_from_ip(ip: str) -> dict | None:
    """Detect city/country/coordinates from an IP address.

    Uses ip-api.com free tier. Returns None on failure.
    Results are cached in Redis for 24h.
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return None

    from crate.db.cache_store import get_cache, set_cache

    cache_key = f"geo:ip:{ip}"
    cached = get_cache(cache_key, max_age_seconds=86400)
    if cached:
        return cached

    try:
        resp = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,city,country,countryCode,lat,lon"},
            timeout=5,
        )
        data = resp.json()
        if data.get("status") != "success":
            return None

        result = {
            "city": data.get("city") or "",
            "country": data.get("country") or "",
            "country_code": (data.get("countryCode") or "").upper(),
            "latitude": float(data.get("lat") or 0),
            "longitude": float(data.get("lon") or 0),
        }
        set_cache(cache_key, result, ttl=86400)
        return result
    except Exception:
        log.debug("IP geolocation failed for %s", ip, exc_info=True)
        return None


def geocode_city(query: str) -> dict | None:
    """Geocode a city name to coordinates using Nominatim.

    Returns { display_name, latitude, longitude, country, country_code } or None.
    Results are cached in Redis for 30 days.
    """
    global _NOMINATIM_LAST_REQUEST

    normalized = (query or "").strip()
    if not normalized:
        return None

    from crate.db.cache_store import get_cache, set_cache

    cache_key = f"geo:city:{normalized.lower()}"
    cached = get_cache(cache_key, max_age_seconds=30 * 86400)
    if cached:
        return cached

    try:
        items = _nominatim_search(
            {
                "q": normalized,
                "format": "jsonv2",
                "limit": 1,
                "addressdetails": 1,
            }
        )
        if not items:
            return None

        item = items[0]
        address = item.get("address", {})
        result = {
            "display_name": item.get("display_name", normalized),
            "city": address.get("city")
            or address.get("town")
            or address.get("village")
            or normalized.split(",")[0].strip(),
            "country": address.get("country", ""),
            "country_code": (address.get("country_code") or "").upper(),
            "latitude": float(item["lat"]),
            "longitude": float(item["lon"]),
        }
        set_cache(cache_key, result, ttl=30 * 86400)
        return result
    except Exception:
        log.debug("Geocoding failed for %s", normalized, exc_info=True)
        return None


def search_cities(query: str, limit: int = 5) -> list[dict]:
    """Search for cities matching a query. For autocomplete in the UI."""
    normalized = (query or "").strip()
    if len(normalized) < 2:
        return []

    from crate.db.cache_store import get_cache, set_cache

    cache_key = f"geo:search:{normalized.lower()}"
    cached = get_cache(cache_key, max_age_seconds=7 * 86400)
    if cached:
        return cached

    try:
        items = _nominatim_search(
            {
                "q": normalized,
                "format": "jsonv2",
                "limit": limit,
                "addressdetails": 1,
                "featuretype": "city",
            }
        )
        results = []
        for item in items:
            address = item.get("address", {})
            city = (
                address.get("city")
                or address.get("town")
                or address.get("village")
                or item.get("name", "")
            )
            country = address.get("country", "")
            if not city:
                continue
            results.append(
                {
                    "city": city,
                    "country": country,
                    "country_code": (address.get("country_code") or "").upper(),
                    "display_name": f"{city}, {country}" if country else city,
                    "latitude": float(item["lat"]),
                    "longitude": float(item["lon"]),
                }
            )
        set_cache(cache_key, results, ttl=7 * 86400)
        return results
    except Exception:
        log.debug("City search failed for %s", normalized, exc_info=True)
        return []


def _normalize_place_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized.casefold()).strip()
    for prefix in ("sala ", "venue ", "music venue "):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]
            break
    return normalized


def _venue_result_matches(
    item: dict,
    *,
    venue: str,
    city: str,
    country_code: str | None,
) -> bool:
    address = item.get("address") or {}
    result_name = (
        item.get("name")
        or (item.get("namedetails") or {}).get("name")
        or (item.get("display_name") or "").split(",", 1)[0]
    )
    requested_name = _normalize_place_name(venue)
    actual_name = _normalize_place_name(result_name)
    if not requested_name or not actual_name:
        return False
    if requested_name != actual_name:
        return False

    requested_city = _normalize_place_name(city)
    result_cities = {
        _normalize_place_name(address.get(key) or "")
        for key in ("city", "town", "village", "municipality", "county")
    }
    display_localities = {
        _normalize_place_name(part)
        for part in (item.get("display_name") or "").split(",")[1:]
    }
    city_matches = (
        requested_city in result_cities or requested_city in display_localities
    )
    if not city_matches:
        return False

    actual_country_code = (address.get("country_code") or "").upper()
    if country_code and actual_country_code != country_code.upper():
        return False
    return True


def geocode_venue(
    venue: str,
    city: str,
    *,
    region: str | None = None,
    country: str | None = None,
    country_code: str | None = None,
) -> dict | None:
    """Find a confidently matching venue and return its address and coordinates.

    Existing Crate show locations take precedence over the geocoding cache and
    Nominatim. Nominatim results are cached for one year; misses are cached for
    7 days so a venue added to the map can be found later.
    """
    venue = (venue or "").strip()
    city = (city or "").strip()
    if not venue or not city:
        return None

    locality = ", ".join(
        value
        for value in (city, (region or "").strip(), (country or "").strip())
        if value
    )
    query = f"{venue}, {locality}"
    cache_identity = "|".join(
        _normalize_place_name(value)
        for value in (venue, city, region or "", country or "", country_code or "")
    )
    cache_key = "geo:venue:v1:" + hashlib.sha256(cache_identity.encode()).hexdigest()

    from crate.db.cache_store import get_cache, set_cache

    try:
        from crate.db.queries.shows_location_queries import (
            get_show_venue_location_candidates,
        )

        for existing in get_show_venue_location_candidates(
            venue,
            city,
            region=region,
            country_code=country_code,
        ):
            if _normalize_place_name(existing.get("venue") or "") != (
                _normalize_place_name(venue)
            ):
                continue
            if _normalize_place_name(existing.get("city") or "") != (
                _normalize_place_name(city)
            ):
                continue
            existing_region = (existing.get("region") or "").strip()
            if (
                region
                and existing_region
                and _normalize_place_name(existing_region)
                != _normalize_place_name(region)
            ):
                continue
            existing_country_code = (existing.get("country_code") or "").upper()
            requested_country_code = (country_code or "").upper()
            if (
                requested_country_code
                and existing_country_code
                and existing_country_code != requested_country_code
            ):
                continue
            existing_country = (existing.get("country") or "").strip()
            if (
                country
                and existing_country
                and not (
                    requested_country_code
                    and existing_country_code == requested_country_code
                )
                and _normalize_place_name(existing_country)
                != _normalize_place_name(country)
            ):
                continue

            result = {
                "address_line1": existing.get("address_line1"),
                "postal_code": existing.get("postal_code"),
                "country": existing.get("country"),
                "country_code": existing_country_code or None,
                "latitude": float(existing["latitude"])
                if existing.get("latitude") is not None
                else None,
                "longitude": float(existing["longitude"])
                if existing.get("longitude") is not None
                else None,
                "source": "crate_shows",
            }
            return result
    except Exception:
        # A local query failure should not prevent the cache/provider fallback.
        log.debug(
            "Existing show venue lookup failed for %s, %s",
            venue,
            city,
            exc_info=True,
        )

    cached = get_cache(cache_key, max_age_seconds=365 * 86400)
    if isinstance(cached, dict) and "result" in cached:
        result = (
            dict(cached["result"])
            if isinstance(cached["result"], dict)
            else cached["result"]
        )
        if isinstance(result, dict):
            result.setdefault("source", "openstreetmap")
        return result

    try:
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": 5,
            "addressdetails": 1,
            "namedetails": 1,
        }
        if country_code:
            params["countrycodes"] = country_code.lower()
        items = _nominatim_search(params)
        match = next(
            (
                item
                for item in items
                if _venue_result_matches(
                    item,
                    venue=venue,
                    city=city,
                    country_code=country_code,
                )
            ),
            None,
        )
        if match is None:
            set_cache(cache_key, {"result": None}, ttl=7 * 86400)
            return None

        address = match.get("address") or {}
        street = next(
            (
                address.get(key)
                for key in ("road", "pedestrian", "residential", "footway", "path")
                if address.get(key)
            ),
            None,
        )
        house_number = address.get("house_number")
        address_line1 = " ".join(value for value in (street, house_number) if value)
        result = {
            "address_line1": address_line1 or None,
            "postal_code": address.get("postcode") or None,
            "country": address.get("country") or None,
            "country_code": (address.get("country_code") or "").upper() or None,
            "latitude": float(match["lat"]),
            "longitude": float(match["lon"]),
            "source": "openstreetmap",
        }
        set_cache(cache_key, {"result": result}, ttl=365 * 86400)
        return result
    except Exception:
        log.debug("Venue geocoding failed for %s, %s", venue, city, exc_info=True)
        return None


def get_client_ip(request) -> str:
    """Extract the real client IP from a FastAPI request behind a reverse proxy."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip", "")
    if real_ip:
        return real_ip
    return request.client.host if request.client else ""


__all__ = [
    "detect_location_from_ip",
    "geocode_city",
    "geocode_venue",
    "get_client_ip",
    "search_cities",
]
