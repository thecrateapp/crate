"""Contract tests for stats API MVP."""

from unittest.mock import patch


class TestStatsApiContracts:
    def test_stats_overview_returns_backend_payload(self, test_app):
        payload = {
            "window": "30d",
            "play_count": 48,
            "complete_play_count": 21,
            "skip_count": 9,
            "minutes_listened": 183.5,
            "active_days": 12,
            "skip_rate": 0.1875,
            "top_artist": {
                "artist_name": "Converge",
                "play_count": 10,
                "minutes_listened": 31.0,
            },
        }

        with patch("crate.api.me.get_stats_overview", return_value=payload) as mock_get:
            resp = test_app.get("/api/me/stats/overview?window=30d")

        assert resp.status_code == 200
        data = resp.json()
        for key in (
            "window",
            "play_count",
            "complete_play_count",
            "skip_count",
            "minutes_listened",
            "active_days",
            "skip_rate",
        ):
            assert data[key] == payload[key]
        assert data["top_artist"]["artist_name"] == "Converge"
        assert data["top_artist"]["play_count"] == 10
        mock_get.assert_called_once_with(1, window="30d")

    def test_stats_top_tracks_wraps_items_and_window(self, test_app):
        items = [
            {
                "track_id": 99,
                "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "play_count": 7,
                "complete_play_count": 3,
                "minutes_listened": 8.2,
                "first_played_at": "2026-03-01T10:00:00Z",
                "last_played_at": "2026-04-01T10:00:00Z",
            }
        ]

        with patch("crate.api.me.get_top_tracks", return_value=items) as mock_get:
            resp = test_app.get("/api/me/stats/top-tracks?window=90d&limit=5")

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == "90d"
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["track_id"] == 99
        assert item["title"] == "Concubine"
        assert item["artist"] == "Converge"
        assert item["play_count"] == 7
        mock_get.assert_called_once_with(1, window="90d", limit=5)

    def test_stats_invalid_window_returns_400(self, test_app):
        with patch(
            "crate.api.me.get_stats_trends",
            side_effect=ValueError("Unsupported stats window: banana"),
        ):
            resp = test_app.get("/api/me/stats/trends?window=banana")

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Unsupported stats window: banana"

    def test_stats_replay_returns_playable_payload(self, test_app):
        payload = {
            "window": "30d",
            "title": "Replay this month",
            "subtitle": "The tracks that defined your last 30 days.",
            "track_count": 2,
            "minutes_listened": 42.5,
            "items": [
                {
                    "track_id": 99,
                    "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                    "title": "Concubine",
                    "artist": "Converge",
                    "album": "Jane Doe",
                    "play_count": 7,
                    "complete_play_count": 3,
                    "minutes_listened": 8.2,
                }
            ],
        }

        with patch("crate.api.me.get_replay_mix", return_value=payload) as mock_get:
            resp = test_app.get("/api/me/stats/replay?window=30d&limit=25")

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == "30d"
        assert data["title"] == "Replay this month"
        assert data["track_count"] == 2
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["track_id"] == 99
        assert item["title"] == "Concubine"
        assert item["artist"] == "Converge"
        mock_get.assert_called_once_with(1, window="30d", limit=25)

    def test_stats_dashboard_bundles_the_full_payload(self, test_app):
        overview = {
            "window": "90d",
            "play_count": 48,
            "complete_play_count": 21,
            "skip_count": 9,
            "minutes_listened": 183.5,
            "active_days": 12,
            "skip_rate": 0.1875,
            "top_artist": {
                "artist_name": "Converge",
                "play_count": 10,
                "minutes_listened": 31.0,
            },
        }
        trends = {
            "window": "90d",
            "points": [
                {
                    "day": "2026-04-01",
                    "play_count": 4,
                    "complete_play_count": 2,
                    "skip_count": 1,
                    "minutes_listened": 18.5,
                }
            ],
        }
        top_tracks = [
            {
                "track_id": 99,
                "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "play_count": 7,
                "complete_play_count": 3,
                "minutes_listened": 8.2,
            }
        ]
        top_artists = [
            {
                "artist_name": "Converge",
                "artist_id": 7,
                "play_count": 7,
                "complete_play_count": 3,
                "minutes_listened": 8.2,
            }
        ]
        top_albums = [
            {
                "artist": "Converge",
                "album": "Jane Doe",
                "album_id": 11,
                "play_count": 7,
                "complete_play_count": 3,
                "minutes_listened": 8.2,
            }
        ]
        top_genres = [
            {
                "genre_name": "metalcore",
                "play_count": 7,
                "complete_play_count": 3,
                "minutes_listened": 8.2,
            }
        ]
        replay = {
            "window": "90d",
            "title": "Replay this quarter",
            "subtitle": "The tracks that defined the last 90 days.",
            "track_count": 1,
            "minutes_listened": 8.2,
            "items": top_tracks,
        }
        story = {
            "window": "90d",
            "movers": [
                {
                    "artist_name": "Converge",
                    "artist_id": 7,
                    "play_count": 7,
                    "previous_play_count": 1,
                    "delta_play_count": 6,
                    "minutes_listened": 8.2,
                }
            ],
            "discoveries": [],
            "comebacks": [],
            "rhythm": {
                "peak_hour": 21,
                "peak_hour_label": "21:00",
                "peak_weekday": "Friday",
                "peak_hour_play_count": 6,
                "peak_weekday_play_count": 9,
            },
            "audio_profile": {
                "energy": 0.82,
                "danceability": 0.42,
                "valence": 0.22,
                "bpm": 142.5,
            },
            "monthly_snapshots": [
                {
                    "month_key": "2026-04",
                    "month_start": "2026-04-01",
                    "title": "April 2026",
                    "subtitle": "Converge and more",
                    "play_count": 7,
                    "minutes_listened": 8.2,
                    "active_days": 3,
                    "top_artists": [
                        {
                            "artist_name": "Converge",
                            "play_count": 7,
                            "minutes_listened": 8.2,
                        }
                    ],
                    "covers": [
                        {
                            "track_id": 99,
                            "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                            "title": "Concubine",
                            "artist": "Converge",
                            "album": "Jane Doe",
                            "album_id": 11,
                        }
                    ],
                }
            ],
        }

        with (
            patch("crate.api.me.get_cache", return_value=None),
            patch("crate.api.me.set_cache") as mock_set_cache,
            patch(
                "crate.api.me.get_stats_overview", return_value=overview
            ) as mock_overview,
            patch("crate.api.me.get_stats_trends", return_value=trends) as mock_trends,
            patch(
                "crate.api.me.get_top_tracks", return_value=top_tracks
            ) as mock_top_tracks,
            patch(
                "crate.api.me.get_top_artists", return_value=top_artists
            ) as mock_top_artists,
            patch(
                "crate.api.me.get_top_albums", return_value=top_albums
            ) as mock_top_albums,
            patch(
                "crate.api.me.get_top_genres", return_value=top_genres
            ) as mock_top_genres,
            patch("crate.api.me.get_replay_mix", return_value=replay) as mock_replay,
            patch("crate.api.me.get_stats_story", return_value=story) as mock_story,
        ):
            resp = test_app.get(
                "/api/me/stats/dashboard"
                "?window=90d&tracks_limit=5&artists_limit=4&albums_limit=3&genres_limit=2&replay_limit=9"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == "90d"
        assert data["overview"]["play_count"] == 48
        assert data["trends"]["points"][0]["day"] == "2026-04-01"
        assert data["top_tracks"]["items"][0]["title"] == "Concubine"
        assert data["top_artists"]["items"][0]["artist_name"] == "Converge"
        assert data["top_albums"]["items"][0]["album"] == "Jane Doe"
        assert data["top_genres"]["items"][0]["genre_name"] == "metalcore"
        assert data["replay"]["title"] == "Replay this quarter"
        assert data["story"]["movers"][0]["delta_play_count"] == 6
        assert data["story"]["audio_profile"]["energy"] == 0.82
        assert data["story"]["monthly_snapshots"][0]["title"] == "April 2026"

        mock_overview.assert_called_once_with(1, window="90d")
        mock_trends.assert_called_once_with(1, window="90d")
        mock_top_tracks.assert_called_once_with(1, window="90d", limit=5)
        mock_top_artists.assert_called_once_with(1, window="90d", limit=4)
        mock_top_albums.assert_called_once_with(1, window="90d", limit=3)
        mock_top_genres.assert_called_once_with(1, window="90d", limit=2)
        mock_replay.assert_called_once_with(1, window="90d", limit=9)
        mock_story.assert_called_once_with(1, window="90d")
        mock_set_cache.assert_called_once()

    def test_stats_dashboard_supports_month_snapshots(self, test_app):
        period = "month:2026-04"
        overview = {
            "window": period,
            "play_count": 12,
            "complete_play_count": 10,
            "skip_count": 1,
            "minutes_listened": 44.0,
            "active_days": 4,
            "skip_rate": 1 / 12,
            "top_artist": None,
        }
        trends = {
            "window": period,
            "points": [
                {
                    "day": "2026-04-12",
                    "play_count": 4,
                    "complete_play_count": 3,
                    "skip_count": 1,
                    "minutes_listened": 18.0,
                }
            ],
        }
        top_tracks = [
            {
                "track_id": 99,
                "track_path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                "title": "Concubine",
                "artist": "Converge",
                "album": "Jane Doe",
                "play_count": 7,
                "complete_play_count": 6,
                "minutes_listened": 8.2,
            }
        ]
        replay = {
            "window": period,
            "title": "Replay April 2026",
            "subtitle": "The tracks that defined April 2026.",
            "track_count": 1,
            "minutes_listened": 8.2,
            "items": top_tracks,
        }
        story = {
            "window": period,
            "movers": [],
            "discoveries": [],
            "comebacks": [],
            "rhythm": {
                "peak_hour": 21,
                "peak_hour_label": "21:00",
                "peak_weekday": "Friday",
                "peak_hour_play_count": 6,
                "peak_weekday_play_count": 9,
            },
            "audio_profile": {
                "energy": 0.82,
                "danceability": 0.42,
                "valence": 0.22,
                "bpm": 142.5,
            },
            "monthly_snapshots": [],
        }

        with (
            patch("crate.api.me.get_cache", return_value=None),
            patch("crate.api.me.set_cache"),
            patch(
                "crate.api.me.get_month_stats_overview", return_value=overview
            ) as mock_overview,
            patch(
                "crate.api.me.get_month_stats_trends", return_value=trends
            ) as mock_trends,
            patch(
                "crate.api.me.get_month_top_tracks", return_value=top_tracks
            ) as mock_top_tracks,
            patch(
                "crate.api.me.get_month_top_artists", return_value=[]
            ) as mock_artists,
            patch("crate.api.me.get_month_top_albums", return_value=[]) as mock_albums,
            patch("crate.api.me.get_month_top_genres", return_value=[]) as mock_genres,
            patch(
                "crate.api.me.get_month_replay_mix", return_value=replay
            ) as mock_replay,
            patch("crate.api.me.get_stats_story", return_value=story) as mock_story,
        ):
            resp = test_app.get(
                "/api/me/stats/dashboard?month=2026-04&tracks_limit=5&artists_limit=4&albums_limit=3&genres_limit=2&replay_limit=9"
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["window"] == period
        assert data["overview"]["active_days"] == 4
        assert data["replay"]["title"] == "Replay April 2026"
        mock_overview.assert_called_once_with(1, "2026-04")
        mock_trends.assert_called_once_with(1, "2026-04")
        mock_top_tracks.assert_called_once_with(1, "2026-04", limit=5)
        mock_artists.assert_called_once_with(1, "2026-04", limit=4)
        mock_albums.assert_called_once_with(1, "2026-04", limit=3)
        mock_genres.assert_called_once_with(1, "2026-04", limit=2)
        mock_replay.assert_called_once_with(1, "2026-04", limit=9)
        mock_story.assert_called_once_with(1, window="30d", month="2026-04")

    def test_public_user_stats_dashboard_includes_subject_and_affinity(self, test_app):
        dashboard = {
            "window": "30d",
            "overview": {
                "window": "30d",
                "play_count": 4,
                "complete_play_count": 3,
                "skip_count": 0,
                "minutes_listened": 12.0,
                "active_days": 2,
                "skip_rate": 0,
                "top_artist": None,
            },
            "trends": {"window": "30d", "points": []},
            "top_tracks": {"window": "30d", "items": []},
            "top_artists": {"window": "30d", "items": []},
            "top_albums": {"window": "30d", "items": []},
            "top_genres": {"window": "30d", "items": []},
            "replay": {
                "window": "30d",
                "title": "Replay",
                "subtitle": "Recent signal.",
                "track_count": 0,
                "minutes_listened": 0,
                "items": [],
            },
            "story": {
                "window": "30d",
                "movers": [],
                "discoveries": [],
                "comebacks": [],
                "rhythm": {
                    "peak_hour": None,
                    "peak_hour_label": None,
                    "peak_weekday": None,
                    "peak_hour_play_count": 0,
                    "peak_weekday_play_count": 0,
                },
                "audio_profile": {
                    "energy": 0,
                    "danceability": 0,
                    "valence": 0,
                    "bpm": None,
                },
                "monthly_snapshots": [],
            },
        }

        with (
            patch(
                "crate.api.social.get_public_user_profile_by_username",
                return_value={
                    "id": 2,
                    "username": "diego",
                    "display_name": "Diego",
                    "avatar": "avatar.jpg",
                },
            ),
            patch(
                "crate.api.social._get_cached_stats_dashboard",
                return_value=dashboard,
            ) as mock_dashboard,
            patch(
                "crate.api.social.get_affinity",
                return_value={
                    "affinity_score": 72,
                    "affinity_band": "high",
                    "affinity_reasons": ["3 shared top artists"],
                },
            ),
        ):
            resp = test_app.get("/api/users/diego/stats/dashboard?window=30d")

        assert resp.status_code == 200
        data = resp.json()
        assert data["subject"]["username"] == "diego"
        assert data["subject"]["display_name"] == "Diego"
        assert data["viewer_affinity"]["affinity_score"] == 72
        mock_dashboard.assert_called_once()

    def test_instance_stats_dashboard_returns_global_subject(self, test_app):
        overview = {
            "window": "30d",
            "play_count": 9,
            "complete_play_count": 8,
            "skip_count": 1,
            "minutes_listened": 30.0,
            "active_days": 3,
            "skip_rate": 1 / 9,
            "top_artist": None,
        }
        replay = {
            "window": "30d",
            "title": "Crate replay",
            "subtitle": "Instance signal.",
            "track_count": 0,
            "minutes_listened": 0,
            "items": [],
        }
        story = {
            "window": "30d",
            "movers": [],
            "discoveries": [],
            "comebacks": [],
            "rhythm": {
                "peak_hour": None,
                "peak_hour_label": None,
                "peak_weekday": None,
                "peak_hour_play_count": 0,
                "peak_weekday_play_count": 0,
            },
            "audio_profile": {
                "energy": 0,
                "danceability": 0,
                "valence": 0,
                "bpm": None,
            },
            "monthly_snapshots": [],
        }

        with (
            patch("crate.api.analytics.get_cache", return_value=None),
            patch("crate.api.analytics.set_cache"),
            patch(
                "crate.api.analytics.get_global_stats_overview", return_value=overview
            ),
            patch(
                "crate.api.analytics.get_global_stats_trends",
                return_value={"window": "30d", "points": []},
            ),
            patch("crate.api.analytics.get_global_top_tracks", return_value=[]),
            patch("crate.api.analytics.get_global_top_artists", return_value=[]),
            patch("crate.api.analytics.get_global_top_albums", return_value=[]),
            patch("crate.api.analytics.get_global_top_genres", return_value=[]),
            patch("crate.api.analytics.get_global_replay_mix", return_value=replay),
            patch("crate.api.analytics.get_global_stats_story", return_value=story),
        ):
            resp = test_app.get("/api/stats/dashboard?window=30d")

        assert resp.status_code == 200
        data = resp.json()
        assert data["subject"]["kind"] == "instance"
        assert data["subject"]["display_name"] == "Crate"
        assert data["overview"]["play_count"] == 9
