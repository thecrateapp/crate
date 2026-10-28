"""Reference and analysis read helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.tx import read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


def get_artist_analysis_tracks(
    artist_name: str, *, session: Session | None = None
) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = (
            s.execute(
                text(
                    """
                SELECT t.id AS track_id, t.entity_uid::text AS track_entity_uid,
                       t.album_id, t.title, t.analysis_state, t.analysis_completed_at,
                       t.bpm AS tempo,
                       t.audio_key AS key,
                       t.audio_scale AS scale,
                       t.energy,
                       t.danceability,
                       t.valence,
                       t.acousticness,
                       t.instrumentalness,
                       t.loudness,
                       t.dynamic_range,
                       t.spectral_complexity,
                       t.mood_json,
                       CASE WHEN mp.track_id IS NOT NULL THEN jsonb_build_object(
                           'profile_version', mp.profile_version,
                           'profile_revision', mp.profile_revision,
                           'analyzer', mp.analyzer,
                           'analyzer_version', mp.analyzer_version,
                           'source_revision', mp.source_revision,
                           'quality', mp.quality,
                           'is_current_full_profile',
                               mp.quality = 'full'
                               AND mp.profile_version = :mix_profile_version
                               AND mp.analyzer_version = :mix_analyzer_version
                               AND mp.source_stale_at IS NULL,
                           'analyzed_at', mp.analyzed_at,
                           'source_stale_at', mp.source_stale_at,
                           'duration_ms', mp.duration_ms,
                           'integrated_lufs', mp.integrated_lufs,
                           'measurement_version', mp.measurement_version,
                           'true_peak_dbfs', mp.true_peak_dbfs,
                           'intro_lufs', mp.intro_lufs,
                           'outro_lufs', mp.outro_lufs,
                           'bpm', mp.bpm,
                           'bpm_confidence', mp.bpm_confidence,
                           'tempo_stability', mp.tempo_stability,
                           'beat_anchor_ms', mp.beat_anchor_ms,
                           'downbeat_anchor_ms', mp.downbeat_anchor_ms,
                           'time_signature', mp.time_signature,
                           'beat_grid_format', mp.beat_grid_format,
                           'key_confidence', mp.key_confidence,
                           'intro_cue_ms', mp.intro_cue_ms,
                           'outro_cue_ms', mp.outro_cue_ms,
                           'active_start_ms', mp.active_start_ms,
                           'active_end_ms', mp.active_end_ms,
                           'intro_bpm', mp.intro_bpm,
                           'outro_bpm', mp.outro_bpm,
                           'intro_beat_ms', mp.intro_beat_ms,
                           'outro_beat_ms', mp.outro_beat_ms,
                           'intro_tempo_stability', mp.intro_tempo_stability,
                           'outro_tempo_stability', mp.outro_tempo_stability,
                           'intro_downbeat_ms', mp.intro_downbeat_ms,
                           'outro_downbeat_ms', mp.outro_downbeat_ms,
                           'intro_energy', mp.intro_energy,
                           'outro_energy', mp.outro_energy,
                           'intro_spectral_density', mp.intro_spectral_density,
                           'outro_spectral_density', mp.outro_spectral_density,
                           'global_energy', mp.global_energy,
                           'danceability', mp.danceability,
                           'valence', mp.valence,
                           'bliss_vector_revision', mp.bliss_vector_revision,
                           'key', mp.audio_key, 'scale', mp.audio_scale,
                           'camelot', mp.key_camelot,
                           'status', CASE WHEN mp.source_stale_at IS NULL
                               THEN 'available' ELSE 'source_changed' END
                       ) END AS smart_mix,
                       jsonb_build_object(
                           'available', t.bliss_vector IS NOT NULL
                               AND cardinality(t.bliss_vector) > 0,
                           'dimensions', cardinality(t.bliss_vector),
                           'state', t.bliss_state,
                           'computed_at', t.bliss_computed_at,
                           'revision', mp.bliss_vector_revision,
                           'revision_source', 'mix_profile'
                       ) AS bliss
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN track_mix_profiles mp ON mp.track_id = t.id
                WHERE a.artist = :artist_name
                ORDER BY t.id
                """
                ),
                {
                    "artist_name": artist_name,
                    "mix_profile_version": PROFILE_SCHEMA_VERSION,
                    "mix_analyzer_version": ANALYZER_VERSION,
                },
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_refs_by_names(
    names: list[str], *, session: Session | None = None
) -> dict[str, dict]:
    if not names:
        return {}

    lowered = [name.lower() for name in names]

    def _impl(s: Session) -> dict[str, dict]:
        rows = s.execute(
            select(LibraryArtist.id, LibraryArtist.slug, LibraryArtist.name).where(
                func.lower(LibraryArtist.name).in_(lowered)
            )
        ).all()
        return {row.name.lower(): {"id": row.id, "slug": row.slug} for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_tracks_for_setlist(
    artist_name: str, *, session: Session | None = None
) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = (
            s.execute(
                text(
                    """
                SELECT
                    t.id,
                    t.entity_uid::text AS track_entity_uid,
                    t.storage_id::text AS track_storage_id,
                    t.title,
                    t.path,
                    t.duration,
                    a.name AS album
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE a.artist = :artist_name
                ORDER BY a.year NULLS LAST, a.name, t.disc_number NULLS LAST, t.track_number NULLS LAST, t.title
                """
                ),
                {"artist_name": artist_name},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def find_user_playlist_by_name(
    user_id: int, playlist_name: str, *, session: Session | None = None
) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = (
            s.execute(
                text(
                    """
                SELECT id
                FROM playlists
                WHERE user_id = :user_id
                  AND scope = 'user'
                  AND name = :playlist_name
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """
                ),
                {"user_id": user_id, "playlist_name": playlist_name},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def enrich_track_refs(
    track_ids: list[int], *, session: Session | None = None
) -> dict[int, dict]:
    if not track_ids:
        return {}

    def _impl(s: Session) -> dict[int, dict]:
        rows = (
            s.execute(
                select(
                    LibraryTrack.id.label("track_id"),
                    LibraryTrack.entity_uid.label("track_entity_uid"),
                    LibraryTrack.slug.label("track_slug"),
                    LibraryTrack.path.label("track_path"),
                    LibraryTrack.duration,
                    LibraryTrack.format,
                    LibraryTrack.bitrate,
                    LibraryTrack.sample_rate,
                    LibraryTrack.bit_depth,
                    LibraryTrack.bpm,
                    LibraryTrack.audio_key,
                    LibraryTrack.audio_scale,
                    LibraryAlbum.id.label("album_id"),
                    LibraryAlbum.entity_uid.label("album_entity_uid"),
                    LibraryAlbum.slug.label("album_slug"),
                    LibraryArtist.id.label("artist_id"),
                    LibraryArtist.entity_uid.label("artist_entity_uid"),
                    LibraryArtist.slug.label("artist_slug"),
                )
                .join(LibraryAlbum, LibraryTrack.album_id == LibraryAlbum.id)
                .outerjoin(LibraryArtist, LibraryArtist.name == LibraryAlbum.artist)
                .where(LibraryTrack.id.in_(track_ids))
            )
            .mappings()
            .all()
        )
        return {
            row["track_id"]: {
                **dict(row),
                "track_entity_uid": str(row["track_entity_uid"])
                if row.get("track_entity_uid") is not None
                else None,
                "album_entity_uid": str(row["album_entity_uid"])
                if row.get("album_entity_uid") is not None
                else None,
                "artist_entity_uid": str(row["artist_entity_uid"])
                if row.get("artist_entity_uid") is not None
                else None,
            }
            for row in rows
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


__all__ = [
    "enrich_track_refs",
    "find_user_playlist_by_name",
    "get_artist_analysis_tracks",
    "get_artist_refs_by_names",
    "get_artist_tracks_for_setlist",
]
