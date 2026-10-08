"""Persistence helpers for analysis and bliss pipeline results."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from datetime import datetime, timezone
from enum import StrEnum
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import select, text

from crate.db.bliss_vectors import to_pgvector_literal
from crate.db.jobs.artist_bliss_centroids import (
    refresh_artist_bliss_centroids_for_track_ids,
)
from crate.db.jobs.analysis_shared import (
    append_pipeline_event,
    complete_processing_state,
    complete_processing_states,
    mark_ops_snapshot_dirty,
    pipeline_name_for_state_column,
    validate_state_column,
)
from crate.db.orm.smart_mix import TrackMixProfileRow
from crate.db.repositories.library_analysis_writes import (
    upsert_track_mix_profile_draft,
)
from crate.db.repositories.smart_mix import ANY_PROFILE_REVISION
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.models import (
    MixProfileQuality,
    TrackMixProfileDraft,
    mix_profile_draft_from_payload,
)
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


SMART_MIX_PIPELINE = "smart_mix"
SMART_MIX_ANALYZER_VERSION = ANALYZER_VERSION
log = logging.getLogger(__name__)


def mark_done(track_id: int, state_column: str) -> None:
    # col is validated against ALLOWED_STATE_COLUMNS whitelist.
    col = validate_state_column(state_column)
    now = datetime.now(timezone.utc).isoformat()
    extra_set = ""
    if col == "analysis_state":
        extra_set = ", analysis_completed_at = :now"
    elif col == "bliss_state":
        extra_set = ", bliss_computed_at = :now"
    pipeline = pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'done'{extra_set} WHERE id = :id"),
            {"now": now, "id": track_id},
        )
        complete_processing_state(
            session,
            track_id=track_id,
            pipeline=pipeline,
            completed_at=now,
        )
        mark_ops_snapshot_dirty(session)
        append_pipeline_event(
            session, pipeline=pipeline, track_id=track_id, state="done"
        )


def mark_failed(
    track_id: int, state_column: str, error_message: str | None = None
) -> None:
    # col is validated against ALLOWED_STATE_COLUMNS whitelist.
    col = validate_state_column(state_column)
    pipeline = pipeline_name_for_state_column(col)
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE library_tracks SET {col} = 'failed' WHERE id = :id"),
            {"id": track_id},
        )
        session.execute(
            text(
                """
                INSERT INTO track_processing_state (
                    track_id,
                    pipeline,
                    state,
                    claimed_by,
                    claimed_at,
                    attempts,
                    last_error,
                    updated_at
                )
                VALUES (
                    :track_id,
                    :pipeline,
                    'failed',
                    NULL,
                    NULL,
                    1,
                    :last_error,
                    NOW()
                )
                ON CONFLICT (track_id, pipeline) DO UPDATE SET
                    state = 'failed',
                    claimed_by = NULL,
                    claimed_at = NULL,
                    last_error = COALESCE(:last_error, track_processing_state.last_error),
                    updated_at = NOW()
                """
            ),
            {
                "track_id": track_id,
                "pipeline": pipeline,
                "last_error": error_message,
            },
        )
        mark_ops_snapshot_dirty(session)
        append_pipeline_event(
            session,
            pipeline=pipeline,
            track_id=track_id,
            state="failed",
            error_message=error_message,
        )


def store_bliss_vector(track_id: int, vector: list[float]) -> None:
    store_bliss_vectors({track_id: vector})


def store_bliss_vectors(vectors_by_track_id: dict[int, list[float]]) -> None:
    if not vectors_by_track_id:
        return

    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "track_id": int(track_id),
            "vector": vector,
            "vector_literal": to_pgvector_literal(vector),
        }
        for track_id, vector in vectors_by_track_id.items()
        if track_id and vector
    ]
    if not rows:
        return

    with transaction_scope() as session:
        rows_json = json.dumps(rows, default=str)
        session.execute(
            text(
                """
                WITH rows AS (
                    SELECT track_id, vector, vector_literal
                    FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                        track_id INTEGER,
                        vector DOUBLE PRECISION[],
                        vector_literal TEXT
                    )
                )
                UPDATE library_tracks lt
                SET bliss_vector = rows.vector,
                    bliss_embedding = CAST(rows.vector_literal AS vector(20)),
                    bliss_state = 'done',
                    bliss_computed_at = :now
                FROM rows
                WHERE lt.id = rows.track_id
                """
            ),
            {"rows_json": rows_json, "now": now},
        )
        session.execute(
            text(
                """
                INSERT INTO track_bliss_embeddings (track_id, bliss_vector, bliss_embedding, updated_at)
                SELECT
                    rows.track_id,
                    rows.vector,
                    CAST(rows.vector_literal AS vector(20)),
                    :updated_at
                FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                    track_id INTEGER,
                    vector DOUBLE PRECISION[],
                    vector_literal TEXT
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bliss_vector = EXCLUDED.bliss_vector,
                    bliss_embedding = EXCLUDED.bliss_embedding,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {"rows_json": rows_json, "updated_at": now},
        )
        complete_processing_states(
            session,
            track_ids=[row["track_id"] for row in rows],
            pipeline="bliss",
            completed_at=now,
        )
        for row in rows:
            append_pipeline_event(
                session, pipeline="bliss", track_id=row["track_id"], state="done"
            )
        refresh_artist_bliss_centroids_for_track_ids(
            session, [row["track_id"] for row in rows]
        )
        mark_ops_snapshot_dirty(session)


