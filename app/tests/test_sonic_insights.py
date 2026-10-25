"""Exact sonic-region populations retain provenance and local identities."""

from copy import deepcopy
from datetime import date
import json

import pytest
from sqlalchemy import text

from crate.smart_mix.versions import (
    ANALYZER_VERSION,
    MEASUREMENT_VERSION,
    PROFILE_SCHEMA_VERSION,
)
from tests.conftest import PG_AVAILABLE


def _row(track_id=1, **changes):
    row = {
        "id": track_id,
        "track_uid": f"track-{track_id}",
        "track_title": f"Track {track_id}",
        "album_id": track_id,
        "entity_uid": f"album-{track_id}",
        "title": f"Album {track_id}",
        "slug": f"album-{track_id}",
        "artist": "Artist",
        "artist_slug": "artist",
        "year": "2026",
        "has_cover": True,
        "current_plays": 0,
        "current_minutes": 0,
        "has_bliss": True,
        "profile_current": True,
        "mix_quality": "partial",
        "mix_bpm": 100,
        "mix_energy": 0.5,
        "mix_bpm_confidence": 0.75,
        "mix_tempo_stability": 0.8,
        "mix_key_camelot": "8A",
        "mix_key_confidence": 0.9,
        "mix_integrated_lufs": -20,
        "mix_measurement_version": MEASUREMENT_VERSION,
        "mix_true_peak_dbfs": -1,
        "acousticness": 0.3,
        "instrumentalness": 0.4,
        "valence": 0.6,
    }
    row.update(changes)
    return row


def _build(rows):
    from crate.db.queries.sonic_insights import build_sonic_insights

    return build_sonic_insights(rows)


def _planes(rows):
    return {plane["key"]: plane for plane in _build(rows)["planes"]}


def test_empty_population_has_stable_finite_domains_and_no_invented_measurements():
    report = _build([])
    assert report["version"] == 1
    assert report["source"] == {
        "analyzer_version": ANALYZER_VERSION,
        "profile_version": PROFILE_SCHEMA_VERSION,
        "measurement_version": MEASUREMENT_VERSION,
    }
    assert len(report["planes"]) == 2
    for plane in report["planes"]:
        assert plane["x"] == {
            "label": "Tempo",
            "unit": "BPM",
            "min": 0,
            "max": 200,
            "bins": 10,
        }
        assert plane["coverage"] == {
            "catalogue_tracks": 0,
            "paired_tracks": 0,
            "heard_tracks": 0,
            "paired_heard_tracks": 0,
        }
        assert plane["cells"] == []
    assert report["planes"][0]["y"]["min"] == 0
    assert report["planes"][0]["y"]["max"] == 1
    assert report["planes"][1]["y"]["min"] == -10
    assert report["planes"][1]["y"]["max"] == 0
    json.dumps(report, allow_nan=False)


def test_partial_is_eligible_and_pair_coverage_and_shares_use_unique_heard_tracks():
    rows = [
        _row(1, current_plays=100, current_minutes=500, mix_energy=0),
        _row(2, current_plays=1, current_minutes=3, mix_energy=1),
        _row(3, mix_bpm=None),
        _row(4, current_minutes=2, mix_energy=None, mix_integrated_lufs=None),
        _row(5, mix_bpm=100, mix_integrated_lufs=None),
    ]
    planes = _planes(rows)
    energy, lufs = planes["tempo_energy"], planes["tempo_lufs"]
    assert energy["coverage"] == {
        "catalogue_tracks": 5,
        "paired_tracks": 3,
        "heard_tracks": 3,
        "paired_heard_tracks": 2,
    }
    assert lufs["coverage"] == {
        "catalogue_tracks": 5,
        "paired_tracks": 2,
        "heard_tracks": 3,
        "paired_heard_tracks": 2,
    }
    assert sum(cell["tracks"] for cell in energy["cells"]) == 3
    assert sum(cell["heard_tracks"] for cell in energy["cells"]) == 2
    assert sum(cell["catalogue_share"] for cell in energy["cells"]) == pytest.approx(
        100
    )
    assert sum(cell["listening_share"] for cell in energy["cells"]) == pytest.approx(
        100
    )
    first, _, last = energy["cells"]
    assert first["listening_share"] == last["listening_share"] == 50
    assert first["plays"] == 100
    assert first["minutes"] == 500
    assert first["examples"][0]["quality"] == "partial"


