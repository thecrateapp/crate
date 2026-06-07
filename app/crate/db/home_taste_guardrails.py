from __future__ import annotations

import hashlib
import re
import unicodedata

from crate.track_versions import track_song_identity, track_variant_rank

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")
_LIVEISH_ALBUM_RE = re.compile(
    r"\b(live|session|peel|bbc|radio session|concert|bootleg)\b",
    re.IGNORECASE,
)
_ALT_ALBUM_RE = re.compile(
    r"\b(remix|remixes|demo|demos|acoustic|dub|version|edit|alternate)\b",
    re.IGNORECASE,
)
_LOW_QUALITY_VARIANT_THRESHOLD = 2


def _normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
    text = _PUNCT_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def _track_key(row: dict) -> object | None:
    return row.get("track_id") or row.get("track_entity_uid") or row.get("track_path")


def _album_key(row: dict) -> tuple[str, str] | None:
    artist = _normalize_text(row.get("artist") or row.get("artist_name"))
    album = _normalize_text(row.get("album") or row.get("album_title"))
    if not album:
        return None
    return artist, album


def _coerce_positive_float(value: object) -> float | None:
    if not isinstance(value, int | float | str):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _format_quality_score(row: dict) -> tuple[int, float, int]:
    bit_depth = int(_coerce_positive_float(row.get("bit_depth")) or 0)
    sample_rate = _coerce_positive_float(row.get("sample_rate")) or 0.0
    fmt = str(row.get("format") or "").casefold()
    format_rank = 2 if fmt == "flac" else 1 if fmt in {"m4a", "aac", "alac"} else 0
    return bit_depth, sample_rate, format_rank


def _has_audio_identity(row: dict) -> bool:
    return bool(row.get("audio_fingerprint") or row.get("fingerprint"))


def canonical_mix_song_key(row: dict) -> tuple[str, str] | None:
    identity = track_song_identity(row)
    if identity is None:
        return None
    artist_key, title_key = identity
    if not title_key:
        return None
    return artist_key, title_key


def track_version_penalty(row: dict) -> int:
    penalty = track_variant_rank(str(row.get("title") or ""))
    album = str(row.get("album") or row.get("album_title") or "")
    if _LIVEISH_ALBUM_RE.search(album):
        penalty = max(penalty, 3)
    if _ALT_ALBUM_RE.search(album):
        penalty = max(penalty, 2)
    return penalty


def is_low_quality_mix_variant(row: dict) -> bool:
    return track_version_penalty(row) >= _LOW_QUALITY_VARIANT_THRESHOLD


def _candidate_preference(row: dict) -> tuple[int, int, int, float, int]:
    bit_depth, sample_rate, format_rank = _format_quality_score(row)
    return (
        -track_version_penalty(row),
        1 if _has_audio_identity(row) else 0,
        bit_depth,
        sample_rate,
        format_rank,
    )


def dedupe_mix_song_identities(
    rows: list[dict], *, allow_versions: bool = False
) -> list[dict]:
    if allow_versions:
        return list(rows)

    passthrough: list[tuple[int, dict]] = []
    grouped: dict[tuple[str, str], tuple[int, dict]] = {}

    for index, row in enumerate(rows):
        identity = canonical_mix_song_key(row)
        if identity is None:
            passthrough.append((index, row))
            continue
        current = grouped.get(identity)
        if current is None or _candidate_preference(row) > _candidate_preference(
            current[1]
        ):
            grouped[identity] = (index, row)

    ordered = passthrough + list(grouped.values())
    ordered.sort(key=lambda item: item[0])
    return [row for _index, row in ordered]


def select_mix_tracks(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int,
    max_per_album: int,
    strict: bool = True,
) -> list[dict]:
    selected, _diagnostics = select_mix_tracks_with_diagnostics(
        rows,
        limit=limit,
        max_per_artist=max_per_artist,
        max_per_album=max_per_album,
        strict=strict,
    )
    return selected


def select_mix_tracks_with_diagnostics(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int,
    max_per_album: int,
    strict: bool = True,
) -> tuple[list[dict], dict]:
    diagnostics = {
        "candidate_pool_size": len(rows),
        "selected_count": 0,
        "selected_artist_count": 0,
        "dropped_duplicate_track_count": 0,
        "dropped_duplicate_song_count": 0,
        "dropped_artist_cap_count": 0,
        "dropped_album_cap_count": 0,
        "strict_selection_shortfall": False,
        "score_version": "home_mix_guardrails_v1",
    }
    if limit <= 0:
        return [], diagnostics

    candidate_rows = dedupe_mix_song_identities(rows, allow_versions=not strict)
    diagnostics["dropped_duplicate_song_count"] = len(rows) - len(candidate_rows)
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    seen_song_identities: set[tuple[str, str]] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}

    for row in candidate_rows:
        track_key = _track_key(row)
        if track_key is None:
            continue
        if track_key in seen_tracks:
            diagnostics["dropped_duplicate_track_count"] += 1
            continue

        song_identity = canonical_mix_song_key(row)
        if (
            strict
            and song_identity is not None
            and song_identity in seen_song_identities
        ):
            diagnostics["dropped_duplicate_song_count"] += 1
            continue

        artist = _normalize_text(row.get("artist") or row.get("artist_name"))
        if artist and artist_counts.get(artist, 0) >= max_per_artist:
            diagnostics["dropped_artist_cap_count"] += 1
            continue

        album = _album_key(row)
        if album is not None and album_counts.get(album, 0) >= max_per_album:
            diagnostics["dropped_album_cap_count"] += 1
            continue

        seen_tracks.add(track_key)
        if strict and song_identity is not None:
            seen_song_identities.add(song_identity)
        if artist:
            artist_counts[artist] = artist_counts.get(artist, 0) + 1
        if album is not None:
            album_counts[album] = album_counts.get(album, 0) + 1
        selected.append(row)
        if len(selected) >= limit:
            break

    diagnostics["selected_count"] = len(selected)
    diagnostics["selected_artist_count"] = len(
        {
            _normalize_text(row.get("artist") or row.get("artist_name"))
            for row in selected
            if _normalize_text(row.get("artist") or row.get("artist_name"))
        }
    )
    diagnostics["strict_selection_shortfall"] = strict and len(selected) < limit
    return selected, diagnostics


def rank_by_daily_seed(
    rows: list[dict], *, user_id: int, surface_id: str, day: object
) -> list[dict]:
    def seeded_key(item: tuple[int, dict]) -> tuple[str, int]:
        index, row = item
        stable_key = _track_key(row) or canonical_mix_song_key(row) or index
        payload = f"{user_id}:{surface_id}:{day}:{stable_key}".encode()
        return hashlib.sha256(payload).hexdigest(), index

    return [row for _index, row in sorted(enumerate(rows), key=seeded_key)]


__all__ = [
    "canonical_mix_song_key",
    "dedupe_mix_song_identities",
    "is_low_quality_mix_variant",
    "rank_by_daily_seed",
    "select_mix_tracks",
    "select_mix_tracks_with_diagnostics",
    "track_version_penalty",
]
