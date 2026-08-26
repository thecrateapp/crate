"""Candidate ranking for associating external feed items with library artists."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any


_MAX_CANDIDATES = 5
_AUTO_CONFIDENCE = 0.9
_AUTO_MARGIN = 0.15
_MIN_NAME_LENGTH = 3
_GENERIC_ARTIST_NAMES = {
    "artist",
    "artists",
    "band",
    "bands",
    "music",
    "various artists",
}


def rank_artist_association_candidates(
    *,
    item: Mapping[str, Any],
    artists: Iterable[Mapping[str, Any]],
    limit: int = _MAX_CANDIDATES,
) -> dict[str, Any]:
    """Rank safe library-artist candidates for one external feed item."""
    title = _normalize(item.get("title"))
    author = _normalize(item.get("author"))
    excerpt = _normalize(item.get("excerpt"))
    canonical_url = _normalize(item.get("canonical_url"))
    candidates: list[dict[str, Any]] = []

    for artist in artists:
        artist_id = artist.get("id")
        name = _normalize(artist.get("name"))
        if artist_id is None or not _is_usable_artist_name(name):
            continue

        signals: list[tuple[float, str, str]] = []
        if _contains_phrase(title, name):
            signals.append((0.96, "title", "Exact artist name in title"))
        if _contains_phrase(author, name):
            signals.append((0.82, "author", "Exact artist name in author"))
        if _contains_phrase(excerpt, name):
            signals.append((0.84, "excerpt", "Exact artist name in excerpt"))

        slug = _normalize(artist.get("slug"))
        if slug and slug in canonical_url:
            signals.append((0.88, "url", "Artist slug in canonical URL"))

        if not signals:
            similarity = _title_similarity(title, name)
            if similarity >= 0.72:
                signals.append(
                    (
                        round(0.55 + similarity * 0.25, 4),
                        "fuzzy_title",
                        "Close name similarity in title",
                    )
                )

        if not signals:
            continue

        score = max(signal[0] for signal in signals)
        if len(signals) > 1:
            score = min(0.99, score + 0.02)
        candidates.append(
            {
                "artist_id": int(artist_id),
                "artist_name": str(artist.get("name") or "").strip(),
                "artist_slug": artist.get("slug"),
                "score": round(score, 4),
                "confidence": round(score, 4),
                "reasons": [signal[2] for signal in signals],
                "signals": [signal[1] for signal in signals],
            }
        )

    candidates.sort(
        key=lambda candidate: (-float(candidate["score"]), candidate["artist_name"])
    )
    candidates = candidates[: max(1, min(int(limit), _MAX_CANDIDATES))]
    auto_candidate = _auto_candidate(candidates)
    if auto_candidate is not None:
        auto_candidate = {
            **auto_candidate,
            "association_method": f"deterministic_{auto_candidate['signals'][0]}_match",
        }

    return {
        "candidates": candidates,
        "auto_candidate": auto_candidate,
        "requires_review": bool(candidates) and auto_candidate is None,
    }


def _auto_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not candidates or float(candidates[0]["score"]) < _AUTO_CONFIDENCE:
        return None
    if len(candidates) == 1:
        return candidates[0]
    margin = float(candidates[0]["score"]) - float(candidates[1]["score"])
    if margin < _AUTO_MARGIN:
        return None
    return candidates[0]


def _is_usable_artist_name(value: str) -> bool:
    return len(value) >= _MIN_NAME_LENGTH and value not in _GENERIC_ARTIST_NAMES


def _contains_phrase(text: str, phrase: str) -> bool:
    if not text or not phrase:
        return False
    pattern = (
        r"(?<!\w)" + r"\s+".join(re.escape(part) for part in phrase.split()) + r"(?!\w)"
    )
    return re.search(pattern, text) is not None


def _title_similarity(title: str, artist_name: str) -> float:
    if not title or not artist_name:
        return 0.0
    title_tokens = title.split()
    name_tokens = artist_name.split()
    if len(name_tokens) > len(title_tokens) + 1:
        return 0.0
    windows = (
        " ".join(title_tokens[index : index + len(name_tokens)])
        for index in range(max(1, len(title_tokens) - len(name_tokens) + 1))
    )
    return max(
        (SequenceMatcher(None, window, artist_name).ratio() for window in windows),
        default=0.0,
    )


def _normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold()
    return " ".join(re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).split())


__all__ = ["rank_artist_association_candidates"]
