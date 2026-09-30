from __future__ import annotations

from datetime import datetime, timedelta, timezone

import crate.db.home_builder_release_recommendations as recommendations


def _track(
    track_id: int,
    *,
    artist: str = "Artist",
    album: str = "Album",
    album_id: int | None = None,
) -> dict:
    return {
        "track_id": track_id,
        "album_id": album_id,
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


def test_recommended_tracks_use_recent_release_albums_before_old_discovery(
    monkeypatch,
):
    album_ids_seen: list[int] = []

    def candidates(_user_id, album_ids, **_kwargs):
        album_ids_seen.extend(album_ids)
        return [
            _track(3, artist="Recent Artist", album="Last Week", album_id=11),
            _track(4, artist="Recent Artist", album="Last Week", album_id=11),
            _track(1, artist="Fresh Artist", album="This Week", album_id=10),
            _track(2, artist="Fresh Artist", album="This Week", album_id=10),
        ]

    monkeypatch.setattr(recommendations, "track_candidates_for_album_ids", candidates)

    rows = recommendations.build_recommended_tracks(
        1,
        recent_releases=[
            {
                "album_id": 10,
                "artist_name": "Fresh Artist",
                "release_date": datetime.now(timezone.utc),
            },
            {
                "album_id": 11,
                "artist_name": "Recent Artist",
                "release_date": datetime.now(timezone.utc) - timedelta(days=30),
            },
        ],
        interest_artists_lower=[],
        limit=4,
        fallback_tracks=[_track(99, artist="Old Artist", album="Old Album")],
    )

    assert album_ids_seen == [10, 11]
    assert [row["track_id"] for row in rows] == [1, 2, 3, 4]
