"""Music Paths service: deterministic planning, optional refinement, persistence."""

from __future__ import annotations

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


def compute_scene_path(
    *,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    step_count: int = 20,
    user_id: int | None = None,
) -> list[dict] | None:
    """Load deterministic candidates, close DB scopes, then refine the path."""
    prepared = prepare_scene_path(
        origin_type=origin_type,
        origin_value=origin_value,
        dest_type=dest_type,
        dest_value=dest_value,
        step_count=step_count,
        user_id=user_id,
    )
    if prepared is None:
        return None
    tracks = refine_music_path_with_llm(**prepared, actor_id=user_id)
    return [
        _make_path_entry(track, index, len(tracks), step_count)
        for index, track in enumerate(tracks)
    ]


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
) -> dict | None:
    origin_label = resolve_endpoint_label(origin_type, origin_value)
    dest_label = resolve_endpoint_label(dest_type, dest_value)

    if not waypoints:
        scene_tracks = compute_scene_path(
            origin_type=origin_type,
            origin_value=origin_value,
            dest_type=dest_type,
            dest_value=dest_value,
            step_count=step_count,
            user_id=user_id,
        )
        if scene_tracks:
            return {
                "origin_label": origin_label,
                "dest_label": dest_label,
                "resolved_waypoints": [],
                "tracks": scene_tracks,
            }

    origin_vec = resolve_bliss_centroid(origin_type, origin_value)
    dest_vec = resolve_bliss_centroid(dest_type, dest_value)
    if not origin_vec or not dest_vec:
        return None

    waypoint_vecs, resolved_waypoints = resolve_waypoints(waypoints)
    tracks = compute_path(
        origin_type,
        origin_value,
        origin_vec,
        dest_type,
        dest_value,
        dest_vec,
        step_count,
        waypoint_vecs or None,
    )
    return {
        "origin_label": origin_label,
        "dest_label": dest_label,
        "resolved_waypoints": resolved_waypoints,
        "tracks": tracks,
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
    }


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    path = get_music_path(path_id, user_id)
    if not path:
        return None

    plan = build_music_path_plan(
        path["origin"]["type"],
        path["origin"]["value"],
        path["destination"]["type"],
        path["destination"]["value"],
        waypoints=path["waypoints"],
        step_count=path["step_count"],
        user_id=user_id,
    )
    if not plan:
        return None

    if not update_music_path_tracks(path_id, user_id, plan["tracks"]):
        return None

    path["tracks"] = plan["tracks"]
    return path


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
    }


__all__ = [
    "build_music_path_plan",
    "compute_scene_path",
    "resolve_waypoints",
    "create_music_path",
    "preview_music_path",
    "regenerate_music_path",
]
