from __future__ import annotations

import json
from pathlib import Path
import uuid

from sqlalchemy import text

from crate.db.queries.smart_mix_compatible import (
    compatible_candidate_statement,
    get_compatible_track_inputs,
)
from crate.db.tx import transaction_scope


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "app/crate/db/migrations/versions/087_smart_mix_profiles.py"


def test_candidate_query_is_bounded_and_never_reads_beat_grid() -> None:
    sql = str(compatible_candidate_statement()).upper()

    assert "LIMIT :MAX_CANDIDATES" in sql
    assert "BEAT_GRID_DATA" not in sql
    assert "TRACK_MIX_PROFILES" in sql
    assert "LIBRARY_TRACKS" in sql


def test_profile_migration_contains_selective_compatible_indexes() -> None:
    source = MIGRATION.read_text()

    assert "idx_track_mix_profiles_compatible_bpm" in source
    assert "idx_track_mix_profiles_compatible_camelot" in source
    assert "idx_track_mix_profiles_compatible_energy" in source


def test_query_loads_seed_and_at_most_500_local_candidates(
    pg_db,
    tmp_path: Path,
) -> None:
    del pg_db
    seed_uid = _seed_tracks(tmp_path, count=520)

    seed, candidates = get_compatible_track_inputs(
        seed_uid,
        max_candidates=500,
    )

    assert seed is not None
    assert seed.track_entity_uid == seed_uid
    assert 0 < len(candidates) <= 500
    assert all(item.track_entity_uid != seed_uid for item in candidates)
    assert all(item.playable for item in candidates)
    assert all(item.profile.beat_grid_ms == () for item in candidates)


def test_production_scale_candidate_query_uses_profile_indexes(
    pg_db,
    tmp_path: Path,
) -> None:
    del pg_db
    seed_uid = _seed_tracks(tmp_path, count=12_000)
    statement = compatible_candidate_statement()
    params = {
        "seed_track_id": _track_id(seed_uid),
        "seed_bpm": 120.0,
        "seed_energy": 0.7,
        "max_candidates": 500,
    }

    with transaction_scope() as session:
        session.execute(text("ANALYZE track_mix_profiles"))
        session.execute(text("SET LOCAL random_page_cost = 1.0"))
        raw_plan = session.execute(
            text(f"EXPLAIN (FORMAT JSON) {statement.text}"),
            params,
        ).scalar_one()

    encoded = json.dumps(raw_plan)
    assert "idx_track_mix_profiles_compatible_" in encoded
    assert not _has_profile_seq_scan(raw_plan)


def _seed_tracks(tmp_path: Path, *, count: int) -> str:
    suffix = uuid.uuid4().hex
    artist = f"Compatible Scale {suffix}"
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    seed_uid = str(uuid.uuid4())
    base_path = str(tmp_path / suffix)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid)
                VALUES (:artist, CAST(:artist_uid AS uuid))
                """
            ),
            {"artist": artist, "artist_uid": artist_uid},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES (:artist, 'Scale', :path, CAST(:album_uid AS uuid))
                RETURNING id
                """
            ),
            {
                "artist": artist,
                "path": base_path,
                "album_uid": album_uid,
            },
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path,
                    entity_uid, duration, genre, bliss_vector
                )
                SELECT
                    :album_id,
                    :artist,
                    'Scale',
                    index::text || '.flac',
                    'Track ' || index::text,
                    :base_path || '/' || index::text || '.flac',
                    CASE
                        WHEN index = 0 THEN CAST(:seed_uid AS uuid)
                        ELSE CAST(md5(:seed_uid || index::text) AS uuid)
                    END,
                    180.0,
                    'post-hardcore',
                    ARRAY[1.0, 0.0, 0.0]::double precision[]
                FROM generate_series(0, :last_index) AS index
                """
            ),
            {
                "album_id": album_id,
                "artist": artist,
                "base_path": base_path,
                "seed_uid": seed_uid,
                "last_index": count,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, bpm,
                    bpm_confidence, tempo_stability, downbeat_anchor_ms,
                    time_signature, key_camelot, key_confidence,
                    intro_cue_ms, outro_cue_ms, intro_energy, outro_energy,
                    global_energy, danceability, valence, analyzed_at
                )
                SELECT
                    track.id,
                    1,
                    'profile-' || track.id::text,
                    'crate-rust',
                    'smart-mix-v1',
                    'source-' || track.id::text,
                    'full',
                    CASE
                        WHEN track.entity_uid = CAST(:seed_uid AS uuid) THEN 120.0
                        ELSE 40.0 + (track.id % 220)
                    END,
                    0.95,
                    0.97,
                    500,
                    4,
                    CASE (track.id % 4)
                        WHEN 0 THEN '8A'
                        WHEN 1 THEN '8B'
                        WHEN 2 THEN '9A'
                        ELSE '2B'
                    END,
                    0.9,
                    8000,
                    165000,
                    0.7,
                    0.7,
                    (track.id % 100)::double precision / 100.0,
                    0.7,
                    0.5,
                    NOW()
                FROM library_tracks track
                WHERE track.album_id = :album_id
                """
            ),
            {"seed_uid": seed_uid, "album_id": album_id},
        )
    return seed_uid


def _track_id(entity_uid: str) -> int:
    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    """
                    SELECT id
                    FROM library_tracks
                    WHERE entity_uid = CAST(:entity_uid AS uuid)
                    """
                ),
                {"entity_uid": entity_uid},
            ).scalar_one()
        )


def _has_profile_seq_scan(plan: object) -> bool:
    if isinstance(plan, list):
        return any(_has_profile_seq_scan(item) for item in plan)
    if not isinstance(plan, dict):
        return False
    if (
        plan.get("Node Type") == "Seq Scan"
        and plan.get("Relation Name") == "track_mix_profiles"
    ):
        return True
    return any(_has_profile_seq_scan(value) for value in plan.values())
