"""Shared deterministic constraints for Music Paths and optional substitutions."""

from __future__ import annotations

from math import isfinite

from crate.genre_taxonomy import slugify_genre
from crate.recommendation_policy import fresh_path_candidates
from crate.track_versions import track_song_identity


def _track_id(track: dict):
    value = track.get("track_id", track.get("id"))
    return str(value) if value is not None else None


def _artist(track: dict) -> str:
    return str(track.get("artist") or "").strip().casefold()


def _genre(track: dict) -> str:
    return slugify_genre(str(track.get("genre_slug") or track.get("path_genre") or ""))


def _endpoint_matches(track: dict, endpoint: dict) -> bool:
    kind, value = endpoint.get("type"), str(endpoint.get("value") or "")
    if not value:
        return False
    if kind == "track":
        return value in {_track_id(track), str(track.get("entity_uid") or "")}
    if "resolved_track_id" in endpoint:
        return endpoint["resolved_track_id"] is not None and _track_id(track) == str(
            endpoint["resolved_track_id"]
        )
    if kind == "album":
        return value in {
            str(track.get("album_id") or ""),
            str(track.get("album_entity_uid") or ""),
        }
    if kind == "artist":
        if value in {
            str(track.get("artist_id") or ""),
            str(track.get("artist_entity_uid") or ""),
        }:
            return bool(value)
        names = {
            str(name).strip().casefold()
            for name in endpoint.get("artists") or [value]
            if name
        }
        return bool(
            names
            & {_artist(track), str(track.get("album_artist") or "").strip().casefold()}
        )
    if kind == "genre":
        genres = {_genre(track)} | {
            slugify_genre(str(genre)) for genre in track.get("artist_genre_slugs") or []
        }
        canonical = str(endpoint.get("canonical_genre_slug") or value)
        return slugify_genre(canonical) in genres
    return False


def validate_music_path(
    tracks: list[dict],
    *,
    requested_steps: int,
    origin: dict | None = None,
    destination: dict | None = None,
    requested_waypoints: list[dict] | None = None,
    resolved_waypoints: list[dict] | None = None,
    max_repeat_per_artist: int | None = None,
) -> dict:
    """Report incomplete constraints without changing or inventing path tracks."""
    warnings: list[dict] = []
    if len(tracks) != requested_steps:
        warnings.append(
            {
                "code": "insufficient_tracks"
                if len(tracks) < requested_steps
                else "excess_tracks",
                "expected": requested_steps,
                "actual": len(tracks),
            }
        )
    for code, endpoint, index in (
        ("missing_origin", origin, 0),
        ("missing_destination", destination, -1),
    ):
        if endpoint is not None and (
            not tracks or not _endpoint_matches(tracks[index], endpoint)
        ):
            warnings.append({"code": code})

    used_ids, used_families = set(), set()
    artist_counts: dict[str, int] = {}
    previous_progress = -1.0
    previous_artist = ""
    for index, track in enumerate(tracks):
        family, track_id = track_song_identity(track), _track_id(track)
        if (track_id is not None and track_id in used_ids) or (
            family is not None and family in used_families
        ):
            warnings.append({"code": "duplicate_song", "position": index})
        used_ids.add(track_id)
        used_families.add(family)
        if track.get("playable") is False:
            warnings.append({"code": "unavailable_track", "position": index})
        if "progress" in track:
            try:
                progress = float(track["progress"])
            except (TypeError, ValueError):
                progress = float("nan")
            if (
                not isfinite(progress)
                or not 0 <= progress <= 1
                or progress < previous_progress
            ):
                warnings.append({"code": "invalid_progress", "position": index})
            previous_progress = progress
        artist = _artist(track)
        artist_counts[artist] = artist_counts.get(artist, 0) + 1
        if (
            max_repeat_per_artist is not None
            and artist_counts[artist] > max_repeat_per_artist
        ):
            warnings.append({"code": "artist_repeat_limit", "position": index})
        if artist and artist == previous_artist:
            warnings.append({"code": "repeated_artist", "position": index})
        previous_artist = artist
        if (
            track.get("genre_slug")
            and track.get("path_genre")
            and slugify_genre(str(track["path_genre"])) != _genre(track)
        ):
            warnings.append({"code": "scene_mismatch", "position": index})

    requested = [
        (w.get("type"), str(w.get("value"))) for w in requested_waypoints or []
    ]
    resolved = [(w.get("type"), str(w.get("value"))) for w in resolved_waypoints or []]
    remaining = list(resolved)
    for waypoint in requested:
        if waypoint in remaining:
            remaining.remove(waypoint)
        else:
            warnings.append({"code": "unresolved_waypoint"})
    expected_order = [waypoint for waypoint in requested if waypoint in resolved]
    if resolved != expected_order:
        warnings.append({"code": "invalid_waypoint_order"})
    return {
        "is_partial": bool(warnings),
        "generated_step_count": len(tracks),
        "warnings": warnings,
    }


