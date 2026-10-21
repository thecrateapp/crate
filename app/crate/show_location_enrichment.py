"""Best-effort city coordinates for private show drafts, before exact review."""

import math
import time
from collections.abc import Callable

from crate.geolocation import geocode_city


def enrich_show_draft_locations(
    draft: dict, *, cancelled: Callable[[], bool], budget_seconds: float = 20
) -> dict:
    """Use a real geocoder, never a model's guessed coordinates or a venue claim.

    Keep this bounded inside the extraction worker. Unresolved/ambiguous cities remain
    unknown and can still match the user's explicit city filter.
    """
    deadline = time.monotonic() + budget_seconds
    cities: dict[tuple[str, str], dict | None] = {}
    candidates = []
    provenance = []
    for candidate in draft.get("candidates", []):
        if cancelled():
            raise ValueError("CANCELLED")
        row = dict(candidate)
        candidates.append(row)
        if row.get("latitude") is not None or row.get("longitude") is not None:
            continue
        city = str(row.get("city") or "").strip()
        country = str(row.get("country_code") or row.get("country") or "").strip()
        if not city or not country:
            continue
        key = (city.casefold(), country.casefold())
        if key not in cities:
            if time.monotonic() >= deadline:
                continue
            try:
                cities[key] = geocode_city(f"{city}, {country}")
            except Exception:
                cities[key] = None
        geo = cities[key]
        if not geo:
            continue
        expected_country = str(row.get("country_code") or "").upper()
        if (
            expected_country
            and str(geo.get("country_code") or "").upper() != expected_country
        ):
            continue
        try:
            latitude, longitude = float(geo["latitude"]), float(geo["longitude"])
        except (TypeError, ValueError, KeyError):
            continue
        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            continue
        row.update(latitude=latitude, longitude=longitude)
        provenance.append(
            {
                "item_id": row.get("item_id"),
                "provider": "Nominatim",
                "precision": "city",
                "query": f"{city}, {country}",
            }
        )
    result = {**draft, "candidates": candidates}
    if provenance:
        result["location_enrichment"] = provenance
        result["warnings"] = [
            *draft.get("warnings", []),
            "Coordinates were resolved to city centres, not exact venue locations. Review the city and country before publishing.",
        ]
    return result
