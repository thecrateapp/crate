from __future__ import annotations

import re
from typing import Literal


ReleaseCategory = Literal["album", "ep_single", "compilation", "live", "other"]

_LIVE_TITLE_RE = re.compile(r"\blive\b", re.IGNORECASE)
_COMPILATION_TITLE_RE = re.compile(
    r"\b(?:best of|greatest hits|anthology|compilation|complete albums?|"
    r"collected|collection)\b",
    re.IGNORECASE,
)
_EP_SINGLE_TITLE_RE = re.compile(r"\b(?:ep|single)\b", re.IGNORECASE)


def classify_release(
    *,
    primary_type: str | None = None,
    secondary_types: list[str] | tuple[str, ...] | None = None,
    title: str = "",
    track_count: int | None = None,
) -> ReleaseCategory:
    primary = (primary_type or "").strip().casefold()
    secondary = {
        str(value).strip().casefold() for value in (secondary_types or []) if value
    }

    if "live" in secondary:
        return "live"
    if "compilation" in secondary:
        return "compilation"
    if secondary.intersection(
        {
            "remix",
            "soundtrack",
            "spokenword",
            "audiobook",
            "interview",
            "audio drama",
            "dj-mix",
            "mixtape/street",
        }
    ):
        return "other"
    if primary in {"ep", "single"}:
        return "ep_single"
    if primary == "album":
        return "album"
    if primary:
        return "other"

    if _LIVE_TITLE_RE.search(title or ""):
        return "live"
    if _COMPILATION_TITLE_RE.search(title or ""):
        return "compilation"
    if _EP_SINGLE_TITLE_RE.search(title or ""):
        return "ep_single"
    if track_count is not None and int(track_count or 0) == 1:
        return "ep_single"
    return "album"


__all__ = ["ReleaseCategory", "classify_release"]
