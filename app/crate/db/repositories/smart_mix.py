from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC
from typing import Any, Sequence

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import defer

from crate.db.orm.library import LibraryTrack
from crate.db.orm.smart_mix import TrackMixProfileRow
from crate.db.repositories.library_shared import coerce_uuid
from crate.db.tx import optional_scope, read_scope
from crate.smart_mix.beat_grid import (
    FORMAT_NAME,
    decode_beat_grid,
    encode_beat_grid,
)
from crate.smart_mix.models import MixProfileQuality, TrackMixProfile


def upsert_track_mix_profile(
    track_id: int,
    profile: TrackMixProfile,
    *,
    session=None,
) -> bool:
    beat_grid_data = _encode_profile_grid(profile)
    values = _profile_values(track_id, profile, beat_grid_data)
    statement = insert(TrackMixProfileRow).values(**values)
    excluded = statement.excluded
    update_values = {
        key: getattr(excluded, key) for key in values if key not in {"track_id"}
    }
    update_values["updated_at"] = func.now()
    statement = statement.on_conflict_do_update(
        index_elements=[TrackMixProfileRow.track_id],
        set_=update_values,
        where=(TrackMixProfileRow.profile_revision != excluded.profile_revision),
    ).returning(TrackMixProfileRow.track_id)
    with optional_scope(session) as active_session:
        return active_session.execute(statement).scalar_one_or_none() is not None


def get_track_mix_profile(
    track_id: int,
    *,
    include_beat_grid: bool = False,
    session=None,
) -> TrackMixProfile | None:
    profiles = get_track_mix_profiles(
        [track_id],
        include_beat_grid=include_beat_grid,
        session=session,
    )
    return profiles[0]


def get_track_mix_profiles(
    track_ids: Sequence[int],
    *,
    include_beat_grid: bool = False,
    session=None,
) -> list[TrackMixProfile | None]:
    requested_ids = [int(track_id) for track_id in track_ids]
    if not requested_ids:
        return []

    statement = (
        select(
            TrackMixProfileRow,
            LibraryTrack.entity_uid,
            LibraryTrack.duration,
        )
        .join(LibraryTrack, LibraryTrack.id == TrackMixProfileRow.track_id)
        .where(TrackMixProfileRow.track_id.in_(set(requested_ids)))
    )
    if not include_beat_grid:
        statement = statement.options(defer(TrackMixProfileRow.beat_grid_data))

    manager = nullcontext(session) if session is not None else read_scope()
    with manager as active_session:
        rows = active_session.execute(statement).all()
        by_track_id = {
            row.track_id: _row_to_profile(
                row,
                entity_uid,
                duration,
                include_beat_grid=include_beat_grid,
            )
            for row, entity_uid, duration in rows
        }
    return [by_track_id.get(track_id) for track_id in requested_ids]


def get_track_mix_profile_by_entity_uid(
    entity_uid: str,
    *,
    include_beat_grid: bool = False,
    session=None,
) -> TrackMixProfile | None:
    profiles = get_track_mix_profiles_by_entity_uids(
        [entity_uid],
        include_beat_grid=include_beat_grid,
        session=session,
    )
    return profiles[0]


def get_track_mix_profiles_by_entity_uids(
    entity_uids: Sequence[str],
    *,
    include_beat_grid: bool = False,
    session=None,
) -> list[TrackMixProfile | None]:
    requested_uids = [coerce_uuid(entity_uid) for entity_uid in entity_uids]
    if not requested_uids:
        return []

    statement = (
        select(
            TrackMixProfileRow,
            LibraryTrack.entity_uid,
            LibraryTrack.duration,
        )
        .join(LibraryTrack, LibraryTrack.id == TrackMixProfileRow.track_id)
        .where(LibraryTrack.entity_uid.in_(set(requested_uids)))
    )
    if not include_beat_grid:
        statement = statement.options(defer(TrackMixProfileRow.beat_grid_data))

    manager = nullcontext(session) if session is not None else read_scope()
    with manager as active_session:
        rows = active_session.execute(statement).all()
        by_entity_uid = {
            str(entity_uid): _row_to_profile(
                row,
                entity_uid,
                duration,
                include_beat_grid=include_beat_grid,
            )
            for row, entity_uid, duration in rows
        }
    return [by_entity_uid.get(str(entity_uid)) for entity_uid in requested_uids]


