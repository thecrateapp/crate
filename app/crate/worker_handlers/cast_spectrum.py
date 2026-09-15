"""Worker-owned generation of compact Cast receiver spectrum artefacts."""

from __future__ import annotations

import logging
import uuid

from crate.cast_spectrum import (
    SpectrumGenerationCancelled,
    generate_spectrum_artifact,
    source_fingerprint,
    spectrum_artifact_relative_path,
)
from crate.db.repositories.cast_spectrum import (
    claim_cast_spectrum_generation,
    complete_cast_spectrum_generation,
    fail_cast_spectrum_generation,
    release_cast_spectrum_generation,
)
from crate.db.repositories.streaming import get_track_delivery_row_by_id
from crate.streaming.paths import data_root
from crate.streaming.service import resolve_source_path
from crate.worker_handlers import TaskHandler, is_cancelled


log = logging.getLogger(__name__)


def _handle_generate_cast_spectrum(task_id: str, params: dict, config: dict) -> dict:
    del config
    try:
        track_id = int(params.get("track_id"))
    except (TypeError, ValueError):
        raise ValueError("track_id is required") from None
    requested_fingerprint = str(params.get("source_fingerprint") or "").strip()
    relative_path = spectrum_artifact_relative_path(requested_fingerprint)

    track = get_track_delivery_row_by_id(track_id)
    if track is None:
        raise ValueError(f"Track {track_id} does not exist")
    source_path = resolve_source_path(track)
    if source_path is None or not source_path.is_file():
        raise FileNotFoundError(f"Spectrum source for track {track_id} was not found")
    if source_fingerprint(track, source_path) != requested_fingerprint:
        return {"status": "stale_source"}

    owner_token = str(uuid.uuid5(uuid.NAMESPACE_URL, f"crate:cast-spectrum:{task_id}"))
    claim = claim_cast_spectrum_generation(
        track_id,
        requested_fingerprint,
        generation_token=owner_token,
    )
    if claim is None:
        return {"status": "not_claimed"}
    generation_token = str(claim["generation_token"])
    destination = data_root() / relative_path

    if is_cancelled(task_id):
        release_cast_spectrum_generation(
            track_id, requested_fingerprint, generation_token
        )
        return {"status": "cancelled"}

    try:
        result = generate_spectrum_artifact(
            source_path,
            destination,
            cancelled=lambda: is_cancelled(task_id),
        )
        if is_cancelled(task_id):
            destination.unlink(missing_ok=True)
            release_cast_spectrum_generation(
                track_id, requested_fingerprint, generation_token
            )
            return {"status": "cancelled"}
        completed = complete_cast_spectrum_generation(
            track_id,
            requested_fingerprint,
            generation_token,
            artifact_path=relative_path.as_posix(),
            artifact_etag=result.etag,
            frame_count=result.frame_count,
            duration_ms=result.duration_ms,
            byte_size=result.byte_size,
        )
        if not completed:
            destination.unlink(missing_ok=True)
            return {"status": "stale_claim"}
    except SpectrumGenerationCancelled:
        release_cast_spectrum_generation(
            track_id, requested_fingerprint, generation_token
        )
        return {"status": "cancelled"}
    except Exception as exc:
        try:
            fail_cast_spectrum_generation(
                track_id,
                requested_fingerprint,
                generation_token,
                str(exc),
            )
        except Exception:
            log.exception("Failed to persist Cast spectrum generation failure")
        raise

    try:
        from crate.metrics import record

        record("cast.spectrum.generated", 1, {"format_version": "1"})
        record("cast.spectrum.bytes", result.byte_size, {"format_version": "1"})
    except Exception:
        log.debug("Failed to record Cast spectrum metrics", exc_info=True)
    return {
        "status": "ready",
        "track_id": track_id,
        "artifact_path": relative_path.as_posix(),
        "frame_count": result.frame_count,
        "duration_ms": result.duration_ms,
        "byte_size": result.byte_size,
    }


CAST_SPECTRUM_TASK_HANDLERS: dict[str, TaskHandler] = {
    "generate_cast_spectrum": _handle_generate_cast_spectrum,
}
