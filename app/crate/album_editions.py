from __future__ import annotations

import re
from collections import defaultdict
from itertools import combinations
from typing import Any

from crate.federation.global_matching import normalize_name

_EDITION_WORDS = (
    r"(?:edition|deluxe|expanded|remaster(?:ed)?|anniversary|bonus|reissue|"
    r"special|limited|collector'?s?|definitive|version|redux|mono|stereo)"
)
_QUALIFIER = re.compile(
    r"\s*[\(\[][^\)\]]*\b" + _EDITION_WORDS + r"\b[^\)\]]*[\)\]]", re.IGNORECASE
)
_YEAR = re.compile(r"\s*[\(\[]\s*\d{4}\s*[\)\]]")
_SUFFIX = re.compile(
    r"\s+[-–:]\s+[^-–:]*\b" + _EDITION_WORDS + r"\b[^-–:]*$", re.IGNORECASE
)


def edition_base_key(name: str | None) -> str:
    base = _QUALIFIER.sub("", name or "")
    base = _YEAR.sub("", base)
    base = _SUFFIX.sub("", base)
    return normalize_name(base)


def title_key(title: str | None) -> str:
    return normalize_name(title)


def edition_overlaps(
    albums: list[dict[str, Any]], *, minimum_share: float = 0.8
) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for album in albums:
        base = edition_base_key(album.get("name"))
        if base:
            groups[(str(album.get("artist") or ""), base)].append(album)

    overlaps: list[dict[str, Any]] = []
    for (artist, _base), members in sorted(groups.items()):
        for first, second in combinations(members, 2):
            titles = {
                album["id"]: {title_key(t) for t in album.get("titles") or []} - {""}
                for album in (first, second)
            }
            smaller, larger = sorted(
                (first, second),
                key=lambda album: (len(titles[album["id"]]), album["id"]),
            )
            small_titles = titles[smaller["id"]]
            if not small_titles:
                continue
            shared = len(small_titles & titles[larger["id"]])
            if shared / len(small_titles) < minimum_share:
                continue
            overlaps.append(
                {
                    "artist": artist,
                    "album_id": smaller["id"],
                    "album": smaller["name"],
                    "track_count": len(small_titles),
                    "edition_album_id": larger["id"],
                    "edition": larger["name"],
                    "edition_track_count": len(titles[larger["id"]]),
                    "shared_tracks": shared,
                }
            )
    return overlaps


__all__ = ["edition_base_key", "edition_overlaps", "title_key"]
