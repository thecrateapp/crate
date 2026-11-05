"""Analysis write helpers for the library repository."""

from __future__ import annotations

from dataclasses import asdict, replace
from datetime import UTC, datetime
import hashlib
import json
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.repositories.smart_mix import (
    ANY_PROFILE_REVISION,
    stored_structure_confidence,
    upsert_track_mix_profile,
)
from crate.db.tx import optional_scope
from crate.smart_mix.beat_grid import FORMAT_NAME
from crate.smart_mix.models import TrackMixProfile, TrackMixProfileDraft
from crate.smart_mix.versions import PROFILE_SCHEMA_VERSION


def update_track_analysis(
    path: str,
    bpm: float | None,
    key: str | None,
    scale: str | None,
    energy: float | None,
    mood: dict | None,
    danceability: float | None = None,
    valence: float | None = None,
    acousticness: float | None = None,
    instrumentalness: float | None = None,
    loudness: float | None = None,
    dynamic_range: float | None = None,
    spectral_complexity: float | None = None,
    *,
    session: Session | None = None,
) -> None:
    def _impl(s: Session) -> None:
        track = s.execute(
            select(LibraryTrack).where(LibraryTrack.path == path).limit(1)
        ).scalar_one_or_none()
        if track is None:
            return

        track.bpm = bpm
        track.audio_key = key
        track.audio_scale = scale
        track.energy = energy
        track.mood_json = mood
        track.danceability = danceability
        track.valence = valence
        track.acousticness = acousticness
        track.instrumentalness = instrumentalness
        track.loudness = loudness
        track.dynamic_range = dynamic_range
        track.spectral_complexity = spectral_complexity

        s.execute(
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
                VALUES (
                    :track_id,
                    :bpm,
                    :audio_key,
                    :audio_scale,
                    :energy,
                    CAST(:mood_json AS jsonb),
                    :danceability,
                    :valence,
                    :acousticness,
                    :instrumentalness,
                    :loudness,
                    :dynamic_range,
                    :spectral_complexity,
                    NOW()
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
            {
                "track_id": track.id,
                "bpm": bpm,
                "audio_key": key,
                "audio_scale": scale,
                "energy": energy,
                "mood_json": None if mood is None else json.dumps(mood),
                "danceability": danceability,
                "valence": valence,
                "acousticness": acousticness,
                "instrumentalness": instrumentalness,
                "loudness": loudness,
                "dynamic_range": dynamic_range,
                "spectral_complexity": spectral_complexity,
            },
        )

    with optional_scope(session) as s:
        _impl(s)


def upsert_track_mix_profile_draft(
    track_id: int,
    source_revision: str,
    draft: TrackMixProfileDraft,
    *,
    expected_revision: Any = ANY_PROFILE_REVISION,
    session: Session | None = None,
) -> bool:
    def _impl(active_session: Session) -> bool:
        entity_uid = active_session.execute(
            select(LibraryTrack.entity_uid).where(LibraryTrack.id == track_id).limit(1)
        ).scalar_one_or_none()
        if entity_uid is None:
            return False
        # Hash the values as stored, so equal rows always carry equal revisions.
        stored = replace(
            draft,
            structure_confidence=stored_structure_confidence(
                draft.structure_confidence
            ),
        )
        profile_payload = json.dumps(
            asdict(stored),
            default=str,
            separators=(",", ":"),
            sort_keys=True,
        )
        profile_revision = hashlib.sha256(
            f"{PROFILE_SCHEMA_VERSION}:{source_revision}:{profile_payload}".encode()
        ).hexdigest()
        profile = TrackMixProfile(
            track_entity_uid=str(entity_uid),
            profile_version=PROFILE_SCHEMA_VERSION,
            profile_revision=profile_revision,
            analyzer=stored.analyzer,
            analyzer_version=stored.analyzer_version,
            source_revision=source_revision,
            duration_ms=stored.duration_ms,
            quality=stored.quality,
            bpm=stored.bpm,
            bpm_confidence=stored.bpm_confidence,
            tempo_stability=stored.tempo_stability,
            beat_anchor_ms=stored.beat_anchor_ms,
            downbeat_anchor_ms=stored.downbeat_anchor_ms,
            time_signature=stored.time_signature,
            beat_grid_format=FORMAT_NAME if stored.beat_grid_ms else None,
            beat_grid_ms=stored.beat_grid_ms,
            key=stored.key,
            scale=stored.scale,
            camelot=stored.camelot,
            key_confidence=stored.key_confidence,
            intro_cue_ms=stored.intro_cue_ms,
            outro_cue_ms=stored.outro_cue_ms,
            intro_bpm=stored.intro_bpm,
            intro_beat_ms=stored.intro_beat_ms,
            outro_bpm=stored.outro_bpm,
            outro_beat_ms=stored.outro_beat_ms,
            intro_tempo_stability=stored.intro_tempo_stability,
            outro_tempo_stability=stored.outro_tempo_stability,
            intro_downbeat_ms=stored.intro_downbeat_ms,
            outro_downbeat_ms=stored.outro_downbeat_ms,
            intro_lufs=stored.intro_lufs,
            outro_lufs=stored.outro_lufs,
            true_peak_dbfs=stored.true_peak_dbfs,
            intro_energy=stored.intro_energy,
            outro_energy=stored.outro_energy,
            intro_spectral_density=stored.intro_spectral_density,
            outro_spectral_density=stored.outro_spectral_density,
            global_energy=stored.global_energy,
            danceability=stored.danceability,
            valence=stored.valence,
            active_start_ms=stored.active_start_ms,
            active_end_ms=stored.active_end_ms,
            integrated_lufs=stored.integrated_lufs,
            measurement_version=stored.measurement_version,
            phrases=stored.phrases,
            energy_curve=stored.energy_curve,
            vocal_presence=stored.vocal_presence,
            vocal_detector=stored.vocal_detector,
            beat_tracker=stored.beat_tracker,
            structure_confidence=stored.structure_confidence,
            analyzed_at=datetime.now(UTC),
        )
        return upsert_track_mix_profile(
            track_id,
            profile,
            expected_revision=expected_revision,
            session=active_session,
        )

    with optional_scope(session) as active_session:
        return _impl(active_session)


__all__ = ["update_track_analysis", "upsert_track_mix_profile_draft"]
