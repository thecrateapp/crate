"""Resolve the user's concert location consistently across Listen surfaces."""

from typing import TypedDict

from fastapi import Request

from crate.db.repositories.users import get_user_by_id


class ShowLocation(TypedDict):
    user_lat: float | None
    user_lon: float | None
    user_radius: int
    user_city: str | None
    user_country: str | None


def resolve_show_location(request: Request, user_id: int) -> ShowLocation | None:
    user = get_user_by_id(user_id) or {}
    location = user
    if user.get("show_location_mode") == "near_me":
        from crate.geolocation import detect_location_from_ip, get_client_ip

        location = detect_location_from_ip(get_client_ip(request)) or {}
    latitude, longitude = location.get("latitude"), location.get("longitude")
    city = location.get("city") or None
    if (latitude is None or longitude is None) and not city:
        return None
    return {
        "user_lat": latitude,
        "user_lon": longitude,
        "user_radius": user.get("show_radius_km") or 60,
        "user_city": city,
        "user_country": location.get("country_code") or None,
    }
