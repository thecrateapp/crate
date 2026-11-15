"""analyze_playlist_stems: stems for the tracks of Smart Mix playlists (ST2.PR3).

The task runs on ``heavy`` in the analysis worker, one at a time (its dedup key is the
scheduler's), with priority 2: above the Smart Mix backfill (3) and below interactive
work. Night windows do not apply; the resource governor does. Each run:

1. queues the tracks of Smart Mix playlists whose file changed since their analysis
   (``queue_smart_mix_stem_jobs``) and fails jobs a dead separation left ``analyzing``;
2. asks for the profiles of tracks that have none yet: the analysis is stored under the
   profile's source revision, so a track waits for its profile;
3. claims one job, separates the track (:mod:`crate.smart_mix.separation`), stores its
   ``stem-analysis/1`` and its stem file in one transaction, and keeps the stem files
   within the admin quota;
4. comes back for the next job at once, or later while profiles are on their way, and
   ends when nothing is left.

A failed track gets three attempts, 15 minutes times its attempts apart; a track over 20
minutes fails for good. While a job can be claimed, the backfill coordinator waits
(:func:`playlist_stem_work_pending`): a Smart Mix playlist goes first, and the backfill
resumes when its work ends.
"""

from __future__ import annotations

import logging
from pathlib import Path

from crate.db.cache_settings import get_setting
from crate.db.events import emit_task_event
from crate.db.jobs.smart_mix_backfill import smart_mix_profile_dedup_key
from crate.db.jobs.smart_mix_stems import (
    StemFileRecord,
    StemJobClaim,
    claim_stem_job,
    complete_stem_job,
    count_claimable_stem_jobs,
    fail_stem_job,
    release_interrupted_stem_jobs,
    stem_jobs_waiting_for_profiles,
)
from crate.db.repositories.smart_mix_playlists import queue_smart_mix_stem_jobs
from crate.smart_mix import separation
from crate.smart_mix.source import smart_mix_source_revision
from crate.smart_mix.stem_files import (
    enforce_stem_quota,
    stem_file_name,
    stem_quota_bytes,
    sweep_stem_directory,
    write_stem_file,
)
from crate.smart_mix.stem_storage import (
    StemsVolumeError,
    scratch_directory,
    writable_stems_directory,
)
from crate.smart_mix.stems import (
    STEM_QUOTA_SETTING,
    STEM_TASK_TYPE,
    StemAnalysis,
    stem_quota_gib,
)
from crate.task_dedup_keys import SMART_MIX_STEMS_DEDUP_KEY
from crate.worker_handlers import TaskHandler, is_cancelled, run_again_later

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_AFTER_SECONDS = 15 * 60
MAX_TRACK_SECONDS = 20 * 60
# The task's time limit (actors.TASK_POOL_CONFIG): one track per run.
TIME_LIMIT_SECONDS = 2 * 3600
PROFILE_BATCH = 10
PROFILE_WAIT_SECONDS = 120
BACKFILL_WAIT_SECONDS = 60
# What the sweep leaves alone: a file being moved into place, a separation running.
SWEEP_MIN_AGE_SECONDS = TIME_LIMIT_SECONDS + 300


def separation_unavailable(library: str | None) -> str | None:
    """Why this worker cannot separate, or None: no graph, no onnxruntime, or no
    stems directory on the music volume."""
    reason = separation.separation_unavailable_reason()
    if reason is not None:
        return reason
    if not library:
        return "No library path"
    try:
        writable_stems_directory(library)
    except StemsVolumeError as error:
        return str(error)
    return None


def playlist_stem_work_pending(library: str | None) -> bool:
    """Whether a Smart Mix playlist has a track this worker can separate now."""
    if separation_unavailable(library) is not None:
        return False
    return (
        count_claimable_stem_jobs(
            max_attempts=MAX_ATTEMPTS, retry_after_seconds=RETRY_AFTER_SECONDS
        )
        > 0
    )


def wake_stem_task() -> str | None:
    """Queue analyze_playlist_stems unless one is already queued or running."""
    from crate.db.repositories.tasks import create_task_dedup

    return create_task_dedup(STEM_TASK_TYPE, {}, dedup_key=SMART_MIX_STEMS_DEDUP_KEY)


