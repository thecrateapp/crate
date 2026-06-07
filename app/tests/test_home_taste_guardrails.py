from __future__ import annotations

from crate.db.home_taste_guardrails import (
    canonical_mix_song_key,
    dedupe_mix_song_identities,
    is_low_quality_mix_variant,
    rank_by_daily_seed,
    select_mix_tracks,
    track_version_penalty,
)
from crate.db.home_builder_track_selection import _select_home_mix_tracks
from crate.db.home_debug import collect_home_debug


def _row(
    track_id: int,
    *,
    title: str,
    artist: str,
    album: str,
    duration: int = 180,
    format: str = "flac",
) -> dict:
    return {
        "track_id": track_id,
        "track_path": f"/music/{artist}/{album}/{track_id}.flac",
        "title": title,
        "artist": artist,
        "album": album,
        "duration": duration,
        "format": format,
    }


def test_canonical_mix_song_key_collapses_known_versions():
    row = _row(
        1,
        title="Concubine (Live at CBGB)",
        artist="Converge",
        album="Live at CBGB",
    )

    assert canonical_mix_song_key(row) == ("converge", "concubine")


def test_track_version_penalty_uses_title_and_album_markers():
    assert (
        track_version_penalty(
            _row(1, title="Concubine", artist="Converge", album="Live at CBGB")
        )
        == 3
    )
    assert is_low_quality_mix_variant(
        _row(2, title="Concubine (Acoustic)", artist="Converge", album="Jane Doe")
    )


def test_dedupe_mix_song_identities_prefers_studio_over_live_variant():
    rows = [
        _row(
            1,
            title="Concubine (Live at CBGB)",
            artist="Converge",
            album="Live at CBGB",
        ),
        _row(2, title="Concubine", artist="Converge", album="Jane Doe"),
    ]

    selected = dedupe_mix_song_identities(rows)

    assert [row["track_id"] for row in selected] == [2]


def test_select_mix_tracks_returns_shorter_mix_instead_of_relaxing_artist_cap():
    rows = [
        _row(1, title="A", artist="Artist One", album="Album A"),
        _row(2, title="B", artist="Artist One", album="Album A"),
        _row(3, title="C", artist="Artist One", album="Album B"),
        _row(4, title="D", artist="Artist Two", album="Album C"),
    ]

    selected = select_mix_tracks(
        rows, limit=4, max_per_artist=1, max_per_album=1, strict=True
    )

    assert [row["artist"] for row in selected] == ["Artist One", "Artist Two"]


def test_select_mix_tracks_enforces_canonical_song_identity_per_artist():
    rows = [
        _row(1, title="A Song", artist="Artist One", album="Album A"),
        _row(2, title="A Song (Demo)", artist="Artist One", album="Demos"),
        _row(3, title="Another Song", artist="Artist One", album="Album A"),
        _row(4, title="A Song", artist="Artist Two", album="Album B"),
    ]

    selected = select_mix_tracks(
        rows, limit=4, max_per_artist=3, max_per_album=3, strict=True
    )

    assert [row["track_id"] for row in selected] == [1, 3, 4]


def test_rank_by_daily_seed_is_stable_and_changes_by_day():
    rows = [
        _row(1, title="A", artist="Artist One", album="Album A"),
        _row(2, title="B", artist="Artist Two", album="Album B"),
        _row(3, title="C", artist="Artist Three", album="Album C"),
    ]

    day_one = rank_by_daily_seed(rows, user_id=7, surface_id="daily", day="2026-06-06")
    day_one_again = rank_by_daily_seed(
        rows, user_id=7, surface_id="daily", day="2026-06-06"
    )
    day_two = rank_by_daily_seed(rows, user_id=7, surface_id="daily", day="2026-06-07")

    assert [row["track_id"] for row in day_one] == [
        row["track_id"] for row in day_one_again
    ]
    assert [row["track_id"] for row in day_one] != [row["track_id"] for row in day_two]


def test_select_home_mix_tracks_records_debug_diagnostics():
    rows = [
        _row(1, title="A", artist="Artist One", album="Album A"),
        _row(2, title="B", artist="Artist One", album="Album A"),
        _row(3, title="C", artist="Artist Two", album="Album B"),
    ]

    with collect_home_debug() as diagnostics:
        selected = _select_home_mix_tracks(
            rows,
            limit=3,
            max_per_artist=1,
            max_per_album=1,
            mix_id="daily-discovery",
        )

    assert [row["track_id"] for row in selected] == [1, 3]
    assert diagnostics["mixes"]["daily-discovery"]["candidate_pool_size"] == 3
    assert diagnostics["mixes"]["daily-discovery"]["selected_count"] == 2
    assert diagnostics["mixes"]["daily-discovery"]["dropped_artist_cap_count"] == 1
    assert diagnostics["mixes"]["daily-discovery"]["strict_selection_shortfall"] is True
