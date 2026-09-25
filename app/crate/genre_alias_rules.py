from collections.abc import Mapping
from typing import Any


def genre_alias_is_unchanged(
    existing: Mapping[str, Any] | None,
    alias_slug: str,
    genre_id: int,
    origin: str,
    confidence: float | None,
) -> bool:
    if not existing:
        return False
    if existing["alias_slug"] != alias_slug:
        return False
    if int(existing["genre_id"]) != int(genre_id):
        return False
    if existing["origin"] != origin:
        return False

    existing_confidence = existing["confidence"]
    if existing_confidence == confidence:
        return True
    return (
        existing_confidence is not None
        and confidence is not None
        and float(existing_confidence) == confidence
    )
