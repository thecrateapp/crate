"""Write-side persistence for music paths."""

import json
from contextlib import nullcontext
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def create_music_path_record(
    *,
    user_id: int,
    name: str,
    origin_type: str,
    origin_value: str,
    origin_label: str,
    dest_type: str,
    dest_value: str,
    dest_label: str,
    waypoints: list[dict],
    step_count: int,
    tracks: list[dict],
    generation_metadata: dict | None = None,
    session=None,
) -> dict | None:
    with (
        nullcontext(session) if session is not None else transaction_scope() as current
    ):
        row = (
            current.execute(
                text(
                    """
                INSERT INTO music_paths
                    (user_id, name, origin_type, origin_value, origin_label,
                     dest_type, dest_value, dest_label, waypoints, step_count, tracks, generation_metadata)
                VALUES
                    (:user_id, :name, :origin_type, :origin_value, :origin_label,
                     :dest_type, :dest_value, :dest_label, CAST(:waypoints AS jsonb), :step_count, CAST(:tracks AS jsonb), CAST(:generation_metadata AS jsonb))
                RETURNING id, created_at
                """
                ),
                {
                    "user_id": user_id,
                    "name": name,
                    "origin_type": origin_type,
                    "origin_value": origin_value,
                    "origin_label": origin_label,
                    "dest_type": dest_type,
                    "dest_value": dest_value,
                    "dest_label": dest_label,
                    "waypoints": json.dumps(waypoints),
                    "step_count": step_count,
                    "tracks": json.dumps(tracks),
                    "generation_metadata": json.dumps(generation_metadata or {}),
                },
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def delete_music_path(path_id: int, user_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text("DELETE FROM music_paths WHERE id = :id AND user_id = :user_id"),
            {"id": path_id, "user_id": user_id},
        )
        return _rowcount(result) > 0


def update_music_path_tracks(
    path_id: int,
    user_id: int,
    tracks: list[dict],
    *,
    generation_metadata: dict | None = None,
    waypoints: list[dict] | None = None,
    session=None,
) -> bool:
    with (
        nullcontext(session) if session is not None else transaction_scope() as current
    ):
        result = current.execute(
            text(
                """
                UPDATE music_paths
                SET tracks = CAST(:tracks AS jsonb),
                    generation_metadata = CAST(:generation_metadata AS jsonb),
                    waypoints = COALESCE(CAST(:waypoints AS jsonb), waypoints),
                    updated_at = :now
                WHERE id = :id AND user_id = :user_id
                """
            ),
            {
                "id": path_id,
                "user_id": user_id,
                "tracks": json.dumps(tracks),
                "generation_metadata": json.dumps(generation_metadata or {}),
                "waypoints": json.dumps(waypoints) if waypoints is not None else None,
                "now": datetime.now(timezone.utc),
            },
        )
        return _rowcount(result) > 0


def apply_music_path_refinement(
    path_id: int,
    user_id: int,
    *,
    expected_revision: int,
    generation_metadata: dict,
    tracks: list[dict] | None = None,
    session=None,
) -> bool:
    """Store a review only on the revision it was planned for (compare-and-swap).

    A regeneration or deletion in the meantime wins; the stale review is dropped.
    """
    with (
        nullcontext(session) if session is not None else transaction_scope() as current
    ):
        result = current.execute(
            text(
                """
                UPDATE music_paths
                SET tracks = COALESCE(CAST(:tracks AS jsonb), tracks),
                    generation_metadata = CAST(:generation_metadata AS jsonb),
                    updated_at = :now
                WHERE id = :id AND user_id = :user_id
                  AND COALESCE((generation_metadata->>'revision')::int, 1) = :expected
                """
            ),
            {
                "id": path_id,
                "user_id": user_id,
                "expected": expected_revision,
                "tracks": json.dumps(tracks) if tracks is not None else None,
                "generation_metadata": json.dumps(generation_metadata),
                "now": datetime.now(timezone.utc),
            },
        )
        return _rowcount(result) > 0


__all__ = [
    "apply_music_path_refinement",
    "create_music_path_record",
    "delete_music_path",
    "update_music_path_tracks",
]
