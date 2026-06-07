from __future__ import annotations

from crate.db.tracklist_engine import (
    TracklistRequest,
    generate_tracklist,
    get_tracklist_profile,
)


def _row(
    track_id: int,
    *,
    title: str,
    artist: str,
    album: str,
    playcount: int = 0,
    user_play_count: int = 0,
) -> dict:
    return {
        "track_id": track_id,
        "track_path": f"/music/{artist}/{album}/{track_id}.flac",
        "title": title,
        "artist": artist,
        "album": album,
        "lastfm_playcount": playcount,
        "user_play_count": user_play_count,
    }


def test_get_tracklist_profile_applies_safe_overrides():
    profile = get_tracklist_profile(
        "home_daily_discovery_v1",
        overrides={"max_per_artist": 1, "max_per_album": 1, "id": "ignored"},
    )

    assert profile.id == "home_daily_discovery_v1"
    assert profile.max_per_artist == 1
    assert profile.max_per_album == 1


def test_generate_tracklist_applies_popularity_ordering_and_guardrails():
    profile = get_tracklist_profile(
        "curator_smart_playlist_v1",
        overrides={"ordering": "popularity", "max_per_artist": 1},
    )
    rows = [
        _row(1, title="Low", artist="Artist A", album="A", playcount=10),
        _row(2, title="High", artist="Artist A", album="A", playcount=1000),
        _row(3, title="Mid", artist="Artist B", album="B", playcount=200),
    ]

    result = generate_tracklist(TracklistRequest(rows=rows, profile=profile, limit=3))

    assert [row["track_id"] for row in result.tracks] == [2, 3]
    assert result.diagnostics["profile_id"] == "curator_smart_playlist_v1"
    assert result.diagnostics["ordering_applied"] == "popularity"
    assert result.diagnostics["dropped_artist_cap_count"] == 1


def test_generate_tracklist_personalized_penalizes_overplayed_tracks():
    profile = get_tracklist_profile("home_daily_discovery_v1")
    rows = [
        _row(1, title="Overplayed", artist="Artist A", album="A", user_play_count=9),
        _row(2, title="Fresh", artist="Artist B", album="B", user_play_count=0),
    ]

    result = generate_tracklist(TracklistRequest(rows=rows, profile=profile, limit=2))

    assert [row["track_id"] for row in result.tracks] == [2, 1]
    assert result.diagnostics["ordering_applied"] == "personalized"


def test_generate_tracklist_prioritizes_discovery_source_over_comfort():
    profile = get_tracklist_profile("home_daily_discovery_v1")
    rows = [
        {
            **_row(
                1,
                title="Comfort",
                artist="Known Artist",
                album="Known Album",
                user_play_count=0,
            ),
            "recommendation_source": "comfort",
        },
        {
            **_row(
                2,
                title="Adjacent",
                artist="New Artist",
                album="New Album",
                user_play_count=3,
            ),
            "recommendation_source": "discovery",
        },
    ]

    result = generate_tracklist(TracklistRequest(rows=rows, profile=profile, limit=2))

    assert [row["track_id"] for row in result.tracks] == [2, 1]


def test_generate_tracklist_can_keep_versions_when_strict_identity_is_disabled():
    profile = get_tracklist_profile(
        "curator_smart_playlist_v1",
        overrides={"strict_song_identity": False, "max_per_artist": 3},
    )
    rows = [
        _row(1, title="Same Song", artist="Artist A", album="Album A"),
        _row(2, title="Same Song (Demo)", artist="Artist A", album="Demos"),
        _row(3, title="Other Song", artist="Artist B", album="Album B"),
    ]

    result = generate_tracklist(TracklistRequest(rows=rows, profile=profile, limit=3))

    assert [row["track_id"] for row in result.tracks] == [1, 2, 3]
