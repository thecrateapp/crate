"""Music Paths service: deterministic planning, optional refinement, persistence."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from crate.recommendation_policy import RECENT_PLAY_WINDOW, canonical_key
from crate.music_path_validation import validate_music_path

from crate.db.queries.recommendation_history import history_for_candidates

from crate.db.paths_compute import (
    compute_path,
    resolve_bliss_centroid,
    resolve_endpoint_label,
)
from crate.db.paths_scene import prepare_scene_path, _make_path_entry
from crate.music_paths_refinement import refine_music_path_with_llm


from crate.db.paths_service_payloads import build_endpoint_payload
from crate.db.paths_service_reads import get_music_path
from crate.db.repositories.paths import (
    create_music_path_record,
    update_music_path_tracks,
)
from crate.db.queries.recommendation_context import load_endpoint_contexts


def compute_scene_path(
    *,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    step_count: int = 20,
    user_id: int | None = None,
    recent_song_keys: set[tuple[str, str]] | None = None,
    previous_song_keys: set[tuple[str, str]] | None = None,
    previous_track_ids: set[int] | None = None,
    selection_seed: str | None = None,
    diagnostics: dict | None = None,
) -> list[dict] | None:
    """Load deterministic candidates, close DB scopes, then refine the path."""
    prepared = prepare_scene_path(
        origin_type=origin_type,
        origin_value=origin_value,
        dest_type=dest_type,
        dest_value=dest_value,
        step_count=step_count,
        user_id=user_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        selection_seed=selection_seed,
    )
    if prepared is None:
        return None
    tracks = refine_music_path_with_llm(
        **prepared,
        actor_id=user_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    entries = [
        {
            **_make_path_entry(track, index, len(tracks), step_count),
            "album_artist": track.get("album_artist"),
            "artist_genre_slugs": track.get("artist_genre_slugs") or [],
        }
        for index, track in enumerate(tracks)
    ]
    if diagnostics is not None:
        validation_context = prepared.get("validation_context") or {}
        diagnostics.update(
            validate_music_path(
                entries,
                requested_steps=step_count,
                origin={
                    "type": origin_type,
                    "value": origin_value,
                    "artists": [prepared["origin_label"]],
                    "canonical_genre_slug": validation_context.get("origin_genre_slug"),
                },
                destination={
                    "type": dest_type,
                    "value": dest_value,
                    "artists": [prepared["dest_label"]],
                    "canonical_genre_slug": validation_context.get(
                        "destination_genre_slug"
                    ),
                },
                max_repeat_per_artist=validation_context.get("max_repeat_per_artist"),
            )
        )
    return entries


def resolve_waypoints(
    waypoints: list[dict] | None,
) -> tuple[list[list[float]], list[dict]]:
    waypoint_vecs: list[list[float]] = []
    resolved_waypoints: list[dict] = []
    for waypoint in waypoints or []:
        waypoint_vec = resolve_bliss_centroid(waypoint["type"], waypoint["value"])
        if waypoint_vec:
            waypoint_vecs.append(waypoint_vec)
            resolved_waypoints.append(
                {
                    **waypoint,
                    "label": resolve_endpoint_label(
                        waypoint["type"], waypoint["value"]
                    ),
                }
            )
    return waypoint_vecs, resolved_waypoints


def build_music_path_plan(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    *,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
    user_id: int | None = None,
    selection_seed: str | None = None,
    now: datetime | None = None,
    previous_tracks: list[dict] | None = None,
) -> dict | None:
    now = now or datetime.now(timezone.utc)
    selection_seed = selection_seed if selection_seed is not None else uuid.uuid4().hex
    history = (
        history_for_candidates(user_id, None, now - RECENT_PLAY_WINDOW, now=now)
        if user_id is not None
        else {}
    )
    recent_song_keys = set(history)
    previous_song_keys = {
        key
        for track in previous_tracks or []
        if (key := canonical_key(track)) is not None
    }
    previous_track_ids = {
        track_id
        for track in previous_tracks or []
        if (track_id := track.get("track_id", track.get("id"))) is not None
    }
    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)

    if not waypoints:
        scene_metadata: dict = {}
        scene_tracks = compute_scene_path(
            origin_type=origin_type,
            origin_value=origin_value,
            dest_type=dest_type,
            dest_value=dest_value,
            step_count=step_count,
            user_id=user_id,
            recent_song_keys=recent_song_keys,
            previous_song_keys=previous_song_keys,
            previous_track_ids=previous_track_ids,
            selection_seed=selection_seed,
            diagnostics=scene_metadata,
        )
        if scene_tracks:
            return {
                "origin_label": origin_label,
                "dest_label": dest_label,
                "resolved_waypoints": [],
                "tracks": scene_tracks,
                **(
                    scene_metadata
                    or validate_music_path(scene_tracks, requested_steps=step_count)
                ),
            }

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs, resolved_waypoints = resolve_waypoints(waypoints)
    endpoint_contexts = load_endpoint_contexts(
        [
            (origin_type, origin_value),
            *((waypoint["type"], waypoint["value"]) for waypoint in resolved_waypoints),
            (dest_type, dest_value),
        ]
    )
    acoustic_diagnostics: dict = {}
    tracks = compute_path(
        origin_type,
        origin_value,
        origin_vec,
        dest_type,
        dest_value,
        dest_vec,
        step_count,
        waypoint_vecs or None,
        endpoint_contexts=endpoint_contexts,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
        selection_seed=selection_seed,
        diagnostics=acoustic_diagnostics,
    )
    return {
        "origin_label": origin_label,
        "dest_label": dest_label,
        "resolved_waypoints": resolved_waypoints,
        "tracks": tracks,
        **validate_music_path(
            tracks,
            requested_steps=step_count,
            origin={
                "type": origin_type,
                "value": origin_value,
                "resolved_track_id": acoustic_diagnostics.get("origin_track_id"),
                "artists": endpoint_contexts[0]["artists"] if endpoint_contexts else [],
            },
            destination={
                "type": dest_type,
                "value": dest_value,
                "resolved_track_id": acoustic_diagnostics.get("destination_track_id"),
                "artists": endpoint_contexts[-1]["artists"]
                if endpoint_contexts
                else [],
            },
            requested_waypoints=waypoints,
            resolved_waypoints=resolved_waypoints,
        ),
    }


def _generation_metadata(plan: dict, step_count: int) -> dict:
    if all(key in plan for key in ("is_partial", "generated_step_count", "warnings")):
        return {
            key: plan[key] for key in ("is_partial", "generated_step_count", "warnings")
        }
    return validate_music_path(plan["tracks"], requested_steps=step_count)


def _stored_generation_metadata(
    plan: dict, step_count: int, requested_waypoints: list[dict] | None
) -> dict:
    return {
        **_generation_metadata(plan, step_count),
        "requested_waypoints": [
            {"type": waypoint["type"], "value": waypoint["value"]}
            for waypoint in requested_waypoints or []
        ],
    }


def create_music_path(
    user_id: int,
    name: str,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
) -> dict | None:
    plan = build_music_path_plan(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
        user_id=user_id,
    )
    if not plan:
        return None

    row = create_music_path_record(
        user_id=user_id,
        name=name,
        origin_type=origin_type,
        origin_value=origin_value,
        origin_label=plan["origin_label"],
        dest_type=dest_type,
        dest_value=dest_value,
        dest_label=plan["dest_label"],
        waypoints=plan["resolved_waypoints"],
        step_count=step_count,
        tracks=plan["tracks"],
        generation_metadata=_stored_generation_metadata(plan, step_count, waypoints),
    )
    if not row:
        return None

    return {
        "id": row["id"],
        "name": name,
        "origin": build_endpoint_payload(
            origin_type, origin_value, plan["origin_label"]
        ),
        "destination": build_endpoint_payload(
            dest_type, dest_value, plan["dest_label"]
        ),
        "waypoints": plan["resolved_waypoints"],
        "step_count": step_count,
        "tracks": plan["tracks"],
        "created_at": str(row["created_at"]),
        **_generation_metadata(plan, step_count),
    }


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    path = get_music_path(path_id, user_id, for_regeneration=True)
    if not path:
        return None
    requested_waypoints = path.pop("_requested_waypoints", path["waypoints"])

    plan = build_music_path_plan(
        path["origin"]["type"],
        path["origin"]["value"],
        path["destination"]["type"],
        path["destination"]["value"],
        waypoints=requested_waypoints,
        step_count=path["step_count"],
        user_id=user_id,
        previous_tracks=path.get("tracks") or [],
    )
    if not plan:
        return None

    if not update_music_path_tracks(
        path_id,
        user_id,
        plan["tracks"],
        generation_metadata=_stored_generation_metadata(
            plan, path["step_count"], requested_waypoints
        ),
        waypoints=plan["resolved_waypoints"],
    ):
        return None

    return get_music_path(path_id, user_id)


def preview_music_path(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
    user_id: int | None = None,
) -> dict | None:
    plan = build_music_path_plan(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
        user_id=user_id,
    )
    if not plan:
        return None

    return {
        "name": f"{plan['origin_label']} -> {plan['dest_label']}",
        "origin": build_endpoint_payload(
            origin_type, origin_value, plan["origin_label"]
        ),
        "destination": build_endpoint_payload(
            dest_type, dest_value, plan["dest_label"]
        ),
        "waypoints": plan["resolved_waypoints"],
        "step_count": step_count,
        "tracks": plan["tracks"],
        **_generation_metadata(plan, step_count),
    }


__all__ = [
    "build_music_path_plan",
    "compute_scene_path",
    "resolve_waypoints",
    "create_music_path",
    "preview_music_path",
    "regenerate_music_path",
]
