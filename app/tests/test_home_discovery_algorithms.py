from unittest.mock import patch
from datetime import datetime, timezone


def _home_context(top_artists=None):
    return {
        "top_artists": top_artists or [],
        "top_albums": [],
        "top_genres_lower": [],
        "mix_seed_genres": [],
        "interest_artists_lower": [],
        "followed_names_lower": [],
        "top_artist_names_lower": [],
        "saved_album_ids": [],
    }


def test_home_essentials_builds_seven_core_track_cards():
    from crate.db.home_personalized_collections import get_home_essentials

    context = _home_context(
        top_artists=[
            {"artist_id": index, "artist_name": f"Artist {index}"}
            for index in range(10)
        ]
    )

    with (
        patch(
            "crate.db.home_personalized_collections.get_cached_home_context",
            return_value=context,
        ),
        patch(
            "crate.db.home_personalized_collections.merged_artists_from_context",
            return_value=context["top_artists"],
        ),
        patch(
            "crate.db.home_personalized_collections._build_core_playlists",
            return_value=[],
        ) as build_core,
        patch(
            "crate.db.home_personalized_collections._build_core_discovery_artists",
            return_value=[],
        ),
    ):
        get_home_essentials(1)

    build_core.assert_called_once_with(
        1, context["top_artists"], 7, discovery_artists=[]
    )


def test_home_core_tracks_section_caps_at_seven_cards():
    from crate.db.home_personalized_discovery import get_home_section

    context = _home_context(
        top_artists=[
            {"artist_id": index, "artist_name": f"Artist {index}"}
            for index in range(10)
        ]
    )

    with (
        patch(
            "crate.db.home_personalized_discovery.get_cached_home_context",
            return_value=context,
        ),
        patch(
            "crate.db.home_personalized_discovery.recent_releases_from_context",
            return_value=[],
        ),
        patch(
            "crate.db.home_personalized_discovery._build_core_playlists",
            return_value=[],
        ) as build_core,
        patch(
            "crate.db.home_personalized_discovery._build_core_discovery_artists",
            return_value=[],
        ),
    ):
        section = get_home_section(1, "core-tracks", limit=42)

    assert section is not None
    build_core.assert_called_once_with(
        1, context["top_artists"], 7, discovery_artists=[]
    )


def test_core_tracks_blend_orders_discovery_before_comfort():
    from crate.db.home_builder_curated_lists import _blend_core_candidates

    discovery = [
        {"artist_id": index, "artist_name": f"Discovery {index}"}
        for index in range(1, 5)
    ]
    comfort = [
        {"artist_id": index + 100, "artist_name": f"Comfort {index}"}
        for index in range(1, 5)
    ]

    selected = _blend_core_candidates(comfort, discovery, limit=7)

    assert [row["recommendation_source"] for row in selected] == [
        "discovery",
        "discovery",
        "discovery",
        "comfort",
        "comfort",
        "comfort",
        "comfort",
    ]
    assert [row["artist_name"] for row in selected[:3]] == [
        "Discovery 1",
        "Discovery 2",
        "Discovery 3",
    ]


def test_listening_history_cards_put_all_time_before_months(monkeypatch):
    from crate.db.queries import user_library_stats_tops

    monkeypatch.setattr(
        user_library_stats_tops,
        "_get_all_time_history_card",
        lambda user_id: {
            "id": "all-time",
            "kind": "all_time",
            "title": "My Most Listened",
            "period_label": "MY MOST LISTENED",
            "period_start": "all_time",
            "subtitle": "Converge",
            "top_artists": ["Converge"],
            "play_count": 12,
            "minutes_listened": 44.0,
            "artwork_tracks": [],
        },
    )

    class FakeResult:
        def mappings(self):
            return self

        def all(self):
            return [
                {
                    "ended_at": datetime(2026, 5, 12, tzinfo=timezone.utc),
                    "title": "Concubine",
                    "artist": "Converge",
                    "album": "Jane Doe",
                    "artist_id": 1,
                    "artist_entity_uid": "artist-1",
                    "artist_slug": "converge",
                    "album_id": 2,
                    "album_entity_uid": "album-2",
                    "album_slug": "jane-doe",
                    "played_seconds": 79,
                }
            ]

    class FakeSession:
        def execute(self, *_args, **_kwargs):
            return FakeResult()

    class FakeReadScope:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(user_library_stats_tops, "read_scope", FakeReadScope)

    cards = user_library_stats_tops.get_listening_history_cards(1)

    assert cards[0]["kind"] == "all_time"
    assert cards[0]["title"] == "My Most Listened"
    assert cards[1]["kind"] == "month"
    assert cards[1]["title"] == "May 2026"


