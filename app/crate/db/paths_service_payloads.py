"""Payload helpers for music path service responses."""

from __future__ import annotations

from crate.music_path_validation import validate_music_path


def build_endpoint_payload(
    endpoint_type: str, endpoint_value: str, endpoint_label: str
) -> dict:
    return {
        "type": endpoint_type,
        "value": endpoint_value,
        "label": endpoint_label,
    }


def serialize_music_path_row(row: dict, *, include_tracks: bool) -> dict:
    payload = {
        "id": row["id"],
        "name": row["name"],
        "origin": build_endpoint_payload(
            row["origin_type"], row["origin_value"], row["origin_label"]
        ),
        "destination": build_endpoint_payload(
            row["dest_type"], row["dest_value"], row["dest_label"]
        ),
        "waypoints": row["waypoints"] or [],
        "step_count": row["step_count"],
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }
    if include_tracks:
        payload["tracks"] = row.get("tracks") or []
    else:
        payload["track_count"] = row["track_count"]
    metadata = row.get("generation_metadata") or {}
    if metadata:
        payload.update(
            {
                key: metadata[key]
                for key in ("is_partial", "generated_step_count", "warnings")
            }
        )
    elif include_tracks:
        # Current availability is independent of a saved generation's completeness.
        structural_tracks = [
            {key: value for key, value in track.items() if key != "playable"}
            for track in payload["tracks"]
        ]
        payload.update(
            validate_music_path(structural_tracks, requested_steps=row["step_count"])
        )
    else:
        count = row["track_count"]
        payload.update(
            {
                "is_partial": count != row["step_count"],
                "generated_step_count": count,
                "warnings": [
                    {
                        "code": "insufficient_tracks"
                        if count < row["step_count"]
                        else "excess_tracks",
                        "expected": row["step_count"],
                        "actual": count,
                    }
                ]
                if count != row["step_count"]
                else [],
            }
        )
    return payload


__all__ = [
    "build_endpoint_payload",
    "serialize_music_path_row",
]
