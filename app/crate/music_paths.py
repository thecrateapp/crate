"""Music Paths service: deterministic planning, optional refinement, persistence.

A request stores the deterministic path (or one refined by a cached review) and
queues refine_music_path on the ai lane; the review lands later as a new
revision of the saved path (SM3-D8, SMQ.PR4).
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from crate.recommendation_policy import RECENT_PLAY_WINDOW, canonical_key
from crate.music_path_validation import validate_music_path
from crate.observability.recommendations import observe_music_path_plan

from crate.db.queries.recommendation_history import history_for_candidates

from crate.db.paths_compute import (
    compute_path,
    resolve_bliss_centroid,
    resolve_endpoint_label,
)
from crate.db.paths_scene import prepare_scene_path, _make_path_entry
from crate.music_paths_refinement import (
    refine_music_path_from_cache,
    refine_music_path_with_llm,
)


from crate.ai.consumers import accept_action
from crate.ai.contracts import AIConfigurationError
from crate.db.paths_service_payloads import build_endpoint_payload
from crate.db.paths_service_reads import get_music_path
from crate.db.queries.paths import get_music_path_row
from crate.db.repositories.paths import (
    apply_music_path_refinement,
    create_music_path_record,
    update_music_path_tracks,
)
from crate.db.repositories.tasks import create_task_dedup
from crate.db.queries.recommendation_context import load_endpoint_contexts

_PENDING = {"status": "pending"}


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
    """Load deterministic candidates, close DB scopes, then apply a cached review.

    ``diagnostics["refinement"]`` reports a pending review (cache miss) or a
    cached one that was applied; the model itself only runs in the worker.
    """
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
    outcome = refine_music_path_from_cache(
        **prepared,
        actor_id=user_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_song_keys,
        previous_track_ids=previous_track_ids,
    )
    entries = _scene_entries(outcome.tracks, step_count)
    if diagnostics is not None:
        diagnostics.update(
            _scene_validation(
                entries,
                prepared,
                step_count,
                origin_type=origin_type,
                origin_value=origin_value,
                dest_type=dest_type,
                dest_value=dest_value,
            )
        )
        if outcome.pending:
            diagnostics["refinement"] = dict(_PENDING)
        elif outcome.cached:
            diagnostics["refinement"] = {"status": "applied", "cached": True}
    return entries


def _scene_entries(tracks: list[dict], step_count: int) -> list[dict]:
    return [
        {
            **_make_path_entry(track, index, len(tracks), step_count),
            "album_artist": track.get("album_artist"),
            "artist_genre_slugs": track.get("artist_genre_slugs") or [],
        }
        for index, track in enumerate(tracks)
    ]


def _scene_validation(
    entries: list[dict],
    prepared: dict,
    step_count: int,
    *,
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
) -> dict:
    validation_context = prepared.get("validation_context") or {}
    return validate_music_path(
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
            "canonical_genre_slug": validation_context.get("destination_genre_slug"),
        },
        max_repeat_per_artist=validation_context.get("max_repeat_per_artist"),
    )


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
    started = time.perf_counter()
    engine, plan = _plan_music_path(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
        user_id=user_id,
        selection_seed=selection_seed,
        now=now,
        previous_tracks=previous_tracks,
    )
    observe_music_path_plan(engine, plan, step_count, started)
    return plan


def _plan_music_path(
    origin_type: str,
    origin_value: str,
    dest_type: str,
    dest_value: str,
    *,
    waypoints: list[dict] | None,
    step_count: int,
    user_id: int | None,
    selection_seed: str | None,
    now: datetime | None,
    previous_tracks: list[dict] | None,
) -> tuple[str, dict | None]:
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
            return "scene", {
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
        return "acoustic", None

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
    return "acoustic", {
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
    selection_seed = uuid.uuid4().hex
    planned_at = datetime.now(timezone.utc)
    plan = build_music_path_plan(
        origin_type,
        origin_value,
        dest_type,
        dest_value,
        waypoints=waypoints,
        step_count=step_count,
        user_id=user_id,
        selection_seed=selection_seed,
        now=planned_at,
    )
    if not plan:
        return None
    refinement, acceptance = _refinement_state(plan)
    revision = 1

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
        generation_metadata=_revision_metadata(
            _stored_generation_metadata(plan, step_count, waypoints),
            revision,
            refinement,
        ),
    )
    if not row:
        return None
    if acceptance is not None:
        _queue_refinement(
            path_id=row["id"],
            user_id=user_id,
            revision=revision,
            selection_seed=selection_seed,
            planned_at=planned_at,
            previous_tracks=[],
            acceptance=acceptance,
        )

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
        "revision": revision,
        **({"refinement": refinement} if refinement else {}),
    }


def regenerate_music_path(path_id: int, user_id: int) -> dict | None:
    path = get_music_path(path_id, user_id, for_regeneration=True)
    if not path:
        return None
    requested_waypoints = path.pop("_requested_waypoints", path["waypoints"])
    previous_tracks = path.get("tracks") or []
    revision = int(path.get("revision") or 1) + 1
    selection_seed = uuid.uuid4().hex
    planned_at = datetime.now(timezone.utc)

    plan = build_music_path_plan(
        path["origin"]["type"],
        path["origin"]["value"],
        path["destination"]["type"],
        path["destination"]["value"],
        waypoints=requested_waypoints,
        step_count=path["step_count"],
        user_id=user_id,
        previous_tracks=previous_tracks,
        selection_seed=selection_seed,
        now=planned_at,
    )
    if not plan:
        return None
    refinement, acceptance = _refinement_state(plan)

    if not update_music_path_tracks(
        path_id,
        user_id,
        plan["tracks"],
        generation_metadata=_revision_metadata(
            _stored_generation_metadata(plan, path["step_count"], requested_waypoints),
            revision,
            refinement,
        ),
        waypoints=plan["resolved_waypoints"],
    ):
        return None
    if acceptance is not None:
        _queue_refinement(
            path_id=path_id,
            user_id=user_id,
            revision=revision,
            selection_seed=selection_seed,
            planned_at=planned_at,
            previous_tracks=previous_tracks,
            acceptance=acceptance,
        )

    return get_music_path(path_id, user_id)


def _refinement_state(plan: dict) -> tuple[dict | None, dict | None]:
    """The stored refinement state and, for a pending review, its acceptance."""
    refinement = plan.get("refinement")
    if refinement != _PENDING:
        return refinement, None
    try:
        return dict(_PENDING), accept_action("music_paths.refine")
    except AIConfigurationError:
        return None, None


def _revision_metadata(metadata: dict, revision: int, refinement: dict | None) -> dict:
    return {
        **metadata,
        "revision": revision,
        **({"refinement": refinement} if refinement else {}),
    }


def _queue_refinement(
    *,
    path_id: int,
    user_id: int,
    revision: int,
    selection_seed: str,
    planned_at: datetime,
    previous_tracks: list[dict],
    acceptance: dict,
) -> None:
    """Queue the model review of one revision; the plan inputs let it be replayed."""
    song_keys = {
        key for track in previous_tracks if (key := canonical_key(track)) is not None
    }
    params = {
        "path_id": path_id,
        "user_id": user_id,
        "revision": revision,
        "selection_seed": selection_seed,
        "planned_at": planned_at.isoformat(),
        "previous_track_ids": sorted(
            {
                int(track_id)
                for track in previous_tracks
                if (track_id := track.get("track_id", track.get("id"))) is not None
            }
        ),
        "previous_song_keys": sorted(list(key) for key in song_keys),
        "ai_acceptance": acceptance,
    }
    create_task_dedup(
        "refine_music_path",
        params,
        dedup_key=(
            f"music-path-refine:{path_id}:{revision}:"
            f"{str(acceptance.get('fingerprint') or '')[:16]}"
        ),
    )


def refine_stored_music_path(
    *,
    path_id: int,
    user_id: int,
    revision: int,
    selection_seed: str,
    planned_at: str,
    previous_track_ids: list[int],
    previous_song_keys: list[list[str]],
    ai_acceptance: dict | None,
    job_id: str,
) -> dict:
    """Review one saved revision with the model (refine_music_path task only).

    The deterministic plan is replayed from its seed and planning time; if it no
    longer reproduces the saved tracks the path is kept. A changed path is
    stored as the next revision, and clients are told to refetch.
    """
    found = get_music_path_row(path_id, user_id)
    if not found:
        return {"status": "skipped", "reason": "missing"}
    row = {**dict(found), "id": path_id, "user_id": user_id}
    metadata = dict(row.get("generation_metadata") or {})
    if int(metadata.get("revision") or 1) != revision:
        return {"status": "skipped", "reason": "superseded"}
    if metadata.get("refinement") != _PENDING:
        return {"status": "skipped", "reason": "not_pending"}

    planned = datetime.fromisoformat(planned_at)
    recent_song_keys = set(
        history_for_candidates(user_id, None, planned - RECENT_PLAY_WINDOW, now=planned)
    )
    previous_keys = {
        (str(key[0]), str(key[1])) for key in previous_song_keys if len(key) == 2
    }
    previous_ids = {int(track_id) for track_id in previous_track_ids}
    prepared = prepare_scene_path(
        origin_type=row["origin_type"],
        origin_value=row["origin_value"],
        dest_type=row["dest_type"],
        dest_value=row["dest_value"],
        step_count=row["step_count"],
        user_id=user_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_keys,
        previous_track_ids=previous_ids,
        selection_seed=selection_seed,
    )
    stored_ids = [track.get("track_id") for track in row.get("tracks") or []]
    if not prepared or [track.get("id") for track in prepared["tracks"]] != stored_ids:
        return _finish_refinement(
            row, metadata, revision, {"status": "skipped", "reason": "inputs_changed"}
        )
    try:
        from crate.ai.consumers import resume_action

        call = resume_action(
            "music_paths.refine", ai_acceptance, actor_id=user_id, job_id=job_id
        )
    except AIConfigurationError as error:
        return _finish_refinement(
            row,
            metadata,
            revision,
            {"status": "unavailable", "error_code": error.code},
        )
    refined = refine_music_path_with_llm(
        **prepared,
        actor_id=user_id,
        recent_song_keys=recent_song_keys,
        previous_song_keys=previous_keys,
        previous_track_ids=previous_ids,
        ai_call=call,
    )
    refined_ids = [track.get("id") for track in refined]
    if refined_ids == stored_ids:
        return _finish_refinement(row, metadata, revision, {"status": "unchanged"})
    entries = _scene_entries(refined, row["step_count"])
    replaced = sum(1 for old, new in zip(stored_ids, refined_ids) if old != new)
    validation = _scene_validation(
        entries,
        prepared,
        row["step_count"],
        origin_type=row["origin_type"],
        origin_value=row["origin_value"],
        dest_type=row["dest_type"],
        dest_value=row["dest_value"],
    )
    return _finish_refinement(
        row,
        {
            **metadata,
            **{
                key: validation[key]
                for key in ("is_partial", "generated_step_count", "warnings")
                if key in validation
            },
            "revision": revision + 1,
        },
        revision,
        {"status": "applied", "replaced": replaced},
        tracks=entries,
    )


def _finish_refinement(
    row: dict,
    metadata: dict,
    revision: int,
    outcome: dict,
    *,
    tracks: list[dict] | None = None,
) -> dict:
    """End the pending state on the planned revision and tell clients to refetch."""
    stored = apply_music_path_refinement(
        row["id"],
        row["user_id"],
        expected_revision=revision,
        generation_metadata={**metadata, "refinement": outcome},
        tracks=tracks,
    )
    if not stored:
        return {"status": "skipped", "reason": "superseded"}
    from crate.api.cache_events import broadcast_invalidation

    broadcast_invalidation("paths", f"path:{row['id']}")
    return {**outcome, "revision": metadata.get("revision", revision)}


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
    "refine_stored_music_path",
    "regenerate_music_path",
]