@pytest.mark.parametrize(
    "invalid", [None, float("nan"), float("inf"), -float("inf"), "NaN"]
)
def test_null_and_nonfinite_values_are_uncovered_not_zero_imputed(invalid):
    rows = [
        _row(1, mix_bpm=invalid),
        _row(2, mix_energy=invalid, mix_integrated_lufs=invalid),
    ]
    planes = _planes(rows)
    assert planes["tempo_energy"]["coverage"]["paired_tracks"] == 0
    assert planes["tempo_lufs"]["coverage"]["paired_tracks"] == 0
    json.dumps(_build(rows), allow_nan=False)


@pytest.mark.parametrize("bpm", [0, -1, 1000, 1001])
def test_tempo_unit_boundaries_are_strict(bpm):
    assert all(not p["cells"] for p in _build([_row(mix_bpm=bpm)])["planes"])


@pytest.mark.parametrize("energy", [-0.001, 1.001, 60])
def test_legacy_scale_energy_never_enters_normalized_map(energy):
    planes = _planes([_row(mix_energy=energy, energy=0.6, loudness=-14)])
    assert planes["tempo_energy"]["cells"] == []
    assert planes["tempo_lufs"]["coverage"]["paired_tracks"] == 1


def test_only_current_profiles_and_accredited_lufs_are_used_without_legacy_fallback():
    planes = _planes(
        [
            _row(1, profile_current=False, bpm=120, energy=0.6, loudness=-15),
            _row(2, mix_measurement_version="old", loudness=-14),
        ]
    )
    assert planes["tempo_energy"]["coverage"]["paired_tracks"] == 1
    assert planes["tempo_lufs"]["coverage"]["paired_tracks"] == 0
    example = planes["tempo_energy"]["cells"][0]["examples"][0]
    assert example["integrated_lufs"] is None
    assert example["true_peak_dbfs"] is None


def test_normalizer_keeps_track_and_album_identity_distinct_and_nulls_bad_secondary_values():
    from crate.db.queries.sonic_insights import sonic_track_reading

    row = _row(
        current_plays=2,
        current_minutes=7,
        mix_bpm_confidence=float("inf"),
        mix_key_confidence=-1,
        mix_tempo_stability=2,
        mix_key_camelot="13A",
        acousticness=float("nan"),
        instrumentalness=-1,
        valence=2,
    )
    reading = sonic_track_reading(row)
    assert reading["entity_uid"] == "track-1"
    assert reading["title"] == "Track 1"
    assert reading["album_entity_uid"] == "album-1"
    assert reading["album"] == "Album 1"
    assert reading["heard"] is True
    assert reading["plays"] == 2 and reading["minutes"] == 7
    for field in (
        "bpm_confidence",
        "key_confidence",
        "tempo_stability",
        "key_camelot",
        "acousticness",
        "instrumentalness",
        "valence",
    ):
        assert reading[field] is None
    stale = sonic_track_reading(_row(profile_current=False))
    for field in (
        "bpm",
        "energy",
        "quality",
        "integrated_lufs",
        "true_peak_dbfs",
        "bpm_confidence",
        "key_confidence",
        "tempo_stability",
        "key_camelot",
    ):
        assert stale[field] is None
    assert stale["acousticness"] == 0.3  # Secondary trait remains an estimate.
    json.dumps(reading, allow_nan=False)


