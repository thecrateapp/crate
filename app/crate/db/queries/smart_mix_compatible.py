from __future__ import annotations

from datetime import UTC
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause

from crate.db.tx import read_scope
from crate.smart_mix.compatible import CompatibleTrackCandidate
from crate.smart_mix.models import TrackMixProfile


_PROFILE_COLUMNS = """
    profile.track_id,
    profile.profile_version,
    profile.profile_revision,
    profile.analyzer,
    profile.analyzer_version,
    profile.source_revision,
    profile.quality,
    profile.bpm,
    profile.bpm_confidence,
    profile.tempo_stability,
    profile.beat_anchor_ms,
    profile.downbeat_anchor_ms,
    profile.time_signature,
    profile.beat_grid_format,
    profile.audio_key,
    profile.audio_scale,
    profile.key_camelot,
    profile.key_confidence,
    profile.intro_cue_ms,
    profile.outro_cue_ms,
    profile.intro_lufs,
    profile.outro_lufs,
    profile.true_peak_dbfs,
    profile.intro_energy,
    profile.outro_energy,
    profile.intro_spectral_density,
    profile.outro_spectral_density,
    profile.global_energy,
    profile.danceability,
    profile.valence,
    profile.bliss_vector_revision,
    profile.analyzed_at,
    track.entity_uid::text AS track_entity_uid,
    track.title,
    track.artist,
    track.album,
    track.duration,
    track.musicbrainz_trackid AS recording_mbid,
    track.bliss_vector,
    COALESCE(NULLIF(track.genre, ''), NULLIF(album.genre, '')) AS genre
"""

_SEED_SQL = text(
    f"""
    SELECT {_PROFILE_COLUMNS}
    FROM library_tracks track
    JOIN library_albums album ON album.id = track.album_id
    JOIN track_mix_profiles profile ON profile.track_id = track.id
    WHERE track.entity_uid = CAST(:entity_uid AS uuid)
      AND album.quarantined_at IS NULL
      AND NULLIF(track.path, '') IS NOT NULL
    LIMIT 1
    """
)

_CANDIDATE_SQL = text(
    f"""
    WITH profile_candidates AS MATERIALIZED (
        SELECT
            profile.track_id,
            profile.profile_version,
            profile.profile_revision,
            profile.analyzer,
            profile.analyzer_version,
            profile.source_revision,
            profile.quality,
            profile.bpm,
            profile.bpm_confidence,
            profile.tempo_stability,
            profile.beat_anchor_ms,
            profile.downbeat_anchor_ms,
            profile.time_signature,
            profile.beat_grid_format,
            profile.audio_key,
            profile.audio_scale,
            profile.key_camelot,
            profile.key_confidence,
            profile.intro_cue_ms,
            profile.outro_cue_ms,
            profile.intro_lufs,
            profile.outro_lufs,
            profile.true_peak_dbfs,
            profile.intro_energy,
            profile.outro_energy,
            profile.intro_spectral_density,
            profile.outro_spectral_density,
            profile.global_energy,
            profile.danceability,
            profile.valence,
            profile.bliss_vector_revision,
            profile.analyzed_at
        FROM track_mix_profiles profile
        WHERE profile.track_id <> :seed_track_id
          AND profile.quality <> 'unavailable'
          AND profile.bpm IS NOT NULL
          AND (
              :seed_bpm IS NULL
              OR profile.bpm BETWEEN :seed_bpm * 0.88 AND :seed_bpm * 1.12
              OR profile.bpm BETWEEN :seed_bpm * 0.44 AND :seed_bpm * 0.56
              OR profile.bpm BETWEEN :seed_bpm * 1.76 AND :seed_bpm * 2.24
          )
          AND (
              :seed_energy IS NULL
              OR profile.global_energy IS NULL
              OR profile.global_energy
                 BETWEEN GREATEST(0.0, :seed_energy - 0.45)
                     AND LEAST(1.0, :seed_energy + 0.45)
          )
        ORDER BY
            CASE
                WHEN :seed_bpm IS NULL THEN 0.0
                ELSE LEAST(
                    ABS(profile.bpm - :seed_bpm),
                    ABS(profile.bpm * 2.0 - :seed_bpm),
                    ABS(profile.bpm * 0.5 - :seed_bpm)
                )
            END,
            CASE
                WHEN :seed_energy IS NULL OR profile.global_energy IS NULL
                    THEN 1.0
                ELSE ABS(profile.global_energy - :seed_energy)
            END,
            profile.track_id
        LIMIT :max_candidates
    )
    SELECT {_PROFILE_COLUMNS}
    FROM profile_candidates profile
    JOIN library_tracks track ON track.id = profile.track_id
    JOIN library_albums album ON album.id = track.album_id
    WHERE album.quarantined_at IS NULL
      AND NULLIF(track.path, '') IS NOT NULL
    ORDER BY
        CASE
            WHEN :seed_bpm IS NULL THEN 0.0
            ELSE LEAST(
                ABS(profile.bpm - :seed_bpm),
                ABS(profile.bpm * 2.0 - :seed_bpm),
                ABS(profile.bpm * 0.5 - :seed_bpm)
            )
        END,
        CASE
            WHEN :seed_energy IS NULL OR profile.global_energy IS NULL THEN 1.0
            ELSE ABS(profile.global_energy - :seed_energy)
        END,
        profile.track_id
    LIMIT :max_candidates
    """
)


