from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from crate.api.enrichment import _artist_analysis_payload
from crate.db.repositories.library_reference_reads import get_artist_analysis_tracks
from crate.db.tx import transaction_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION


@pytest.mark.parametrize(
    "path",
    [
        "/api/artists/7/analysis-data",
        "/api/artists/by-entity/test-artist/analysis-data",
    ],
)
@pytest.mark.parametrize("is_current_full_profile", [False, True])
def test_artist_analysis_includes_profiles_and_keeps_same_title_tracks(
    test_app, monkeypatch, path, is_current_full_profile
):
    monkeypatch.setattr(
        "crate.api.enrichment.artist_name_from_id", lambda _: "Test Artist"
    )
    monkeypatch.setattr(
        "crate.api.enrichment.artist_name_from_entity_uid", lambda _: "Test Artist"
    )
    rows = [
        {
            "title": "Same title",
            "track_id": 11,
            "track_entity_uid": "track-one",
            "album_id": 1,
            "tempo": None,
            "mood_json": '{"calm": 0.8}',
            "smart_mix": {
                "quality": "full" if is_current_full_profile else "partial",
                "is_current_full_profile": is_current_full_profile,
                "integrated_lufs": -12.5,
                "status": "available",
            },
            "bliss": {"available": False, "state": "pending", "dimensions": None},
        },
        {
            "title": "Same title",
            "track_id": 12,
            "track_entity_uid": "track-two",
            "album_id": 2,
            "tempo": 120,
            "mood_json": None,
            "smart_mix": None,
            "bliss": {
                "available": True,
                "dimensions": 20,
                "state": "done",
                "revision": "vector-ref",
                "revision_source": "mix_profile",
            },
        },
    ]
    monkeypatch.setattr(
        "crate.api.enrichment.get_artist_analysis_tracks", lambda _: rows
    )
    response = test_app.get(path)
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"same title", "track:12"}
    assert payload["same title"]["mood"] == {"calm": 0.8}
    assert payload["same title"]["smart_mix"]["integrated_lufs"] == -12.5
    assert (
        payload["same title"]["smart_mix"]["is_current_full_profile"]
        is is_current_full_profile
    )
    assert payload["same title"]["tempo"] is None
    assert payload["track:12"]["album_id"] == 2
    assert payload["track:12"]["bliss"]["dimensions"] == 20
    assert payload["track:12"]["smart_mix"] is None


def test_analysis_payload_keeps_untitled_identified_tracks_and_bad_mood():
    result = _artist_analysis_payload(
        [{"title": "", "track_id": 4, "mood_json": "invalid"}]
    )
    assert result["track:4"]["mood"] is None