def can_replace_path_track(
    tracks: list[dict],
    index: int,
    candidate: dict,
    *,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    validation_context: dict | None = None,
) -> bool:
    """Accept only safe internal substitutions with a strict musical improvement."""
    from crate.db.paths_scene import (
        _audio_transition_score,
        _artist_connection_score,
        _is_blocked_variant,
        _membership_score,
        _MIN_MEMBERSHIP_SCORE,
        _track_score,
        _user_affinity,
    )

    if (
        not 0 < index < len(tracks) - 1
        or candidate.get("playable") is False
        or _is_blocked_variant(candidate)
        or _membership_score(candidate) < _MIN_MEMBERSHIP_SCORE
    ):
        return False
    original = tracks[index]
    original_genre, candidate_genre = _genre(original), _genre(candidate)
    if original_genre and candidate_genre != original_genre:
        return False
    family, track_id = track_song_identity(candidate), _track_id(candidate)
    if track_id is None:
        return False
    others = tracks[:index] + tracks[index + 1 :]
    context = validation_context or {}
    max_repeats = context.get("max_repeat_per_artist")
    if (
        max_repeats is not None
        and sum(_artist(track) == _artist(candidate) for track in others) >= max_repeats
    ):
        return False
    if any(
        (track_id is not None and track_id == _track_id(track))
        or (family is not None and family == track_song_identity(track))
        for track in others
    ):
        return False
    previous, following, destination = tracks[index - 1], tracks[index + 1], tracks[-1]
    if _artist(candidate) and _artist(candidate) in {
        _artist(previous),
        _artist(following),
    }:
        return False
    baseline = [
        _audio_transition_score(original, neighbor)
        for neighbor in (previous, following, destination)
    ]
    replacement = [
        _audio_transition_score(candidate, neighbor)
        for neighbor in (previous, following, destination)
    ]
    similarities = context.get("artist_similarity_graph") or {}
    members = context.get("shared_members_graph") or {}
    baseline.extend(
        _artist_connection_score(original, neighbor, similarities, members)
        for neighbor in (previous, following, destination)
    )
    replacement.extend(
        _artist_connection_score(candidate, neighbor, similarities, members)
        for neighbor in (previous, following, destination)
    )
    if any(new + 1e-9 < old for new, old in zip(replacement, baseline)):
        return False
    old_quality = _track_score(original, previous) - 0.30 * _user_affinity(original)
    new_quality = _track_score(candidate, previous) - 0.30 * _user_affinity(candidate)
    if new_quality + 1e-9 < old_quality:
        return False
    if not (
        new_quality > old_quality + 1e-9
        or any(new > old + 1e-9 for new, old in zip(replacement, baseline))
    ):
        return False
    eligible = fresh_path_candidates(
        [(original, old_quality), (candidate, new_quality)],
        preferred=candidate,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    return any(row is candidate for row in eligible)


__all__ = ["validate_music_path", "can_replace_path_track"]