def test_exact_max_boundaries_and_all_eighty_cells_count_once_with_distinct_albums():
    rows = []
    for col in range(10):
        for row in range(8):
            # Explicit maximum belongs to the final bin rather than a ninth row.
            rows.append(
                _row(
                    col * 8 + row + 1,
                    mix_bpm=200 if col == 9 else col * 20 + 1,
                    mix_energy=1 if row == 7 else row / 8,
                    mix_integrated_lufs=0 if row == 7 else -40 + row * 5,
                )
            )
    rows.append(
        _row(1000, album_id=80, mix_bpm=200, mix_energy=1, mix_integrated_lufs=0)
    )
    planes = _planes(rows)
    for key, plane in planes.items():
        assert len(plane["cells"]) == 80
        assert [(c["column"], c["row"]) for c in plane["cells"]] == sorted(
            (c["column"], c["row"]) for c in plane["cells"]
        )
        assert sum(c["tracks"] for c in plane["cells"]) == 81
        last = plane["cells"][-1]
        assert (last["column"], last["row"], last["tracks"], last["albums"]) == (
            9,
            7,
            2,
            1,
        )
        assert last["x_max"] == 200
        assert last["y_max"] == (1 if key == "tempo_energy" else 0)
        assert all(c["listening_share"] == 0 for c in plane["cells"])


def test_domains_derive_from_all_valid_current_tempos_and_are_period_independent():
    rows = [
        _row(1, mix_bpm=201, mix_energy=None, mix_integrated_lufs=None),
        _row(2, mix_bpm=140, mix_integrated_lufs=-42.1),
        _row(3, mix_bpm=150, mix_integrated_lufs=1.2),
        _row(4, profile_current=False, mix_bpm=999),
    ]
    first = _build(rows)
    later = deepcopy(rows)
    later[1]["current_plays"] = 4
    second = _build(later)
    assert [p["x"] for p in first["planes"]] == [p["x"] for p in second["planes"]]
    assert all(p["x"]["max"] == 220 for p in first["planes"])
    assert first["planes"][1]["y"]["min"] == -45
    assert first["planes"][1]["y"]["max"] == 5