def compatible_candidate_statement() -> TextClause:
    return _CANDIDATE_SQL


def get_compatible_track_inputs(
    entity_uid: str,
    *,
    max_candidates: int = 500,
) -> tuple[CompatibleTrackCandidate | None, list[CompatibleTrackCandidate]]:
    capped_candidates = max(1, min(int(max_candidates), 500))
    with read_scope() as session:
        seed_row = (
            session.execute(_SEED_SQL, {"entity_uid": str(entity_uid)})
            .mappings()
            .first()
        )
        if seed_row is None:
            return None, []
        seed = _candidate_from_row(seed_row)
        candidate_rows = (
            session.execute(
                _CANDIDATE_SQL,
                {
                    "seed_track_id": seed.track_id,
                    "seed_bpm": seed.profile.bpm,
                    "seed_energy": seed.profile.global_energy,
                    "max_candidates": capped_candidates,
                },
            )
            .mappings()
            .all()
        )
    return seed, [_candidate_from_row(row) for row in candidate_rows]


def _candidate_from_row(row: Any) -> CompatibleTrackCandidate:
    analyzed_at = row["analyzed_at"]
    if analyzed_at.tzinfo is None:
        analyzed_at = analyzed_at.replace(tzinfo=UTC)
    profile = TrackMixProfile(
        track_entity_uid=str(row["track_entity_uid"]),
        profile_version=int(row["profile_version"]),
        profile_revision=str(row["profile_revision"]),
        analyzer=str(row["analyzer"]),
        analyzer_version=str(row["analyzer_version"]),
        source_revision=str(row["source_revision"]),
        duration_ms=max(0, round(float(row["duration"] or 0.0) * 1_000)),
        quality=str(row["quality"]),
        bpm=row["bpm"],
        bpm_confidence=row["bpm_confidence"],
        tempo_stability=row["tempo_stability"],
        beat_anchor_ms=row["beat_anchor_ms"],
        downbeat_anchor_ms=row["downbeat_anchor_ms"],
        time_signature=row["time_signature"],
        beat_grid_format=row["beat_grid_format"],
        key=row["audio_key"],
        scale=row["audio_scale"],
        camelot=row["key_camelot"],
        key_confidence=row["key_confidence"],
        intro_cue_ms=row["intro_cue_ms"],
        outro_cue_ms=row["outro_cue_ms"],
        intro_lufs=row["intro_lufs"],
        outro_lufs=row["outro_lufs"],
        true_peak_dbfs=row["true_peak_dbfs"],
        intro_energy=row["intro_energy"],
        outro_energy=row["outro_energy"],
        intro_spectral_density=row["intro_spectral_density"],
        outro_spectral_density=row["outro_spectral_density"],
        global_energy=row["global_energy"],
        danceability=row["danceability"],
        valence=row["valence"],
        bliss_vector_revision=row["bliss_vector_revision"],
        analyzed_at=analyzed_at,
    )
    return CompatibleTrackCandidate(
        track_id=int(row["track_id"]),
        track_entity_uid=str(row["track_entity_uid"]),
        title=str(row["title"] or ""),
        artist=str(row["artist"]),
        album=str(row["album"]),
        profile=profile,
        recording_mbid=(str(row["recording_mbid"]) if row["recording_mbid"] else None),
        bliss_vector=tuple(float(value) for value in (row["bliss_vector"] or ())),
        genres=_parse_genres(row["genre"]),
        playable=True,
    )


def _parse_genres(value: str | None) -> frozenset[str]:
    return frozenset(
        item.strip().casefold()
        for item in re.split(r"[,;/|]", value or "")
        if item.strip()
    )


__all__ = [
    "compatible_candidate_statement",
    "get_compatible_track_inputs",
]