def _encode_profile_grid(profile: TrackMixProfile) -> bytes | None:
    if not profile.beat_grid_ms:
        if profile.beat_grid_format is not None:
            raise ValueError("beat_grid_format requires a non-empty beat grid")
        return None
    if profile.beat_grid_format != FORMAT_NAME:
        raise ValueError(f"Unsupported beat grid format: {profile.beat_grid_format}")
    return encode_beat_grid(profile.beat_grid_ms)


def _profile_values(
    track_id: int,
    profile: TrackMixProfile,
    beat_grid_data: bytes | None,
) -> dict[str, Any]:
    return {
        "track_id": track_id,
        "profile_version": profile.profile_version,
        "profile_revision": profile.profile_revision,
        "analyzer": profile.analyzer,
        "analyzer_version": profile.analyzer_version,
        "source_revision": profile.source_revision,
        "quality": MixProfileQuality(profile.quality).value,
        "bpm": profile.bpm,
        "bpm_confidence": profile.bpm_confidence,
        "tempo_stability": profile.tempo_stability,
        "beat_anchor_ms": profile.beat_anchor_ms,
        "downbeat_anchor_ms": profile.downbeat_anchor_ms,
        "time_signature": profile.time_signature,
        "beat_grid_format": profile.beat_grid_format,
        "beat_grid_data": beat_grid_data,
        "audio_key": profile.key,
        "audio_scale": profile.scale,
        "key_camelot": profile.camelot,
        "key_confidence": profile.key_confidence,
        "intro_cue_ms": profile.intro_cue_ms,
        "outro_cue_ms": profile.outro_cue_ms,
        "intro_lufs": profile.intro_lufs,
        "outro_lufs": profile.outro_lufs,
        "true_peak_dbfs": profile.true_peak_dbfs,
        "intro_energy": profile.intro_energy,
        "outro_energy": profile.outro_energy,
        "intro_spectral_density": profile.intro_spectral_density,
        "outro_spectral_density": profile.outro_spectral_density,
        "global_energy": profile.global_energy,
        "danceability": profile.danceability,
        "valence": profile.valence,
        "bliss_vector_revision": profile.bliss_vector_revision,
        "analyzed_at": profile.analyzed_at,
    }


def _row_to_profile(
    row: TrackMixProfileRow,
    entity_uid,
    duration_seconds: float | None,
    *,
    include_beat_grid: bool,
) -> TrackMixProfile:
    beat_grid_ms: tuple[int, ...] = ()
    if include_beat_grid and row.beat_grid_data:
        if row.beat_grid_format != FORMAT_NAME:
            raise ValueError(f"Unsupported beat grid format: {row.beat_grid_format}")
        beat_grid_ms = tuple(decode_beat_grid(row.beat_grid_data))
    duration_ms = max(0, round(float(duration_seconds or 0) * 1_000))
    analyzed_at = row.analyzed_at
    if analyzed_at.tzinfo is None:
        analyzed_at = analyzed_at.replace(tzinfo=UTC)
    return TrackMixProfile(
        track_entity_uid=str(entity_uid),
        profile_version=row.profile_version,
        profile_revision=row.profile_revision,
        analyzer=row.analyzer,
        analyzer_version=row.analyzer_version,
        source_revision=row.source_revision,
        duration_ms=duration_ms,
        quality=row.quality,
        bpm=row.bpm,
        bpm_confidence=row.bpm_confidence,
        tempo_stability=row.tempo_stability,
        beat_anchor_ms=row.beat_anchor_ms,
        downbeat_anchor_ms=row.downbeat_anchor_ms,
        time_signature=row.time_signature,
        beat_grid_format=row.beat_grid_format,
        beat_grid_ms=beat_grid_ms,
        key=row.audio_key,
        scale=row.audio_scale,
        camelot=row.key_camelot,
        key_confidence=row.key_confidence,
        intro_cue_ms=row.intro_cue_ms,
        outro_cue_ms=row.outro_cue_ms,
        intro_lufs=row.intro_lufs,
        outro_lufs=row.outro_lufs,
        true_peak_dbfs=row.true_peak_dbfs,
        intro_energy=row.intro_energy,
        outro_energy=row.outro_energy,
        intro_spectral_density=row.intro_spectral_density,
        outro_spectral_density=row.outro_spectral_density,
        global_energy=row.global_energy,
        danceability=row.danceability,
        valence=row.valence,
        bliss_vector_revision=row.bliss_vector_revision,
        analyzed_at=analyzed_at,
    )