def test_examples_are_bounded_deterministic_and_prefer_both_cohorts_and_different_albums():
    rows = [
        _row(n, album_id=(n + 1) // 2, current_plays=n % 2, current_minutes=0)
        for n in range(1, 25)
    ]
    first = _planes(rows)["tempo_energy"]["cells"][0]
    second = _planes(list(reversed(rows)))["tempo_energy"]["cells"][0]
    assert first == second
    assert first["tracks"] == 24 and first["heard_tracks"] == 12
    assert first["albums"] == first["heard_albums"] == 12
    assert len(first["examples"]) == 6
    assert len({t["album_id"] for t in first["examples"]}) == 6
    assert {t["heard"] for t in first["examples"]} == {True, False}
    assert first["catalogue_share"] == first["listening_share"] == 100


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_postgres_report_uses_current_partial_and_full_with_exact_provenance_and_identity(
    pg_db,
):
    from crate.db.tx import read_scope
    from crate.db.queries.collection_insights import build_collection_insights
    from tests.test_collection_insights import _album, _track, _play

    with read_scope() as session:
        album = _album(session)
        tracks = []
        states = [
            (
                "partial",
                ANALYZER_VERSION,
                PROFILE_SCHEMA_VERSION,
                False,
                MEASUREMENT_VERSION,
            ),
            ("full", ANALYZER_VERSION, PROFILE_SCHEMA_VERSION, False, "old"),
            ("full", "old", PROFILE_SCHEMA_VERSION, False, MEASUREMENT_VERSION),
            (
                "full",
                ANALYZER_VERSION,
                PROFILE_SCHEMA_VERSION + 1,
                False,
                MEASUREMENT_VERSION,
            ),
            (
                "full",
                ANALYZER_VERSION,
                PROFILE_SCHEMA_VERSION,
                True,
                MEASUREMENT_VERSION,
            ),
            (
                "legacy",
                ANALYZER_VERSION,
                PROFILE_SCHEMA_VERSION,
                False,
                MEASUREMENT_VERSION,
            ),
        ]
        for n, (quality, analyzer, version, stale, measurement) in enumerate(states, 1):
            track = _track(session, album, n)
            tracks.append(track)
            session.execute(
                text("""
                INSERT INTO track_mix_profiles(track_id,profile_version,profile_revision,
                    analyzer,analyzer_version,source_revision,quality,analyzed_at,
                    source_stale_at,bpm,global_energy,integrated_lufs,measurement_version)
                VALUES (:id,:version,'test','crate-python',:analyzer,'test',:quality,now(),
                    CASE WHEN :stale THEN now() ELSE NULL END,120,0.5,-18,:measurement)
            """),
                {
                    "id": track["id"],
                    "version": version,
                    "analyzer": analyzer,
                    "quality": quality,
                    "stale": stale,
                    "measurement": measurement,
                },
            )
            # Old fields intentionally disagree and may never rescue a profile.
            session.execute(
                text(
                    "UPDATE library_tracks SET bpm=99, energy=60, loudness=-2 WHERE id=:id"
                ),
                {"id": track["id"]},
            )
        _play(
            session,
            "2026-10-24",
            uid=tracks[0]["entity_uid"],
            track=tracks[1]["id"],
            plays=2,
            minutes=7,
        )
        _play(session, "2026-10-24", path=tracks[1]["path"], plays=1, minutes=3)
        report = build_collection_insights(today=date(2026, 10, 24), session=session)
        energy, lufs = report["sonic"]["planes"]
        assert energy["coverage"] == {
            "catalogue_tracks": 6,
            "paired_tracks": 2,
            "heard_tracks": 2,
            "paired_heard_tracks": 2,
        }
        assert lufs["coverage"] == {
            "catalogue_tracks": 6,
            "paired_tracks": 1,
            "heard_tracks": 2,
            "paired_heard_tracks": 1,
        }
        assert energy["cells"][0]["plays"] == 3
        assert lufs["cells"][0]["plays"] == 2
        examples = energy["cells"][0]["examples"]
        assert [t["id"] for t in examples] == [tracks[0]["id"], tracks[1]["id"]]
        assert examples[0]["entity_uid"] == tracks[0]["entity_uid"]
        assert examples[0]["album_entity_uid"] != tracks[0]["entity_uid"]
        assert examples[0]["title"] == "Song" and examples[0]["album"] == "Same title"


def test_report_sql_selects_only_scalar_sonic_inputs():
    from crate.db.queries.collection_insights_sql import _REPORT_SQL

    # The snapshot counts the full catalogue; vector and beat-grid blobs must not
    # be duplicated into its JSON aggregate just to render at most six examples.
    assert "beat_grid_data" not in _REPORT_SQL
    assert "t.bliss_vector AS" not in _REPORT_SQL
    assert "mix_bpm" in _REPORT_SQL


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_postgres_invalid_measurements_missing_profile_and_quarantine_stay_uncovered(
    pg_db,
):
    from crate.db.queries.collection_insights import build_collection_insights
    from crate.db.tx import read_scope
    from tests.test_collection_insights import _album, _play, _track

    with read_scope() as session:
        album = _album(session)
        values = [None, float("nan"), float("inf"), -float("inf")]
        for number, value in enumerate(values, 1):
            track = _track(session, album, number)
            session.execute(
                text("""
                    INSERT INTO track_mix_profiles(track_id,profile_version,profile_revision,
                        analyzer,analyzer_version,source_revision,quality,analyzed_at,
                        bpm,global_energy,integrated_lufs,measurement_version)
                    VALUES (:id,:version,'test','crate-python',:analyzer,'test','partial',now(),
                        :value,:value,:value,:measurement)
                """),
                {
                    "id": track["id"],
                    "version": PROFILE_SCHEMA_VERSION,
                    "analyzer": ANALYZER_VERSION,
                    "measurement": MEASUREMENT_VERSION,
                    "value": value,
                },
            )
            _play(session, "2026-10-24", uid=track["entity_uid"])
        missing = _track(session, album, 5)
        session.execute(
            text(
                "UPDATE library_tracks SET bpm=120, energy=0.5, loudness=-12 WHERE id=:id"
            ),
            {"id": missing["id"]},
        )
        hidden = _track(session, _album(session, "Hidden", quarantine=True))
        _play(session, "2026-10-24", uid=hidden["entity_uid"])
        report = build_collection_insights(today=date(2026, 10, 24), session=session)
        assert report["excluded"]["plays"] == 1
        for plane in report["sonic"]["planes"]:
            assert plane["coverage"] == {
                "catalogue_tracks": 5,
                "paired_tracks": 0,
                "heard_tracks": 4,
                "paired_heard_tracks": 0,
            }
            assert plane["cells"] == []
        json.dumps(report["sonic"], allow_nan=False)
