"""Conservative recording identity matching for release metadata updates."""

from collections.abc import Mapping, Sequence
from math import isfinite
from typing import Any


def _duration(track: Mapping[str, Any]) -> float | None:
    try:
        value = float(track.get("duration") or track.get("length_sec") or 0)
    except (TypeError, ValueError):
        return None
    return value if isfinite(value) and value > 0 else None


def match_release_track(
    local_track: Mapping[str, Any], release_tracks: Sequence[Mapping[str, Any]]
) -> Mapping[str, Any] | None:
    title = " ".join(str(local_track.get("title") or "").casefold().split())
    if not title:
        return None
    candidates = [
        track
        for track in release_tracks
        if " ".join(str(track.get("title") or "").casefold().split()) == title
    ]
    duration = _duration(local_track)
    if duration is not None:
        compatible = []
        for track in candidates:
            candidate_duration = _duration(track)
            if candidate_duration is None or abs(duration - candidate_duration) <= 2:
                compatible.append(track)
        candidates = compatible
    if not candidates or len({track.get("mbid") for track in candidates}) > 1:
        return None
    return candidates[0]
