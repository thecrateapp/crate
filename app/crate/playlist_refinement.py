from __future__ import annotations

from collections import Counter, defaultdict

from crate.db.home_taste_guardrails import canonical_mix_song_key, track_version_penalty


def _norm(value: object) -> str:
    return str(value or "").strip().casefold()


def _track_label(track: dict) -> str:
    title = str(track.get("title") or "Untitled")
    artist = str(track.get("artist") or "Unknown artist")
    return f"{artist} - {title}"


def _track_position(track: dict, fallback: int) -> int:
    try:
        return int(track.get("position") or fallback)
    except (TypeError, ValueError):
        return fallback


def _is_generated_unlocked(track: dict) -> bool:
    return str(track.get("source") or "generated") == "generated" and not bool(
        track.get("locked")
    )


def _genre_rule_terms(smart_rules: dict | None) -> set[str]:
    terms: set[str] = set()
    for rule in (smart_rules or {}).get("rules") or []:
        if rule.get("field") != "genre" or rule.get("op") not in {
            "contains",
            "eq",
        }:
            continue
        value = rule.get("value")
        raw_values = value if isinstance(value, list) else str(value or "").split("|")
        for raw in raw_values:
            term = _norm(raw)
            if term:
                terms.add(term)
    return terms


def _matches_any_genre(track: dict, terms: set[str]) -> bool:
    if not terms:
        return True
    raw_genres = str(track.get("genre") or "")
    track_terms = {_norm(item) for item in raw_genres.split(",") if _norm(item)}
    if not track_terms:
        return True
    return any(
        term in track_term or track_term in term
        for term in terms
        for track_term in track_terms
    )


def _action(
    action_id: str,
    *,
    action_type: str,
    label: str,
    reason: str,
    position: int | None = None,
    track_id: int | None = None,
) -> dict:
    return {
        "id": action_id,
        "type": action_type,
        "label": label,
        "reason": reason,
        "position": position,
        "track_id": track_id,
    }


def build_playlist_refinement_proposal(
    *, playlist: dict, tracks: list[dict], smart_rules: dict | None
) -> dict:
    issues: list[dict] = []
    actions: list[dict] = []
    action_ids: set[str] = set()

    def add_remove_action(track: dict, position: int, reason: str) -> None:
        if not _is_generated_unlocked(track):
            return
        action_id = f"remove:{position}"
        if action_id in action_ids:
            return
        action_ids.add(action_id)
        actions.append(
            _action(
                action_id,
                action_type="remove_track",
                label=f"Remove #{position} - {_track_label(track)}",
                reason=reason,
                position=position,
                track_id=track.get("id"),
            )
        )

    by_song: dict[tuple[str, str], list[tuple[int, dict]]] = defaultdict(list)
    for index, track in enumerate(tracks, 1):
        identity = canonical_mix_song_key(track)
        if identity is not None:
            by_song[identity].append((_track_position(track, index), track))

    for entries in by_song.values():
        if len(entries) < 2:
            continue
        entries.sort(
            key=lambda item: (
                0 if item[1].get("locked") else 1,
                0 if str(item[1].get("source") or "") == "manual" else 1,
                track_version_penalty(item[1]),
                item[0],
            )
        )
        keep_position, keep_track = entries[0]
        duplicate_positions = [position for position, _track in entries[1:]]
        issues.append(
            {
                "type": "duplicate_song",
                "severity": "high",
                "message": (
                    f"Potential duplicate song around #{keep_position}: "
                    f"{_track_label(keep_track)}"
                ),
                "positions": [keep_position, *duplicate_positions],
            }
        )
        for position, track in entries[1:]:
            add_remove_action(
                track,
                position,
                "Duplicate or alternate version of a song already represented.",
            )

    rules = smart_rules or playlist.get("smart_rules") or {}
    rule_list = rules.get("rules") or []
    has_artist_rule = any(rule.get("field") == "artist" for rule in rule_list)
    has_genre_rule = any(rule.get("field") == "genre" for rule in rule_list)
    if has_genre_rule and not has_artist_rule:
        max_per_artist = int(rules.get("max_per_artist") or 2)
        artist_counts = Counter(_norm(track.get("artist")) for track in tracks)
        for artist_key, count in artist_counts.items():
            if not artist_key or count <= max_per_artist:
                continue
            artist_tracks = [
                (_track_position(track, index), track)
                for index, track in enumerate(tracks, 1)
                if _norm(track.get("artist")) == artist_key
            ]
            issues.append(
                {
                    "type": "artist_overrepresented",
                    "severity": "medium",
                    "message": (
                        f"{artist_tracks[0][1].get('artist') or 'An artist'} appears "
                        f"{count} times; target cap is {max_per_artist}."
                    ),
                    "positions": [position for position, _track in artist_tracks],
                }
            )
            for position, track in artist_tracks[max_per_artist:]:
                add_remove_action(
                    track,
                    position,
                    "Artist is overrepresented for a multi-artist genre playlist.",
                )

    genre_terms = _genre_rule_terms(rules)
    if genre_terms:
        for index, track in enumerate(tracks, 1):
            position = _track_position(track, index)
            if _matches_any_genre(track, genre_terms):
                continue
            issues.append(
                {
                    "type": "weak_genre_match",
                    "severity": "medium",
                    "message": (
                        f"#{position} has weak genre evidence for this rule set: "
                        f"{_track_label(track)}"
                    ),
                    "positions": [position],
                }
            )
            add_remove_action(
                track,
                position,
                "Track genre tags do not match the playlist genre intent.",
            )

    if issues:
        summary = (
            f"Found {len(issues)} issue{'s' if len(issues) != 1 else ''} and "
            f"{len(actions)} safe correction{'s' if len(actions) != 1 else ''}."
        )
    else:
        summary = "Tracklist looks clean."
    return {
        "summary": summary,
        "issues": issues,
        "actions": actions,
        "score_version": "playlist_refinement_v1",
    }


def apply_playlist_refinement_actions(
    *,
    playlist_id: int,
    actions: list[dict],
    selected_action_ids: set[str] | None,
    user_id: int | None = None,
) -> int:
    from crate.db.repositories.playlists_tracks import remove_playlist_track

    selected = [
        action
        for action in actions
        if selected_action_ids is None or str(action.get("id")) in selected_action_ids
    ]
    remove_positions = sorted(
        {
            int(action["position"])
            for action in selected
            if action.get("type") == "remove_track" and action.get("position")
        },
        reverse=True,
    )
    for position in remove_positions:
        remove_playlist_track(
            playlist_id,
            position,
            record_exclusion=True,
            excluded_by_user_id=user_id,
        )
    return len(remove_positions)


__all__ = [
    "apply_playlist_refinement_actions",
    "build_playlist_refinement_proposal",
]
