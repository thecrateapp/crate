"""Music Path completeness is independent of soft musical-quality warnings."""

from copy import deepcopy

import pytest
from crate import music_paths
from crate.db import paths_service_reads
from crate.music_path_validation import validate_music_path


def _tracks():
    return [
        {
            "track_id": index,
            "artist": f"Artist {index}",
            "title": f"Song {index}",
            "progress": (index - 1) / 19,
            "playable": True,
        }
        for index in range(1, 21)
    ]


def _validate(tracks, **kwargs):
    return validate_music_path(
        tracks,
        requested_steps=20,
        origin={"type": "track", "value": "1"},
        destination={"type": "track", "value": "20"},
        **kwargs,
    )


@pytest.mark.parametrize("consecutive", [2, 3])
def test_complete_twenty_track_path_warns_only_after_the_second_consecutive_artist(
    consecutive,
):
    tracks = _tracks()
    for index in range(5, 5 + consecutive):
        tracks[index]["artist"] = "Repeated Artist"
    before = deepcopy(tracks)

    report = _validate(tracks)

    assert report["generated_step_count"] == 20
    assert report["warnings"] == (
        [{"code": "repeated_artist", "position": 7}] if consecutive == 3 else []
    )
    assert report["is_partial"] is False
    assert tracks == before


def test_an_artist_total_limit_warning_does_not_make_a_complete_path_partial():
    tracks = _tracks()
    tracks[8]["artist"] = tracks[5]["artist"]

    report = _validate(tracks, max_repeat_per_artist=1)

    assert report["warnings"] == [{"code": "artist_repeat_limit", "position": 8}]
    assert report["is_partial"] is False


@pytest.mark.parametrize(
    "violation",
    [
        "count",
        "origin",
        "destination",
        "unavailable",
        "missing-waypoint",
        "waypoint-order",
    ],
)
def test_structural_failures_still_make_a_path_partial(violation):
    tracks = _tracks()
    options = {}
    expected = {
        "count": "insufficient_tracks",
        "origin": "missing_origin",
        "destination": "missing_destination",
        "unavailable": "unavailable_track",
        "missing-waypoint": "unresolved_waypoint",
        "waypoint-order": "invalid_waypoint_order",
    }[violation]
    if violation == "count":
        tracks.pop(10)
    elif violation == "origin":
        tracks[0]["track_id"] = 100
    elif violation == "destination":
        tracks[-1]["track_id"] = 100
    elif violation == "unavailable":
        tracks[10]["playable"] = False
    else:
        first = {"type": "genre", "value": "punk"}
        second = {"type": "genre", "value": "post-hardcore"}
        options["requested_waypoints"] = [first, second]
        options["resolved_waypoints"] = (
            [first] if violation == "missing-waypoint" else [second, first]
        )

    report = _validate(tracks, **options)

    assert report["is_partial"] is True
    assert expected in {warning["code"] for warning in report["warnings"]}


@pytest.mark.parametrize("count", [19, 20], ids=["short", "complete"])
def test_legacy_list_and_detail_agree_on_completeness_without_replanning(
    monkeypatch, count
):
    tracks = _tracks()[:count]
    for index in (5, 6, 7):
        tracks[index]["artist"] = "Repeated Artist"
    row = {
        "id": 7,
        "name": "Legacy journey",
        "origin_type": "track",
        "origin_value": "1",
        "origin_label": "Origin",
        "dest_type": "track",
        "dest_value": "20",
        "dest_label": "Finish",
        "waypoints": [],
        "step_count": 20,
        "created_at": "2026-10-29",
        "updated_at": "2026-10-29",
        "tracks": tracks,
        "generation_metadata": {},
        "track_count": count,
    }
    summary_row = {key: value for key, value in row.items() if key != "tracks"}
    monkeypatch.setattr(
        paths_service_reads,
        "get_music_path_row",
        lambda _id, owner: deepcopy(row) if owner == 1 else None,
    )
    monkeypatch.setattr(
        paths_service_reads,
        "list_music_path_rows",
        lambda owner: [deepcopy(summary_row)] if owner == 1 else [],
    )
    monkeypatch.setattr(
        music_paths,
        "build_music_path_plan",
        lambda *_a, **_k: pytest.fail("saved reads must not plan"),
    )
    monkeypatch.setattr(
        music_paths,
        "history_for_candidates",
        lambda *_a, **_k: pytest.fail("saved reads must not load history"),
    )

    detail = paths_service_reads.get_music_path(7, 1)
    summary = paths_service_reads.list_music_paths(1)[0]

    assert detail["tracks"] == tracks
    assert detail["is_partial"] is summary["is_partial"] is (count < 20)
    assert detail["generated_step_count"] == summary["generated_step_count"] == count
    assert "repeated_artist" in {warning["code"] for warning in detail["warnings"]}
    assert paths_service_reads.get_music_path(7, 99) is None
    assert paths_service_reads.list_music_paths(99) == []
