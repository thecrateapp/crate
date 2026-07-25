"""Deterministic matching helpers for the federated global catalog."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

AUTO_MERGE_THRESHOLD = 0.90
CANDIDATE_THRESHOLD = 0.85

_FEAT_SUFFIX_RE = re.compile(
    r"(?:\s+|\s*[\(\[]\s*)(?:feat|ft|featuring)\.?\s+.+?[\)\]]?\s*$",
    re.IGNORECASE,
)
_BRACKETED_EDITION_SUFFIX_RE = re.compile(
    r"\s*[\(\[]\s*(?:deluxe|expanded|remaster(?:ed)?|anniversary|special|bonus|limited)\b[^\)\]]*[\)\]]\s*$",
    re.IGNORECASE,
)
_UNBRACKETED_EDITION_SUFFIX_RE = re.compile(
    r"\s+(?:deluxe|expanded|remaster(?:ed)?|anniversary|special|bonus|limited)(?:\s+(?:edition|version|remaster))?\s*$",
    re.IGNORECASE,
)
_PUNCT_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class MatchScore:
    confidence: float
    method: str
    auto_merge: bool = False
    candidate: bool = False


def normalize_name(value: Any, *, strip_edition: bool = False) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    text = _FEAT_SUFFIX_RE.sub("", text)
    if strip_edition:
        text = _BRACKETED_EDITION_SUFFIX_RE.sub("", text)
        text = _UNBRACKETED_EDITION_SUFFIX_RE.sub("", text)
    text = text.replace("&", " and ")
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = _PUNCT_RE.sub(" ", text.lower())
    return " ".join(text.split())


def artist_match_key(artist: dict[str, Any]) -> str:
    return f"artist:{normalize_name(_first(artist, 'canonical_name', 'artist_name', 'artist', 'name'))}"


def album_match_key(album: dict[str, Any]) -> str:
    artist = normalize_name(_first(album, "artist_name", "artist"))
    title = normalize_name(
        _first(album, "canonical_name", "title", "name", "album"),
        strip_edition=True,
    )
    year = str(_first(album, "year", default="") or "").strip()
    return f"album:{artist}|{title}|{year}"


def track_match_key(track: dict[str, Any]) -> str:
    artist = normalize_name(_first(track, "artist_name", "artist"))
    album = normalize_name(_first(track, "album_name", "album"), strip_edition=True)
    title = normalize_name(_first(track, "canonical_title", "title", "name"))
    disc = _int_or_zero(_first(track, "disc_number"))
    number = _int_or_zero(_first(track, "track_number"))
    return f"track:{artist}|{album}|{disc}|{number}|{title}"


def score_artist_match(left: dict[str, Any], right: dict[str, Any]) -> MatchScore:
    left_mbid = _identifier(left, "musicbrainz_artist_mbid", "mbid")
    right_mbid = _identifier(right, "musicbrainz_artist_mbid", "mbid")
    if left_mbid and right_mbid:
        if left_mbid == right_mbid:
            return _score(1.0, "musicbrainz_artist_mbid")
        return _score(0.0, "conflicting_musicbrainz_artist_mbid")

    if _artist_name(left) and _artist_name(left) == _artist_name(right):
        return _score(0.94, "normalized_artist_name")

    return _score(0.0, "no_match")


def score_album_match(left: dict[str, Any], right: dict[str, Any]) -> MatchScore:
    left_release = _identifier(left, "musicbrainz_release_mbid", "musicbrainz_albumid")
    right_release = _identifier(
        right, "musicbrainz_release_mbid", "musicbrainz_albumid"
    )
    if left_release and right_release:
        if left_release == right_release:
            return _score(1.0, "musicbrainz_release_mbid")
        return _score(0.0, "conflicting_musicbrainz_release_mbid")

    same_artist = _album_artist(left) and _album_artist(left) == _album_artist(right)
    if not same_artist:
        return _score(0.0, "different_album_artist")

    left_group = _identifier(
        left, "musicbrainz_release_group_mbid", "musicbrainz_releasegroupid"
    )
    right_group = _identifier(
        right, "musicbrainz_release_group_mbid", "musicbrainz_releasegroupid"
    )
    if left_group and right_group:
        if left_group == right_group:
            return _score(0.98, "musicbrainz_release_group_mbid")
        return _score(0.0, "conflicting_musicbrainz_release_group_mbid")

    left_upc = _identifier(left, "upc")
    right_upc = _identifier(right, "upc")
    if left_upc and right_upc:
        if left_upc == right_upc:
            return _score(1.0, "upc")
        return _score(0.0, "conflicting_upc")

    left_title = _album_title(left)
    right_title = _album_title(right)
    if left_title and left_title == right_title:
        if _year_within_one(left, right) and _same_track_count(left, right):
            return _score(0.93, "album_title_year_track_count")
        return _score(0.85, "ambiguous_album_title")

    return _score(0.0, "no_match")


def score_track_match(left: dict[str, Any], right: dict[str, Any]) -> MatchScore:
    left_recording = _identifier(
        left, "musicbrainz_recording_mbid", "musicbrainz_trackid"
    )
    right_recording = _identifier(
        right, "musicbrainz_recording_mbid", "musicbrainz_trackid"
    )
    if left_recording and right_recording:
        if left_recording == right_recording:
            return _score(1.0, "musicbrainz_recording_mbid")
        return _score(0.0, "conflicting_musicbrainz_recording_mbid")

    left_isrc = _identifier(left, "isrc")
    right_isrc = _identifier(right, "isrc")
    if left_isrc and right_isrc:
        if left_isrc == right_isrc and _track_artist(left) == _track_artist(right):
            return _score(1.0, "isrc")
        return _score(0.0, "conflicting_isrc")

    same_title = _track_title(left) and _track_title(left) == _track_title(right)
    same_album = _track_album(left) and _track_album(left) == _track_album(right)
    same_position = _track_position(left) == _track_position(right)
    same_duration = _duration_within(left, right, seconds=3)
    if same_album and same_title and same_position and same_duration:
        return _score(0.93, "album_position_title_duration")

    if same_title and same_duration:
        return _score(0.85, "ambiguous_track_title_duration")

    return _score(0.0, "no_match")


def _score(confidence: float, method: str) -> MatchScore:
    return MatchScore(
        confidence=confidence,
        method=method,
        auto_merge=confidence >= AUTO_MERGE_THRESHOLD,
        candidate=confidence >= CANDIDATE_THRESHOLD,
    )


def _first(row: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return default


def _identifier(row: dict[str, Any], *keys: str) -> str:
    return str(_first(row, *keys, default="") or "").strip().lower()


def _artist_name(row: dict[str, Any]) -> str:
    return normalize_name(
        _first(row, "canonical_name", "artist_name", "artist", "name")
    )


def _album_artist(row: dict[str, Any]) -> str:
    return normalize_name(_first(row, "artist_name", "artist"))


def _album_title(row: dict[str, Any]) -> str:
    return normalize_name(
        _first(row, "canonical_name", "title", "name", "album"),
        strip_edition=True,
    )


def _track_artist(row: dict[str, Any]) -> str:
    return normalize_name(_first(row, "artist_name", "artist"))


def _track_album(row: dict[str, Any]) -> str:
    return normalize_name(_first(row, "album_name", "album"), strip_edition=True)


def _track_title(row: dict[str, Any]) -> str:
    return normalize_name(_first(row, "canonical_title", "title", "name"))


def _track_position(row: dict[str, Any]) -> tuple[int, int]:
    return (
        _int_or_zero(_first(row, "disc_number")),
        _int_or_zero(_first(row, "track_number")),
    )


def _int_or_none(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _int_or_zero(value: Any) -> int:
    return _int_or_none(value) or 0


def _year_within_one(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_year = _int_or_none(_first(left, "year"))
    right_year = _int_or_none(_first(right, "year"))
    return (
        left_year is not None
        and right_year is not None
        and abs(left_year - right_year) <= 1
    )


def _same_track_count(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_count = _int_or_none(_first(left, "track_count"))
    right_count = _int_or_none(_first(right, "track_count"))
    return (
        left_count is not None and right_count is not None and left_count == right_count
    )


def _duration_within(
    left: dict[str, Any], right: dict[str, Any], *, seconds: int
) -> bool:
    left_duration = _int_or_none(_first(left, "duration_seconds", "duration"))
    right_duration = _int_or_none(_first(right, "duration_seconds", "duration"))
    return (
        left_duration is not None
        and right_duration is not None
        and abs(left_duration - right_duration) <= seconds
    )


__all__ = [
    "MatchScore",
    "album_match_key",
    "artist_match_key",
    "normalize_name",
    "score_album_match",
    "score_artist_match",
    "score_track_match",
    "track_match_key",
]
