from __future__ import annotations

from datetime import datetime, timezone

import crate.db.home_builder_release_recommendations as recommendations


def _track(track_id: int, *, artist: str = "Artist", album: str = "Album") -> dict:
    return {
        "track_id": track_id,
        "track_path": f"/music/{artist}/{album}/{track_id}.flac",
        "title": f"Track {track_id}",
        "artist": artist,
        "album": album,
        "user_play_count": 0,
        "is_liked": False,
    }


def test_recommended_tracks_do_not_backfill_a_whole_album(monkeypatch):
    monkeypatch.setattr(
        recommendations,
        "track_candidates_for_album_ids",
        lambda *_args, **_kwargs: [
            _track(track_id, artist="Terror", album="New Album")
            for track_id in range(1, 12)
        ],
    )

    rows = recommendations.build_recommended_tracks(
        1,
        recent_releases=[
            {
                "album_id": 10,
                "artist_name": "Terror",
                "release_date": datetime.now(timezone.utc),
            }
        ],
        interest_artists_lower=["terror"],
        limit=8,
    )

    assert len(rows) == 2
    assert {row["album"] for row in rows} == {"New Album"}


def test_recommended_tracks_use_discovery_fallback_without_liked_or_played(monkeypatch):
    monkeypatch.setattr(
        recommendations,
        "track_candidates_for_album_ids",
        lambda *_args, **_kwargs: [],
    )
    fallback = [
        _track(1, artist="A", album="One"),
        _track(2, artist="A", album="One"),
        _track(3, artist="A", album="One"),
        {**_track(4, artist="B", album="Two"), "is_liked": True},
        {**_track(5, artist="C", album="Three"), "user_play_count": 1},
        _track(6, artist="D", album="Four"),
    ]

    rows = recommendations.build_recommended_tracks(
        1,
        recent_releases=[],
        interest_artists_lower=[],
        limit=8,
        fallback_tracks=fallback,
    )

    assert [row["track_id"] for row in rows] == [1, 2, 6]
