from __future__ import annotations

from datetime import datetime, timezone

import crate.db.home_builder_mix_generation as mix_generation
from crate.db.home_debug import collect_home_debug


class _FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 6, 10, 12, 0, tzinfo=tz or timezone.utc)


def _row(
    track_id: int,
    *,
    artist: str,
    album_id: int | None = None,
    user_play_count: int = 0,
) -> dict:
    return {
        "track_id": track_id,
        "track_path": f"/music/{artist}/{track_id}.flac",
        "title": f"Track {track_id}",
        "artist": artist,
        "album": f"{artist} Album",
        "album_id": album_id or track_id,
        "user_play_count": user_play_count,
        "is_liked": False,
    }


def test_daily_discovery_uses_discovery_underplayed_then_comfort(monkeypatch):
    def fake_query_discovery_tracks(
        user_id: int,
        *,
        genres: list[str],
        excluded_artist_names: list[str],
        limit: int,
    ) -> list[dict]:
        if excluded_artist_names:
            return [_row(1, artist="Adjacent Artist")]
        return [_row(4, artist="Broad Adjacent")]

    def fake_fallback_recent_interest_tracks(
        user_id: int, interest_artists_lower: list[str], limit: int
    ) -> list[dict]:
        return [
            _row(2, artist="Underplayed Artist", user_play_count=1),
            _row(3, artist="Comfort Artist", user_play_count=3),
        ]

    monkeypatch.setattr(
        mix_generation, "_query_discovery_tracks", fake_query_discovery_tracks
    )
    monkeypatch.setattr(
        mix_generation,
        "_fallback_recent_interest_tracks",
        fake_fallback_recent_interest_tracks,
    )

    name, _description, tracks = mix_generation._build_mix_rows(
        7,
        interest_artists_lower=["known artist"],
        top_genres_lower=["post-hardcore"],
        mix_id="daily-discovery",
        limit=3,
    )

    assert name == "Daily Discovery"
    assert [row["recommendation_source"] for row in tracks] == [
        "discovery",
        "underplayed",
        "comfort",
    ]


def test_my_new_arrivals_uses_release_weeks_and_no_interest_fallback(monkeypatch):
    captured_album_ids: list[int] = []

    def fail_fallback(*_args, **_kwargs):
        raise AssertionError("New Arrivals must not use recent-interest fallback")

    def fake_track_candidates_for_album_ids(
        user_id: int, album_ids: list[int], limit: int
    ) -> list[dict]:
        captured_album_ids.extend(album_ids)
        return [
            _row(2, artist="Last Week Artist", album_id=20),
            _row(1, artist="Current Week Artist", album_id=10),
        ]

    monkeypatch.setattr(mix_generation, "datetime", _FixedDateTime)
    monkeypatch.setattr(
        mix_generation, "_fallback_recent_interest_tracks", fail_fallback
    )
    monkeypatch.setattr(
        mix_generation,
        "_track_candidates_for_album_ids",
        fake_track_candidates_for_album_ids,
    )

    with collect_home_debug() as debug:
        name, _description, tracks = mix_generation._build_mix_rows(
            7,
            interest_artists_lower=["current week artist", "last week artist"],
            top_genres_lower=[],
            mix_id="my-new-arrivals",
            limit=2,
            recent_releases=[
                {
                    "album_id": 20,
                    "album_title": "Last Week",
                    "release_date": "2026-06-04",
                },
                {
                    "album_id": 10,
                    "album_title": "Current Week",
                    "release_date": "2026-06-06",
                },
                {
                    "album_id": 30,
                    "album_title": "Future",
                    "release_date": "2026-06-12",
                },
            ],
        )

    assert name == "My New Arrivals"
    assert captured_album_ids == [10, 20]
    assert [row["album_id"] for row in tracks] == [10, 20]
    assert [row["release_week_label"] for row in tracks] == ["This week", "Last week"]
    assert debug["mixes"]["my-new-arrivals"]["release_week_buckets_used"] == [
        {
            "index": 0,
            "label": "This week",
            "release_week": "2026-06-05",
            "track_count": 1,
        },
        {
            "index": 1,
            "label": "Last week",
            "release_week": "2026-05-29",
            "track_count": 1,
        },
    ]