def test_core_tracks_prefers_existing_system_playlist(monkeypatch):
    from crate.db import home_builder_curated_lists

    monkeypatch.setattr(
        home_builder_curated_lists,
        "list_system_playlists",
        lambda **_: [
            {
                "id": 99,
                "name": "Converge Core Tracks",
                "description": "The clearest entry point into Converge.",
                "scope": "system",
                "generation_mode": "smart",
                "is_active": True,
                "curation_key": "blueprint:artist:converge:artist-essentials",
                "smart_rules": {"rules": [{"field": "artist", "value": "Converge"}]},
                "track_count": 40,
                "artwork_tracks": [],
            }
        ],
    )
    monkeypatch.setattr(
        home_builder_curated_lists,
        "get_artists_core_track_rows",
        lambda **_: [],
    )

    items = home_builder_curated_lists._build_core_playlists(
        1,
        [{"artist_id": 12, "artist_name": "Converge"}],
        limit=1,
    )

    assert items[0]["id"] == "system-playlist-99"
    assert items[0]["source"] == "system"


def test_album_candidate_rows_include_user_feedback_signals(monkeypatch):
    from crate.db.queries import home_track_album_candidates

    captured = {}

    def fake_fetch_rows(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(home_track_album_candidates, "_fetch_rows", fake_fetch_rows)

    home_track_album_candidates.get_track_candidates_for_album_ids(
        user_id=9,
        album_ids=list(range(40)),
        limit=20,
    )

    assert captured["params"]["user_id"] == 9
    assert captured["params"]["album_ids"] == list(range(30))
    assert "AS user_play_count" in captured["sql"]
    assert "AS is_liked" in captured["sql"]
    assert "user_track_stats" in captured["sql"]
    assert "user_liked_tracks" in captured["sql"]


def test_discovery_track_rows_include_user_feedback_signals(monkeypatch):
    from crate.db.queries import home_track_discovery

    captured = {}

    def fake_fetch_rows(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(home_track_discovery, "_fetch_rows", fake_fetch_rows)

    home_track_discovery.get_discovery_track_rows(
        user_id=9,
        genres=["punk"],
        excluded_artist_names=["converge"],
        limit=20,
    )

    assert captured["params"]["genres"] == ["punk"]
    assert captured["params"]["excluded"] == ["converge"]
    assert captured["params"]["user_id"] == 9
    assert "WITH matching_artists AS MATERIALIZED" in captured["sql"]
    assert "AS user_play_count" in captured["sql"]
    assert "AS is_liked" in captured["sql"]


def test_recent_interest_rows_include_user_feedback_signals(monkeypatch):
    from crate.db.queries import home_track_recent_interest

    captured = {}

    def fake_fetch_rows(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(home_track_recent_interest, "_fetch_rows", fake_fetch_rows)

    home_track_recent_interest.get_recent_interest_track_rows(
        user_id=9,
        interest_artists_lower=["converge"],
        limit=20,
    )

    assert captured["params"]["user_id"] == 9
    assert captured["params"]["artists"] == ["converge"]
    assert "AS user_play_count" in captured["sql"]
    assert "AS is_liked" in captured["sql"]


def test_daily_discovery_rotates_candidates_before_selection(monkeypatch):
    import crate.db.home_builder_mix_generation as home_builder_mix_generation

    rows = [
        {
            "track_id": index,
            "track_path": f"/music/artist-{index}/track.flac",
            "title": f"Track {index}",
            "artist": f"Artist {index}",
            "album": f"Album {index}",
            "user_play_count": 0,
            "is_liked": False,
        }
        for index in range(5)
    ]

    monkeypatch.setattr(
        home_builder_mix_generation,
        "_query_discovery_tracks",
        lambda *args, **kwargs: rows,
    )
    monkeypatch.setattr(
        home_builder_mix_generation,
        "_daily_rotation_index",
        lambda pool_size, user_id: 2,
    )

    _, _, selected = home_builder_mix_generation._build_mix_rows(
        1,
        interest_artists_lower=[],
        top_genres_lower=["punk"],
        mix_id="daily-discovery",
        limit=3,
    )

    assert [row["title"] for row in selected] == ["Track 2", "Track 3", "Track 4"]