def store_analysis_result(track_id: int, path: str, result: dict) -> None:
    store_analysis_results([(track_id, path, result)])


def store_analysis_results(results: list[tuple[int, str, dict]]) -> None:
    if not results:
        return

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for track_id, _path, result in results:
        rows.append(
            {
                "track_id": int(track_id),
                "bpm": result["bpm"],
                "audio_key": result.get("key"),
                "audio_scale": result.get("scale"),
                "energy": result.get("energy"),
                "mood_json": result.get("mood"),
                "danceability": result.get("danceability"),
                "valence": result.get("valence"),
                "acousticness": result.get("acousticness"),
                "instrumentalness": result.get("instrumentalness"),
                "loudness": result.get("loudness"),
                "dynamic_range": result.get("dynamic_range"),
                "spectral_complexity": result.get("spectral_complexity"),
            }
        )

    with transaction_scope() as session:
        rows_json = json.dumps(rows, default=str)
        session.execute(
            text(
                """
                WITH rows AS (
                    SELECT
                        track_id,
                        bpm,
                        audio_key,
                        audio_scale,
                        energy,
                        mood_json,
                        danceability,
                        valence,
                        acousticness,
                        instrumentalness,
                        loudness,
                        dynamic_range,
                        spectral_complexity
                    FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                        track_id INTEGER,
                        bpm DOUBLE PRECISION,
                        audio_key TEXT,
                        audio_scale TEXT,
                        energy DOUBLE PRECISION,
                        mood_json JSONB,
                        danceability DOUBLE PRECISION,
                        valence DOUBLE PRECISION,
                        acousticness DOUBLE PRECISION,
                        instrumentalness DOUBLE PRECISION,
                        loudness DOUBLE PRECISION,
                        dynamic_range DOUBLE PRECISION,
                        spectral_complexity DOUBLE PRECISION
                    )
                )
                UPDATE library_tracks lt
                SET bpm = rows.bpm,
                    audio_key = rows.audio_key,
                    audio_scale = rows.audio_scale,
                    energy = rows.energy,
                    mood_json = rows.mood_json,
                    danceability = rows.danceability,
                    valence = rows.valence,
                    acousticness = rows.acousticness,
                    instrumentalness = rows.instrumentalness,
                    loudness = rows.loudness,
                    dynamic_range = rows.dynamic_range,
                    spectral_complexity = rows.spectral_complexity,
                    analysis_state = 'done',
                    analysis_completed_at = :now
                FROM rows
                WHERE lt.id = rows.track_id
                """
            ),
            {"rows_json": rows_json, "now": now},
        )
        session.execute(
            text(
                """
                INSERT INTO track_analysis_features (
                    track_id,
                    bpm,
                    audio_key,
                    audio_scale,
                    energy,
                    mood_json,
                    danceability,
                    valence,
                    acousticness,
                    instrumentalness,
                    loudness,
                    dynamic_range,
                    spectral_complexity,
                    updated_at
                )
                SELECT
                    rows.track_id,
                    rows.bpm,
                    rows.audio_key,
                    rows.audio_scale,
                    rows.energy,
                    rows.mood_json,
                    rows.danceability,
                    rows.valence,
                    rows.acousticness,
                    rows.instrumentalness,
                    rows.loudness,
                    rows.dynamic_range,
                    rows.spectral_complexity,
                    :updated_at
                FROM jsonb_to_recordset(CAST(:rows_json AS jsonb)) AS rows(
                    track_id INTEGER,
                    bpm DOUBLE PRECISION,
                    audio_key TEXT,
                    audio_scale TEXT,
                    energy DOUBLE PRECISION,
                    mood_json JSONB,
                    danceability DOUBLE PRECISION,
                    valence DOUBLE PRECISION,
                    acousticness DOUBLE PRECISION,
                    instrumentalness DOUBLE PRECISION,
                    loudness DOUBLE PRECISION,
                    dynamic_range DOUBLE PRECISION,
                    spectral_complexity DOUBLE PRECISION
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bpm = EXCLUDED.bpm,
                    audio_key = EXCLUDED.audio_key,
                    audio_scale = EXCLUDED.audio_scale,
                    energy = EXCLUDED.energy,
                    mood_json = EXCLUDED.mood_json,
                    danceability = EXCLUDED.danceability,
                    valence = EXCLUDED.valence,
                    acousticness = EXCLUDED.acousticness,
                    instrumentalness = EXCLUDED.instrumentalness,
                    loudness = EXCLUDED.loudness,
                    dynamic_range = EXCLUDED.dynamic_range,
                    spectral_complexity = EXCLUDED.spectral_complexity,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {"rows_json": rows_json, "updated_at": now},
        )
        complete_processing_states(
            session,
            track_ids=[row["track_id"] for row in rows],
            pipeline="analysis",
            completed_at=now,
        )
        for row in rows:
            append_pipeline_event(
                session, pipeline="analysis", track_id=row["track_id"], state="done"
            )
        for track_id, path, result in results:
            payload = result.get("mix_profile") or result.get("mixProfile")
            if isinstance(payload, dict):
                current_revision = smart_mix_source_revision(path)
                captured_revision = result.get("smart_mix_source_revision")
                if captured_revision and captured_revision != current_revision:
                    log.info("Smart Mix source changed during analysis: %s", path)
                    continue
                capture = SmartMixCapture(
                    track_id=int(track_id),
                    path=str(path),
                    source_revision=current_revision,
                    expected_profile_revision=ANY_PROFILE_REVISION,
                )
                try:
                    with session.begin_nested():
                        _publish_smart_mix_profile(
                            session,
                            capture,
                            mix_profile_draft_from_payload(payload),
                        )
                except Exception as exc:
                    log.warning(
                        "Smart Mix profile persistence failed for %s",
                        path,
                        exc_info=True,
                    )
                    _record_smart_mix_failure(session, capture, str(exc))
        mark_ops_snapshot_dirty(session)


def resolve_smart_mix_track(
    *,
    track_id: int | None = None,
    track_entity_uid: str | None = None,
) -> dict[str, Any] | None:
    if not track_id and not track_entity_uid:
        return None
    params: dict[str, Any] = {}
    if track_id and track_entity_uid:
        predicate = "id = :track_id AND entity_uid = CAST(:track_entity_uid AS uuid)"
        params["track_id"] = int(track_id)
        params["track_entity_uid"] = str(track_entity_uid)
    elif track_id:
        predicate = "id = :track_id"
        params["track_id"] = int(track_id)
    else:
        predicate = "entity_uid = CAST(:track_entity_uid AS uuid)"
        params["track_entity_uid"] = str(track_entity_uid)
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    f"""
                    SELECT id, entity_uid::text AS entity_uid, path, artist, album, title
                    FROM library_tracks
                    WHERE {predicate}
                    ORDER BY id
                    LIMIT 1
                    """
                ),
                params,
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


class SmartMixPublication(StrEnum):
    PUBLISHED = "published"
    UNCHANGED = "unchanged"
    SUPERSEDED = "superseded"
    LOST_CLAIM = "lost_claim"
    SOURCE_CHANGED = "source_changed"
    TRACK_MOVED = "track_moved"


@dataclass(frozen=True, slots=True)
class SmartMixCapture:
    track_id: int
    path: str
    source_revision: str
    expected_profile_revision: Any
    claim_token: str | None = None


_QUALITY_RANK = {
    MixProfileQuality.UNAVAILABLE: 0,
    MixProfileQuality.LEGACY: 1,
    MixProfileQuality.PARTIAL: 2,
    MixProfileQuality.FULL: 3,
}
_RUST_ANALYZER = "crate-rust"


def smart_mix_source_revision(path: str | Path) -> str:
    source = Path(path)
    try:
        stat = source.stat()
        identity = f"{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ino}"
    except OSError:
        identity = f"missing:{source}"
    return hashlib.sha256(identity.encode()).hexdigest()


def capture_smart_mix_source(
    track_id: int,
    path: str | Path,
    *,
    claim_token: str | None = None,
) -> SmartMixCapture:
    source_revision = smart_mix_source_revision(path)
    with read_scope() as session:
        expected_profile_revision = session.execute(
            select(TrackMixProfileRow.profile_revision).where(
                TrackMixProfileRow.track_id == int(track_id)
            )
        ).scalar_one_or_none()
    return SmartMixCapture(
        track_id=int(track_id),
        path=str(path),
        source_revision=source_revision,
        expected_profile_revision=expected_profile_revision,
        claim_token=claim_token,
    )


def publish_smart_mix_profile(
    capture: SmartMixCapture,
    draft: TrackMixProfileDraft,
) -> SmartMixPublication:
    if smart_mix_source_revision(capture.path) != capture.source_revision:
        with transaction_scope() as session:
            _release_smart_mix_claim(session, capture)
        return SmartMixPublication.SOURCE_CHANGED
    with transaction_scope() as session:
        return _publish_smart_mix_profile(session, capture, draft)


def store_smart_mix_profile_result(
    track_id: int,
    path: str | Path,
    draft: TrackMixProfileDraft,
) -> bool:
    capture = capture_smart_mix_source(track_id, path)
    return publish_smart_mix_profile(capture, draft) is SmartMixPublication.PUBLISHED


def _publish_smart_mix_profile(
    session,
    capture: SmartMixCapture,
    draft: TrackMixProfileDraft,
) -> SmartMixPublication:
    if capture.claim_token is not None and not _owns_smart_mix_claim(session, capture):
        return SmartMixPublication.LOST_CLAIM
    track_path = session.execute(
        text("SELECT path FROM library_tracks WHERE id = :track_id FOR SHARE"),
        {"track_id": capture.track_id},
    ).scalar_one_or_none()
    if track_path != capture.path:
        _release_smart_mix_claim(session, capture)
        return SmartMixPublication.TRACK_MOVED
    current = session.execute(
        select(
            TrackMixProfileRow.profile_revision,
            TrackMixProfileRow.profile_version,
            TrackMixProfileRow.source_revision,
            TrackMixProfileRow.analyzer,
            TrackMixProfileRow.analyzer_version,
            TrackMixProfileRow.quality,
        )
        .where(TrackMixProfileRow.track_id == capture.track_id)
        .with_for_update()
    ).first()
    current_revision = current.profile_revision if current else None
    if (
        capture.expected_profile_revision is not ANY_PROFILE_REVISION
        and current_revision != capture.expected_profile_revision
    ):
        _complete_smart_mix_claim(session, capture)
        return SmartMixPublication.SUPERSEDED
    if not _replaces_current_profile(current, capture.source_revision, draft):
        _complete_smart_mix_claim(session, capture)
        return SmartMixPublication.UNCHANGED
    stored = upsert_track_mix_profile_draft(
        capture.track_id,
        capture.source_revision,
        draft,
        expected_revision=current_revision,
        session=session,
    )
    _complete_smart_mix_claim(session, capture)
    return SmartMixPublication.PUBLISHED if stored else SmartMixPublication.SUPERSEDED


def _replaces_current_profile(
    current: Any,
    source_revision: str,
    draft: TrackMixProfileDraft,
) -> bool:
    if current is None:
        return True
    if (
        current.analyzer_version == ANALYZER_VERSION
        and current.quality != MixProfileQuality.UNAVAILABLE
        and draft.analyzer_version != ANALYZER_VERSION
    ):
        return False
    if (
        current.profile_version != PROFILE_SCHEMA_VERSION
        or current.source_revision != source_revision
        or current.analyzer_version != draft.analyzer_version
    ):
        return True
    current_rank = _QUALITY_RANK[MixProfileQuality(current.quality)]
    draft_rank = _QUALITY_RANK[MixProfileQuality(draft.quality)]
    if draft_rank != current_rank:
        return draft_rank > current_rank
    return draft.analyzer == _RUST_ANALYZER and current.analyzer != _RUST_ANALYZER


def record_smart_mix_failure(
    track_id: int,
    path: str | Path,
    reason: str,
    *,
    claim_token: str | None = None,
) -> None:
    capture = SmartMixCapture(
        track_id=int(track_id),
        path=str(path),
        source_revision=smart_mix_source_revision(path),
        expected_profile_revision=ANY_PROFILE_REVISION,
        claim_token=claim_token,
    )
    with transaction_scope() as session:
        _record_smart_mix_failure(session, capture, reason)


def _record_smart_mix_failure(
    session,
    capture: SmartMixCapture,
    reason: str,
) -> None:
    if capture.claim_token is not None and not _owns_smart_mix_claim(session, capture):
        return
    current_quality = session.execute(
        select(TrackMixProfileRow.quality).where(
            TrackMixProfileRow.track_id == capture.track_id
        )
    ).scalar_one_or_none()
    if current_quality is None:
        upsert_track_mix_profile_draft(
            capture.track_id,
            capture.source_revision,
            TrackMixProfileDraft(
                analyzer="crate-python",
                analyzer_version=SMART_MIX_ANALYZER_VERSION,
                duration_ms=0,
                quality=MixProfileQuality.UNAVAILABLE,
            ),
            expected_revision=None,
            session=session,
        )
    _set_smart_mix_state(session, capture, "failed", last_error=str(reason)[:2_000])


def _owns_smart_mix_claim(session, capture: SmartMixCapture) -> bool:
    return (
        session.execute(
            text(
                """
                SELECT 1
                FROM track_processing_state
                WHERE track_id = :track_id
                  AND pipeline = :pipeline
                  AND state = 'analyzing'
                  AND claimed_by = :claim_token
                FOR UPDATE
                """
            ),
            {
                "track_id": capture.track_id,
                "pipeline": SMART_MIX_PIPELINE,
                "claim_token": capture.claim_token,
            },
        ).first()
        is not None
    )


def _complete_smart_mix_claim(session, capture: SmartMixCapture) -> None:
    _set_smart_mix_state(session, capture, "done")


def _release_smart_mix_claim(session, capture: SmartMixCapture) -> None:
    if capture.claim_token is None:
        return
    session.execute(
        text(
            """
            UPDATE track_processing_state
            SET state = 'pending',
                claimed_by = NULL,
                claimed_at = NULL,
                attempts = GREATEST(attempts - 1, 0),
                updated_at = NOW()
            WHERE track_id = :track_id
              AND pipeline = :pipeline
              AND claimed_by = :claim_token
            """
        ),
        {
            "track_id": capture.track_id,
            "pipeline": SMART_MIX_PIPELINE,
            "claim_token": capture.claim_token,
        },
    )


def _set_smart_mix_state(
    session,
    capture: SmartMixCapture,
    state: str,
    *,
    last_error: str | None = None,
) -> None:
    params = {
        "track_id": capture.track_id,
        "pipeline": SMART_MIX_PIPELINE,
        "state": state,
        "last_error": last_error,
        "claim_token": capture.claim_token,
    }
    if capture.claim_token is not None:
        session.execute(
            text(
                """
                UPDATE track_processing_state
                SET state = :state,
                    claimed_by = NULL,
                    claimed_at = NULL,
                    last_error = :last_error,
                    completed_at = CASE WHEN :state = 'done' THEN NOW() END,
                    updated_at = NOW()
                WHERE track_id = :track_id
                  AND pipeline = :pipeline
                  AND claimed_by = :claim_token
                """
            ),
            params,
        )
        return
    session.execute(
        text(
            """
            INSERT INTO track_processing_state (
                track_id, pipeline, state, attempts, priority,
                last_error, completed_at, updated_at
            )
            VALUES (
                :track_id, :pipeline, :state, 1, 5, :last_error,
                CASE WHEN :state = 'done' THEN NOW() END, NOW()
            )
            ON CONFLICT (track_id, pipeline) DO UPDATE SET
                state = EXCLUDED.state,
                claimed_by = NULL,
                claimed_at = NULL,
                last_error = EXCLUDED.last_error,
                completed_at = EXCLUDED.completed_at,
                updated_at = NOW()
            WHERE track_processing_state.state <> 'analyzing'
               OR track_processing_state.claimed_at < NOW() - INTERVAL '2 hours'
            """
        ),
        params,
    )


__all__ = [
    "mark_done",
    "mark_failed",
    "SmartMixCapture",
    "SmartMixPublication",
    "capture_smart_mix_source",
    "publish_smart_mix_profile",
    "record_smart_mix_failure",
    "resolve_smart_mix_track",
    "smart_mix_source_revision",
    "store_analysis_result",
    "store_analysis_results",
    "store_bliss_vector",
    "store_bliss_vectors",
    "store_smart_mix_profile_result",
]