def _handle_analyze_playlist_stems(task_id: str, params: dict, config: dict) -> dict:
    from crate.resource_governor import record_decision, should_defer_task

    library = config.get("library_path")
    reason = separation_unavailable(library)
    if reason is not None:
        log.warning("Smart Mix stems cannot be separated here: %s", reason)
        return {"status": "skipped", "reason": reason}
    assert library is not None
    if is_cancelled(task_id):
        return {"status": "cancelled"}
    decision = should_defer_task(STEM_TASK_TYPE, params)
    if not decision.allowed:
        record_decision(decision, task_type=STEM_TASK_TYPE, source="task_loop")
        return run_again_later(
            min(max(1, decision.defer_seconds), 300),
            progress=f"Deferred by resource governor: {decision.reason}",
        )

    release_interrupted_stem_jobs(older_than_seconds=TIME_LIMIT_SECONDS + 300)
    queue_smart_mix_stem_jobs()
    waiting = _request_profiles()
    claim = claim_stem_job(
        max_attempts=MAX_ATTEMPTS, retry_after_seconds=RETRY_AFTER_SECONDS
    )
    if claim is None:
        _sweep(library)
        if waiting:
            return run_again_later(
                PROFILE_WAIT_SECONDS,
                progress=f"Waiting for the Smart Mix profile of {waiting} track(s)",
            )
        return {"status": "idle"}

    outcome = _separate(task_id, claim, library)
    left = count_claimable_stem_jobs(
        max_attempts=MAX_ATTEMPTS, retry_after_seconds=RETRY_AFTER_SECONDS
    )
    if left or waiting:
        return run_again_later(
            1, progress=f"Separated track {claim.track_id}; {left} track(s) to go"
        )
    return outcome


def _request_profiles() -> int:
    """Queue the profiles that waiting tracks lack; returns how many tracks wait."""
    from crate.db.repositories.tasks import create_task_dedup

    track_ids = stem_jobs_waiting_for_profiles(limit=PROFILE_BATCH)
    for track_id in track_ids:
        create_task_dedup(
            "compute_smart_mix_profile",
            {"track_id": track_id},
            dedup_key=smart_mix_profile_dedup_key(track_id),
        )
    return len(track_ids)


def _separate(task_id: str, claim: StemJobClaim, library: str) -> dict:
    result = {"track_id": claim.track_id}
    if (claim.duration_seconds or 0) > MAX_TRACK_SECONDS:
        error = f"Longer than {MAX_TRACK_SECONDS // 60} minutes: not separated"
        fail_stem_job(claim.track_id, error, max_attempts=MAX_ATTEMPTS, final=True)
        return {**result, "state": "failed", "reason": error}
    quota = stem_quota_bytes(stem_quota_gib(get_setting(STEM_QUOTA_SETTING)))
    root = writable_stems_directory(library)
    try:
        analysis, record = _separate_and_write(
            claim, library, root, keep_file=quota > 0
        )
        replaced = complete_stem_job(claim.track_id, analysis, stem_file=record)
    except Exception as error:
        log.warning(
            "Smart Mix stems failed for track %s (%s)",
            claim.track_id,
            claim.path,
            exc_info=True,
        )
        fail_stem_job(claim.track_id, str(error), max_attempts=MAX_ATTEMPTS)
        return {**result, "state": "failed", "reason": str(error)[:300]}
    if replaced:
        (root / replaced).unlink(missing_ok=True)
    freed = enforce_stem_quota(quota, root=root)
    emit_task_event(
        task_id,
        "info",
        {
            "message": "Smart Mix stems ready",
            "track_id": claim.track_id,
            "bytes": record.bytes if record else 0,
        },
    )
    return {
        **result,
        "state": "ready",
        "bytes": record.bytes if record else 0,
        "evicted_bytes": freed,
    }


def _separate_and_write(
    claim: StemJobClaim, library: str, root: Path, *, keep_file: bool
) -> tuple[StemAnalysis, StemFileRecord | None]:
    threads = separation.separation_threads()
    with separation.separate(
        claim.path, threads=threads, scratch=scratch_directory(library)
    ) as stems:
        if stems.source_revision != claim.source_revision:
            raise separation.SeparationError(
                "The file changed since its Smart Mix profile"
            )
        beats = separation.drum_beats(stems)
        analysis = separation.analyze_stems(stems, drum_beats_ms=beats)
        # The analysis describes the file the profile describes, or nothing is stored.
        if smart_mix_source_revision(claim.path) != claim.source_revision:
            raise separation.SeparationError("The file changed during separation")
        record = None
        if keep_file:
            name = stem_file_name(claim.track_id, claim.source_revision)
            size = write_stem_file(stems, root / name, threads=threads)
            record = StemFileRecord(
                path=name,
                bytes=size,
                separator_model=separation.SEPARATOR_MODEL,
                separator_version=separation.SEPARATOR_VERSION,
                source_revision=claim.source_revision,
            )
    return analysis, record


def _sweep(library: str) -> None:
    try:
        sweep_stem_directory(
            writable_stems_directory(library), min_age_seconds=SWEEP_MIN_AGE_SECONDS
        )
    except Exception:
        log.warning("Sweeping the stems directory failed", exc_info=True)


SMART_MIX_STEMS_TASK_HANDLERS: dict[str, TaskHandler] = {
    STEM_TASK_TYPE: _handle_analyze_playlist_stems,
}

__all__ = [
    "BACKFILL_WAIT_SECONDS",
    "MAX_ATTEMPTS",
    "MAX_TRACK_SECONDS",
    "PROFILE_WAIT_SECONDS",
    "RETRY_AFTER_SECONDS",
    "SMART_MIX_STEMS_TASK_HANDLERS",
    "TIME_LIMIT_SECONDS",
    "playlist_stem_work_pending",
    "separation_unavailable",
    "wake_stem_task",
]
