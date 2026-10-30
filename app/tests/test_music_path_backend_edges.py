"""Migration resources and backend boundary contracts for Music Paths."""

from copy import deepcopy
from importlib import import_module

import pytest
from crate.db import paths_candidates
from crate.db.queries.recommendation_context import _positive_id
from crate.music_path_validation import can_replace_path_track, validate_music_path
from crate.track_versions import track_song_identity

from tests.test_music_path_validation import _track
from tests.test_music_paths_fallback import _row
from tests.test_paths_performance import _MigrationRecorder


@pytest.mark.parametrize(
    "invalid", [None, True], ids=["missing-index", "invalid-index"]
)
def test_cosine_index_build_sets_its_memory_and_parallelism_inside_autocommit(
    monkeypatch, invalid
):
    migration = import_module(
        "crate.db.migrations.versions.139_restore_bliss_cosine_index"
    )

    class ResourceRecorder(_MigrationRecorder):
        def __init__(self):
            super().__init__(catalog_states=(invalid, True))
            self.executions = []

        def execute(self, statement, parameters=None):
            self.executions.append(
                (" ".join(str(statement).split()), self.in_autocommit)
            )
            return super().execute(statement, parameters)

    recorder = ResourceRecorder()
    monkeypatch.setattr(migration, "op", recorder)

    migration.upgrade()

    create_index = next(
        index
        for index, (sql, _inside) in enumerate(recorder.executions)
        if sql.upper().startswith("CREATE INDEX")
    )
    settings = {
        setting: (index, sql.replace(" ", "").lower(), inside)
        for index, (sql, inside) in enumerate(recorder.executions)
        for setting in ("maintenance_work_mem", "max_parallel_maintenance_workers")
        if sql.lower().startswith(f"set {setting}")
    }
    assert "maintenance_work_mem" in settings
    assert "max_parallel_maintenance_workers" in settings
    for setting, expected in (
        ("maintenance_work_mem", "'256mb'"),
        ("max_parallel_maintenance_workers", "0"),
    ):
        index, sql, inside = settings[setting]
        assert sql == f"set{setting}={expected}"
        assert inside is True
        assert index < create_index
    assert recorder.in_autocommit is False


@pytest.mark.parametrize("reference", ["01", "0001"])
def test_recommendation_context_rejects_noncanonical_padded_numeric_ids(reference):
    assert _positive_id(reference) is None


def test_recommendation_context_preserves_canonical_positive_ids_and_bounds():
    for reference, expected in (
        ("1", 1),
        ("10", 10),
        (str(2**63 - 1), 2**63 - 1),
        ("0", None),
        ("-1", None),
        (str(2**63), None),
    ):
        assert _positive_id(reference) == expected, reference


def _fallback(monkeypatch, candidate, *, recent_song_keys=None, recent_artists=None):
    monkeypatch.setattr(
        paths_candidates,
        "find_candidate_rows",
        lambda *_args, **_kwargs: [deepcopy(candidate)],
    )
    return paths_candidates._find_best_candidate(
        [0.2] * 20,
        set(),
        set(),
        ["Same Artist", "Same Artist"] if recent_artists is None else recent_artists,
        {},
        {},
        {},
        [],
        recent_song_keys=recent_song_keys,
        selection_seed="fallback-test",
    )


def test_acoustic_fallback_cannot_add_a_third_consecutive_track_by_the_same_artist(
    monkeypatch,
):
    candidate = _row(3, artist="Same Artist")

    assert _fallback(monkeypatch, candidate) is None


def test_acoustic_fallback_still_allows_a_cooled_song_from_another_artist(monkeypatch):
    candidate = _row(3, artist="Another Artist")

    selected = _fallback(
        monkeypatch, candidate, recent_song_keys={track_song_identity(candidate)}
    )

    assert selected is not None
    assert selected["id"] == 3


def test_acoustic_fallback_allows_a_second_track_after_an_intervening_artist(
    monkeypatch,
):
    candidate = _row(3, artist="Artist A")

    selected = _fallback(
        monkeypatch,
        candidate,
        recent_artists=["Artist A", "Artist B", "Artist A"],
    )

    assert selected is not None
    assert selected["id"] == candidate["id"]


def test_acoustic_fallback_counts_featured_names_as_the_same_principal_artist(
    monkeypatch,
):
    candidate = _row(3, artist="X feat. Other")

    selected = _fallback(monkeypatch, candidate, recent_artists=["X", "x feat. Guest"])

    assert selected is None


def test_legacy_genre_alias_does_not_invent_a_scene_mismatch_warning():
    tracks = [_track(index, progress=(index - 1) / 2) for index in range(1, 4)]
    original = deepcopy(tracks)
    tracks[1]["genre_slug"] = "metal"

    report = validate_music_path(
        tracks,
        requested_steps=3,
        origin={"type": "track", "value": "1"},
        destination={"type": "track", "value": "3"},
    )

    missing_endpoint = validate_music_path(
        tracks, requested_steps=3, origin={"type": "track", "value": "999"}
    )
    assert "missing_origin" in {
        warning["code"] for warning in missing_endpoint["warnings"]
    }
    replacement = _track(4, genre_slug="metal", path_genre="metal")
    assert can_replace_path_track(original, 1, replacement) is False
    assert "scene_mismatch" not in {warning["code"] for warning in report["warnings"]}
