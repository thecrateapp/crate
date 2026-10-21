"""Compatibility delegates to Music Paths service orchestration."""

from __future__ import annotations


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
    from crate.music_paths import create_music_path as implementation

    return implementation(
        user_id,
        name,
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints,
        step_count,
    )


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    from crate.music_paths import regenerate_music_path as implementation

    return implementation(path_id, user_id)


def preview_music_path(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    waypoints: list[dict] | None = None,
    step_count: int = 20,
    user_id: int | None = None,
) -> dict | None:
    from crate.music_paths import preview_music_path as implementation

    return implementation(
        origin_type, origin_value, dest_type, dest_value, waypoints, step_count, user_id
    )


__all__ = ["create_music_path", "regenerate_music_path", "preview_music_path"]
