"""Compatibility delegates to Music Paths service orchestration."""

from __future__ import annotations


def resolve_waypoints(
    waypoints: list[dict] | None,
) -> tuple[list[list[float]], list[dict]]:
    from crate.music_paths import resolve_waypoints as implementation

    return implementation(waypoints)


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
    from crate.music_paths import build_music_path_plan as implementation

    return implementation(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
        user_id=user_id,
    )


__all__ = ["resolve_waypoints", "build_music_path_plan"]
