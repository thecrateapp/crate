"""Analysis write helpers for the library repository."""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
import hashlib
import json

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.repositories.smart_mix import upsert_track_mix_profile
from crate.db.tx import optional_scope
from crate.smart_mix.beat_grid import FORMAT_NAME
from crate.smart_mix.models import TrackMixProfile, TrackMixProfileDraft


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
    session: Session | None = None,
) -> bool:
    def _impl(active_session: Session) -> bool:
        entity_uid = active_session.execute(
            select(LibraryTrack.entity_uid).where(LibraryTrack.id == track_id).limit(1)
        ).scalar_one_or_none()
        if entity_uid is None:
            return False
        profile_payload = json.dumps(
            asdict(draft),
            default=str,
            separators=(",", ":"),
            sort_keys=True,
        )
        profile_revision = hashlib.sha256(
            f"1:{source_revision}:{profile_payload}".encode()
        ).hexdigest()
        profile = TrackMixProfile(
            track_entity_uid=str(entity_uid),
            profile_version=1,
            profile_revision=profile_revision,
            analyzer=draft.analyzer,
            analyzer_version=draft.analyzer_version,
            source_revision=source_revision,
            duration_ms=draft.duration_ms,
            quality=draft.quality,
            bpm=draft.bpm,
            bpm_confidence=draft.bpm_confidence,
            tempo_stability=draft.tempo_stability,
            beat_anchor_ms=draft.beat_anchor_ms,
            downbeat_anchor_ms=draft.downbeat_anchor_ms,
            time_signature=draft.time_signature,
            beat_grid_format=FORMAT_NAME if draft.beat_grid_ms else None,
            beat_grid_ms=draft.beat_grid_ms,
            key=draft.key,
            scale=draft.scale,
            camelot=draft.camelot,
            key_confidence=draft.key_confidence,
            intro_cue_ms=draft.intro_cue_ms,
            outro_cue_ms=draft.outro_cue_ms,
            intro_lufs=draft.intro_lufs,
            outro_lufs=draft.outro_lufs,
            true_peak_dbfs=draft.true_peak_dbfs,
            intro_energy=draft.intro_energy,
            outro_energy=draft.outro_energy,
            intro_spectral_density=draft.intro_spectral_density,
            outro_spectral_density=draft.outro_spectral_density,
            global_energy=draft.global_energy,
            danceability=draft.danceability,
            valence=draft.valence,
            analyzed_at=datetime.now(UTC),
        )
        return upsert_track_mix_profile(
            track_id,
            profile,
            session=active_session,
        )

    with optional_scope(session) as active_session:
        return _impl(active_session)


__all__ = ["update_track_analysis", "upsert_track_mix_profile_draft"]
