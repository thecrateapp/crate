"""Persistence helpers for analysis and bliss pipeline results."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
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
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.models import MixProfileQuality, TrackMixProfileDraft


SMART_MIX_PIPELINE = "smart_mix"
SMART_MIX_ANALYZER_VERSION = "smart-mix-v1"
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
                try:
                    with session.begin_nested():
                        _store_smart_mix_profile_result(
                            session,
                            int(track_id),
                            Path(path),
                            _draft_from_payload(payload),
                        )
                except Exception as exc:
                    log.warning(
                        "Smart Mix profile persistence failed for %s",
                        path,
                        exc_info=True,
                    )
                    _record_smart_mix_failure(
                        session,
                        int(track_id),
                        Path(path),
                        str(exc),
                    )
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


def smart_mix_source_revision(path: str | Path) -> str:
    source = Path(path)
    try:
        stat = source.stat()
        identity = f"{stat.st_size}:{stat.st_mtime_ns}"
    except OSError:
        identity = f"missing:{source}"
    return hashlib.sha256(identity.encode()).hexdigest()


def store_smart_mix_profile_result(
    track_id: int,
    path: str | Path,
    draft: TrackMixProfileDraft,
) -> bool:
    with transaction_scope() as session:
        return _store_smart_mix_profile_result(session, track_id, Path(path), draft)


def _store_smart_mix_profile_result(
    session,
    track_id: int,
    path: Path,
    draft: TrackMixProfileDraft,
) -> bool:
    source_revision = smart_mix_source_revision(path)
    current = session.execute(
        select(
            TrackMixProfileRow.profile_version,
            TrackMixProfileRow.source_revision,
            TrackMixProfileRow.analyzer_version,
            TrackMixProfileRow.quality,
        ).where(TrackMixProfileRow.track_id == track_id)
    ).first()
    if (
        current
        and current.profile_version == 1
        and current.source_revision == source_revision
        and (current.analyzer_version == draft.analyzer_version)
        and current.quality != MixProfileQuality.UNAVAILABLE.value
    ):
        _complete_smart_mix_state(session, track_id)
        return False
    stored = upsert_track_mix_profile_draft(
        track_id,
        source_revision,
        draft,
        session=session,
    )
    _complete_smart_mix_state(session, track_id)
    return stored


def record_smart_mix_failure(
    track_id: int,
    path: str | Path,
    reason: str,
) -> None:
    with transaction_scope() as session:
        _record_smart_mix_failure(session, track_id, Path(path), reason)


def _record_smart_mix_failure(
    session,
    track_id: int,
    path: Path,
    reason: str,
) -> None:
    current_quality = session.execute(
        select(TrackMixProfileRow.quality).where(
            TrackMixProfileRow.track_id == track_id
        )
    ).scalar_one_or_none()
    if current_quality is None:
        upsert_track_mix_profile_draft(
            track_id,
            smart_mix_source_revision(path),
            TrackMixProfileDraft(
                analyzer="crate-python",
                analyzer_version=SMART_MIX_ANALYZER_VERSION,
                duration_ms=0,
                quality=MixProfileQuality.UNAVAILABLE,
            ),
            session=session,
        )
    session.execute(
        text(
            """
            INSERT INTO track_processing_state (
                track_id, pipeline, state, attempts, priority,
                last_error, updated_at
            )
            VALUES (
                :track_id, :pipeline, 'failed', 1, 5,
                :last_error, NOW()
            )
            ON CONFLICT (track_id, pipeline) DO UPDATE SET
                state = 'failed',
                claimed_by = NULL,
                claimed_at = NULL,
                last_error = EXCLUDED.last_error,
                updated_at = NOW()
            """
        ),
        {
            "track_id": track_id,
            "pipeline": SMART_MIX_PIPELINE,
            "last_error": str(reason)[:2_000],
        },
    )


def _complete_smart_mix_state(session, track_id: int) -> None:
    session.execute(
        text(
            """
            INSERT INTO track_processing_state (
                track_id, pipeline, state, attempts, priority,
                last_error, completed_at, updated_at
            )
            VALUES (
                :track_id, :pipeline, 'done', 1, 5,
                NULL, NOW(), NOW()
            )
            ON CONFLICT (track_id, pipeline) DO UPDATE SET
                state = 'done',
                claimed_by = NULL,
                claimed_at = NULL,
                last_error = NULL,
                completed_at = NOW(),
                updated_at = NOW()
            """
        ),
        {"track_id": track_id, "pipeline": SMART_MIX_PIPELINE},
    )


def _draft_from_payload(payload: dict[str, Any]) -> TrackMixProfileDraft:
    def value(snake_case: str, camel_case: str) -> Any:
        return payload.get(snake_case, payload.get(camel_case))

    return TrackMixProfileDraft(
        analyzer=str(value("analyzer", "analyzer") or "crate-rust"),
        analyzer_version=str(
            value("analyzer_version", "analyzerVersion") or SMART_MIX_ANALYZER_VERSION
        ),
        duration_ms=int(value("duration_ms", "durationMs") or 0),
        quality=value("quality", "quality") or MixProfileQuality.PARTIAL,
        bpm=value("bpm", "bpm"),
        bpm_confidence=value("bpm_confidence", "bpmConfidence"),
        tempo_stability=value("tempo_stability", "tempoStability"),
        beat_anchor_ms=value("beat_anchor_ms", "beatAnchorMs"),
        downbeat_anchor_ms=value("downbeat_anchor_ms", "downbeatAnchorMs"),
        time_signature=value("time_signature", "timeSignature"),
        beat_grid_ms=tuple(value("beat_grid_ms", "beatGridMs") or ()),
        key=value("key", "key"),
        scale=value("scale", "scale"),
        camelot=value("camelot", "camelot"),
        key_confidence=value("key_confidence", "keyConfidence"),
        intro_cue_ms=value("intro_cue_ms", "introCueMs"),
        outro_cue_ms=value("outro_cue_ms", "outroCueMs"),
        intro_lufs=value("intro_lufs", "introLufs"),
        outro_lufs=value("outro_lufs", "outroLufs"),
        true_peak_dbfs=value("true_peak_dbfs", "truePeakDbfs"),
        intro_energy=value("intro_energy", "introEnergy"),
        outro_energy=value("outro_energy", "outroEnergy"),
        intro_spectral_density=value("intro_spectral_density", "introSpectralDensity"),
        outro_spectral_density=value("outro_spectral_density", "outroSpectralDensity"),
        global_energy=value("global_energy", "globalEnergy"),
        danceability=value("danceability", "danceability"),
        valence=value("valence", "valence"),
    )


__all__ = [
    "mark_done",
    "mark_failed",
    "record_smart_mix_failure",
    "resolve_smart_mix_track",
    "smart_mix_source_revision",
    "store_analysis_result",
    "store_analysis_results",
    "store_bliss_vector",
    "store_bliss_vectors",
    "store_smart_mix_profile_result",
]