def test_my_new_arrivals_is_omitted_when_no_release_material(monkeypatch):
    def fail_fallback(*_args, **_kwargs):
        raise AssertionError("New Arrivals must not use recent-interest fallback")

    def fail_track_candidates(*_args, **_kwargs):
        raise AssertionError("No album ids should mean no track query")

    monkeypatch.setattr(mix_generation, "datetime", _FixedDateTime)
    monkeypatch.setattr(
        mix_generation, "_fallback_recent_interest_tracks", fail_fallback
    )
    monkeypatch.setattr(
        mix_generation,
        "_track_candidates_for_album_ids",
        fail_track_candidates,
    )

    assert mix_generation._build_mix_rows(
        7,
        interest_artists_lower=["known artist"],
        top_genres_lower=[],
        mix_id="my-new-arrivals",
        limit=8,
        recent_releases=[],
    ) == ("", "", [])


def test_genre_mix_ranks_direct_matches_before_related_backfill(monkeypatch):
    calls: list[list[str]] = []

    def fake_related_genre_terms(
        value: str, *, limit: int, max_depth: int
    ) -> list[str]:
        return ["screamo", "post-hardcore"]

    def fake_query_discovery_tracks(
        user_id: int,
        *,
        genres: list[str],
        excluded_artist_names: list[str],
        limit: int,
    ) -> list[dict]:
        calls.append(genres)
        if "post-hardcore" in genres:
            return [_row(3, artist="Related Artist", album_id=30)]
        return [
            _row(1, artist="Direct Artist A", album_id=10),
            _row(2, artist="Direct Artist B", album_id=20),
        ]

    monkeypatch.setattr(
        mix_generation, "get_genre_display_name", lambda _slug: "Screamo"
    )
    monkeypatch.setattr(
        mix_generation, "get_related_genre_terms", fake_related_genre_terms
    )
    monkeypatch.setattr(
        mix_generation, "_query_discovery_tracks", fake_query_discovery_tracks
    )

    name, _description, tracks = mix_generation._build_mix_rows(
        7,
        interest_artists_lower=[],
        top_genres_lower=[],
        mix_id="genre-screamo",
        limit=3,
    )

    assert name == "Screamo mix"
    assert calls == [["screamo", "Screamo"], ["post-hardcore"]]
    assert [row["recommendation_source"] for row in tracks] == [
        "direct_genre",
        "direct_genre",
        "related_genre",
    ]


def test_genre_mix_summary_respects_one_track_per_artist(monkeypatch):
    def fake_related_genre_terms(
        value: str, *, limit: int, max_depth: int
    ) -> list[str]:
        return ["screamo"]

    def fake_query_discovery_tracks(
        user_id: int,
        *,
        genres: list[str],
        excluded_artist_names: list[str],
        limit: int,
    ) -> list[dict]:
        if "Screamo" not in genres:
            return []
        return [
            _row(1, artist="Direct Artist A", album_id=10),
            _row(2, artist="Direct Artist A", album_id=20),
            _row(3, artist="Direct Artist B", album_id=30),
        ]

    monkeypatch.setattr(
        mix_generation, "get_genre_display_name", lambda _slug: "Screamo"
    )
    monkeypatch.setattr(
        mix_generation, "get_related_genre_terms", fake_related_genre_terms
    )
    monkeypatch.setattr(
        mix_generation, "_query_discovery_tracks", fake_query_discovery_tracks
    )

    _name, _description, tracks = mix_generation._build_mix_rows(
        7,
        interest_artists_lower=[],
        top_genres_lower=[],
        mix_id="genre-screamo",
        limit=2,
    )

    assert sorted(row["artist"] for row in tracks) == [
        "Direct Artist A",
        "Direct Artist B",
    ]
