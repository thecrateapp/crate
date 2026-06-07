from __future__ import annotations

import os

from crate.db.home_debug import record_home_mix_debug
from crate.db.tracklist_engine import (
    TracklistRequest,
    generate_tracklist,
    get_tracklist_profile,
)
from crate.track_versions import dedupe_track_variants


def _strict_home_mix_selection_enabled() -> bool:
    raw = os.environ.get("CRATE_HOME_STRICT_MIX_SELECTION", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _select_diverse_tracks(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
    rows = dedupe_track_variants(rows)
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}

    for row in rows:
        track_key = row.get("track_id") or row.get("track_path")
        if not track_key or track_key in seen_tracks:
            continue
        artist_name = (row.get("artist") or "").strip().lower()
        album_key = (artist_name, (row.get("album") or "").strip().lower())
        if artist_name and artist_counts.get(artist_name, 0) >= max_per_artist:
            continue
        if album_key[1] and album_counts.get(album_key, 0) >= max_per_album:
            continue

        seen_tracks.add(track_key)
        if artist_name:
            artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
        if album_key[1]:
            album_counts[album_key] = album_counts.get(album_key, 0) + 1
        selected.append(row)
        if len(selected) >= limit:
            break

    return selected


def _merge_track_rows(*collections: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen_tracks: set[object] = set()

    for rows in collections:
        for row in rows:
            track_key = row.get("track_id") or row.get("track_path")
            if not track_key or track_key in seen_tracks:
                continue
            seen_tracks.add(track_key)
            merged.append(row)

    return merged


def _source_counts(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        source = str(row.get("recommendation_source") or "unknown").strip() or "unknown"
        counts[source] = counts.get(source, 0) + 1
    return counts


def _release_week_buckets(rows: list[dict]) -> list[dict]:
    buckets: dict[int, dict] = {}
    for row in rows:
        raw_index = row.get("release_week_index")
        if raw_index is None:
            continue
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        bucket = buckets.setdefault(
            index,
            {
                "index": index,
                "label": row.get("release_week_label") or str(index),
                "release_week": row.get("release_week"),
                "track_count": 0,
            },
        )
        bucket["track_count"] += 1
    return [buckets[index] for index in sorted(buckets)]


def _select_diverse_tracks_with_backfill(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
) -> list[dict]:
    if limit <= 0:
        return []

    rows = dedupe_track_variants(rows)
    selected: list[dict] = []
    seen_tracks: set[object] = set()
    artist_counts: dict[str, int] = {}
    album_counts: dict[tuple[str, str], int] = {}
    passes = [
        (max_per_artist, max_per_album),
        (max(max_per_artist + 1, 3), max(max_per_album + 1, 3)),
        (limit, limit),
    ]

    for artist_limit, album_limit in passes:
        for row in rows:
            track_key = row.get("track_id") or row.get("track_path")
            if not track_key or track_key in seen_tracks:
                continue
            artist_name = (row.get("artist") or "").strip().lower()
            album_key = (artist_name, (row.get("album") or "").strip().lower())
            if artist_name and artist_counts.get(artist_name, 0) >= artist_limit:
                continue
            if album_key[1] and album_counts.get(album_key, 0) >= album_limit:
                continue

            seen_tracks.add(track_key)
            if artist_name:
                artist_counts[artist_name] = artist_counts.get(artist_name, 0) + 1
            if album_key[1]:
                album_counts[album_key] = album_counts.get(album_key, 0) + 1
            selected.append(row)
            if len(selected) >= limit:
                return selected

    return selected


def _select_home_mix_tracks(
    rows: list[dict],
    *,
    limit: int,
    max_per_artist: int = 2,
    max_per_album: int = 2,
    mix_id: str | None = None,
    profile_id: str = "home_daily_discovery_v1",
    user_id: int | None = None,
) -> list[dict]:
    if not _strict_home_mix_selection_enabled():
        selected = _select_diverse_tracks_with_backfill(
            rows,
            limit=limit,
            max_per_artist=max_per_artist,
            max_per_album=max_per_album,
        )
        if mix_id:
            record_home_mix_debug(
                mix_id,
                {
                    "candidate_pool_size": len(rows),
                    "selected_count": len(selected),
                    "selected_artist_count": len(
                        {
                            (row.get("artist") or row.get("artist_name") or "")
                            .strip()
                            .lower()
                            for row in selected
                            if row.get("artist") or row.get("artist_name")
                        }
                    ),
                    "strict_selection_enabled": False,
                    "score_version": "legacy_backfill",
                    "candidate_source_counts": _source_counts(rows),
                    "selected_source_counts": _source_counts(selected),
                    "candidate_release_week_buckets": _release_week_buckets(rows),
                    "release_week_buckets_used": _release_week_buckets(selected),
                },
            )
        return selected

    profile = get_tracklist_profile(
        profile_id,
        overrides={"max_per_artist": max_per_artist, "max_per_album": max_per_album},
    )
    result = generate_tracklist(
        TracklistRequest(
            rows=rows,
            profile=profile,
            limit=limit,
            user_id=user_id,
            seed_id=mix_id or profile_id,
        )
    )
    selected = result.tracks
    diagnostics = {**result.diagnostics, "strict_selection_enabled": True}
    diagnostics["candidate_source_counts"] = _source_counts(rows)
    diagnostics["selected_source_counts"] = _source_counts(selected)
    diagnostics["candidate_release_week_buckets"] = _release_week_buckets(rows)
    diagnostics["release_week_buckets_used"] = _release_week_buckets(selected)
    if mix_id:
        record_home_mix_debug(mix_id, diagnostics)
    return selected


__all__ = [
    "_merge_track_rows",
    "_select_home_mix_tracks",
    "_select_diverse_tracks",
    "_select_diverse_tracks_with_backfill",
]
