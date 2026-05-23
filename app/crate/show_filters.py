from __future__ import annotations

import re
from typing import Any

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


def normalize_show_name(value: Any) -> str:
    normalized = str(value or "").lower().replace("&", " and ")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def is_tribute_candidate(value: Any) -> bool:
    normalized = normalize_show_name(value)
    return any(marker in normalized for marker in TRIBUTE_MARKERS)


def show_has_tribute_signal(show: dict[str, Any]) -> bool:
    values: list[Any] = [
        show.get("name"),
        show.get("title"),
        show.get("event_name"),
    ]
    lineup = show.get("lineup")
    if isinstance(lineup, list | tuple):
        values.extend(lineup)
    return any(is_tribute_candidate(value) for value in values if value)


__all__ = [
    "is_tribute_candidate",
    "normalize_show_name",
    "show_has_tribute_signal",
]