def test_artist_analysis_reads_smart_mix_and_bliss_without_legacy_bpm(pg_db):
    pg_db.upsert_artist({"name": "Profile Artist"})
    with transaction_scope() as session:
        album_id = session.execute(
            text("""
            INSERT INTO library_albums (artist, name, path, entity_uid)
            VALUES ('Profile Artist', 'Profile Album', '/music/profile-audit', gen_random_uuid())
            RETURNING id
        """)
        ).scalar_one()
        ids = []
        for index in range(3):
            ids.append(
                session.execute(
                    text("""
                INSERT INTO library_tracks
                    (album_id, artist, album, filename, title, path, entity_uid,
                     bliss_state, bliss_vector)
                VALUES (:album_id, 'Profile Artist', 'Profile Album', :filename,
                        'Repeated', :path, gen_random_uuid(), :state, :vector)
                RETURNING id
            """),
                    {
                        "album_id": album_id,
                        "filename": f"track-{index}.flac",
                        "path": f"/music/profile-audit/{index}.flac",
                        "state": "done" if index == 1 else "pending",
                        "vector": [0.1, 0.2, 0.3] if index == 1 else None,
                    },
                ).scalar_one()
            )
        session.execute(
            text("""
            INSERT INTO track_mix_profiles
                (track_id, profile_version, profile_revision, analyzer, analyzer_version,
                 source_revision, quality, analyzed_at, integrated_lufs, true_peak_dbfs,
                 key_camelot, source_stale_at, beat_grid_format, beat_grid_data)
            VALUES (:track_id, 1, 'profile-ref', 'audio', 'audio-v4', 'source-ref',
                    'partial', NOW(), -12.5, -0.7, '8A', NOW(), 'test-grid', :grid)
        """),
            {"track_id": ids[0], "grid": b"binary-data-must-not-be-returned"},
        )
    rows = get_artist_analysis_tracks("Profile Artist")
    assert len(rows) == 3
    by_id = {row["track_id"]: row for row in rows}
    profile_track = by_id[ids[0]]
    assert profile_track["tempo"] is None
    assert profile_track["smart_mix"]["integrated_lufs"] == -12.5
    assert profile_track["smart_mix"]["camelot"] == "8A"
    assert profile_track["smart_mix"]["status"] == "source_changed"
    assert profile_track["smart_mix"]["is_current_full_profile"] is False
    assert "beat_grid_data" not in profile_track["smart_mix"]
    assert "bliss_vector" not in profile_track
    assert by_id[ids[1]]["bliss"]["dimensions"] == 3
    assert by_id[ids[1]]["bliss"]["available"] is True
    assert by_id[ids[2]]["smart_mix"] is None
    assert by_id[ids[2]]["bliss"]["available"] is False


def test_artist_analysis_marks_only_current_full_profiles(pg_db, monkeypatch):
    # Advance the schema so a valid stored previous version can be exercised too.
    current_profile_version = PROFILE_SCHEMA_VERSION + 1
    monkeypatch.setattr(
        "crate.db.repositories.library_reference_reads.PROFILE_SCHEMA_VERSION",
        current_profile_version,
    )
    cases = {
        "current": {},
        "light": {"quality": "partial"},
        "legacy": {"quality": "legacy"},
        "unavailable": {"quality": "unavailable"},
        "old_schema": {"profile_version": PROFILE_SCHEMA_VERSION},
        "old_analyzer": {"analyzer_version": "old-analysis"},
        "source_changed": {"source_stale_at": datetime.now(UTC)},
        "missing": None,
    }
    pg_db.upsert_artist({"name": "Current Profile Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Current Profile Artist",
            "name": "Current Profile Album",
            "path": "/music/current-profile-audit",
        }
    )
    with transaction_scope() as session:
        for name, overrides in cases.items():
            track_id = session.execute(
                text("""
                    INSERT INTO library_tracks
                        (album_id, artist, album, filename, title, path, entity_uid)
                    VALUES (:album_id, 'Current Profile Artist', 'Current Profile Album',
                            :filename, :title, :path, gen_random_uuid())
                    RETURNING id
                """),
                {
                    "album_id": album_id,
                    "filename": f"{name}.flac",
                    "title": name,
                    "path": f"/music/current-profile-audit/{name}.flac",
                },
            ).scalar_one()
            if overrides is None:
                continue
            session.execute(
                text("""
                    INSERT INTO track_mix_profiles
                        (track_id, profile_version, profile_revision, analyzer,
                         analyzer_version, source_revision, quality, analyzed_at,
                         source_stale_at)
                    VALUES (:track_id, :profile_version, :profile_revision, 'crate-rust',
                            :analyzer_version, 'source-ref', :quality, NOW(), :source_stale_at)
                """),
                {
                    "track_id": track_id,
                    "profile_version": current_profile_version,
                    "profile_revision": f"profile-{name}",
                    "analyzer_version": ANALYZER_VERSION,
                    "quality": "full",
                    "source_stale_at": None,
                    **overrides,
                },
            )

    profiles = {
        row["title"]: row["smart_mix"]
        for row in get_artist_analysis_tracks("Current Profile Artist")
    }
    assert set(profiles) == set(cases)
    assert profiles["missing"] is None
    for name, profile in profiles.items():
        if profile is not None:
            assert profile["is_current_full_profile"] is (name == "current"), name
