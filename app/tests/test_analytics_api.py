"""Contract tests for the Admin Analytics API endpoints."""

from unittest.mock import patch


async def _unauthenticated(self, request):
    return None


class TestAnalyticsOverview:
    def test_get_analytics_returns_snapshot_payload(self, test_app):
        snapshot = {
            "analytics": {
                "formats": {"flac": 100},
                "decades": {"2000s": 50},
            }
        }
        with patch(
            "crate.api.analytics.get_cached_ops_snapshot", return_value=snapshot
        ):
            resp = test_app.get("/api/analytics")
        assert resp.status_code == 200
        assert resp.json()["formats"] == {"flac": 100}

    def test_get_analytics_empty_snapshot_returns_defaults(self, test_app):
        with patch("crate.api.analytics.get_cached_ops_snapshot", return_value={}):
            resp = test_app.get("/api/analytics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["formats"] == {}
        assert data["decades"] == {}
        assert data["computing"] is None
        assert data["avg_tracks_per_album"] == 0

    def test_get_analytics_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/analytics")
        assert resp.status_code == 401


class TestStatsAPI:
    def test_get_stats_from_snapshot(self, test_app):
        snapshot = {
            "stats": {
                "artists": 100,
                "albums": 500,
                "tracks": 5000,
                "formats": {"flac": 4000},
                "total_size_gb": 1024,
                "last_scan": None,
                "pending_imports": 7,
                "pending_tasks": 2,
                "total_duration_hours": 320.4,
                "avg_bitrate": 914,
                "top_genres": [],
                "recent_albums": [],
                "analyzed_tracks": 4900,
                "avg_album_duration_min": 41.2,
                "avg_tracks_per_album": 10.0,
            }
        }
        with patch(
            "crate.api.analytics.get_cached_ops_snapshot", return_value=snapshot
        ):
            resp = test_app.get("/api/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["artists"] == 100
        assert data["pending_imports"] == 7
        assert data["pending_tasks"] == 2

    def test_get_stats_fallback_empty_shape(self, test_app):
        with (
            patch("crate.api.analytics.get_cached_ops_snapshot", return_value={}),
            patch("crate.api.analytics.count_import_queue_items", return_value=0),
            patch("crate.api.analytics.list_tasks", return_value=[]),
        ):
            resp = test_app.get("/api/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["artists"] == 0
        assert data["albums"] == 0
        assert data["tracks"] == 0
        assert data["top_genres"] == []
        assert data["recent_albums"] == []

    def test_get_stats_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/stats")
        assert resp.status_code == 401


class TestActivityAPI:
    def test_activity_recent_returns_snapshot(self, test_app):
        snapshot = {"tasks": [], "pending_imports": 3, "last_scan": None}
        with patch(
            "crate.api.analytics.get_cached_ops_snapshot",
            return_value={"recent": snapshot},
        ):
            resp = test_app.get("/api/activity/recent")
        assert resp.status_code == 200
        assert resp.json()["pending_imports"] == 3

    def test_activity_live_returns_snapshot(self, test_app):
        snapshot = {
            "engine": "dramatiq",
            "worker_slots": {"max": 8, "active": 3},
            "systems": {"postgres": True, "watcher": True},
        }
        with patch(
            "crate.api.analytics.get_cached_ops_snapshot",
            return_value={"live": snapshot},
        ):
            resp = test_app.get("/api/activity/live")
        assert resp.status_code == 200
        assert resp.json()["engine"] == "dramatiq"
        assert resp.json()["systems"]["postgres"] is True

    def test_activity_recent_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/activity/recent")
        assert resp.status_code == 401


class TestTimelineAPI:
    def test_timeline_empty_when_no_library_data(self, test_app):
        with patch("crate.api.analytics._has_library_data", return_value=False):
            resp = test_app.get("/api/timeline")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_timeline_groups_albums_by_year(self, test_app):
        rows = [
            {
                "id": 1,
                "entity_uid": None,
                "slug": "album-a",
                "year": "2001",
                "artist": "Artist A",
                "artist_id": 1,
                "artist_entity_uid": None,
                "artist_slug": "artist-a",
                "name": "Album A",
                "track_count": 10,
            },
            {
                "id": 2,
                "entity_uid": None,
                "slug": "album-b",
                "year": "2001",
                "artist": "Artist B",
                "artist_id": 2,
                "artist_entity_uid": None,
                "artist_slug": "artist-b",
                "name": "Album B",
                "track_count": 8,
            },
        ]
        with (
            patch("crate.api.analytics._has_library_data", return_value=True),
            patch("crate.api.analytics.get_timeline_albums", return_value=rows),
        ):
            resp = test_app.get("/api/timeline")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["2001"]) == 2
        assert data["2001"][0]["album"] == "Album A"

    def test_timeline_sorted_by_year(self, test_app):
        rows = [
            {
                "id": 3,
                "entity_uid": None,
                "slug": "c",
                "year": "2010",
                "artist": "C",
                "artist_id": 3,
                "artist_entity_uid": None,
                "artist_slug": "c",
                "name": "Album C",
                "track_count": 5,
            },
            {
                "id": 1,
                "entity_uid": None,
                "slug": "a",
                "year": "1995",
                "artist": "A",
                "artist_id": 1,
                "artist_entity_uid": None,
                "artist_slug": "a",
                "name": "Album A",
                "track_count": 10,
            },
        ]
        with (
            patch("crate.api.analytics._has_library_data", return_value=True),
            patch("crate.api.analytics.get_timeline_albums", return_value=rows),
        ):
            resp = test_app.get("/api/timeline")
        assert resp.status_code == 200
        years = list(resp.json().keys())
        assert years == ["1995", "2010"]

    def test_timeline_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/timeline")
        assert resp.status_code == 401


class TestMissingAlbumsAPI:
    def test_missing_albums_by_id_artist_not_found(self, test_app):
        with patch("crate.api.analytics.artist_name_from_id", return_value=None):
            resp = test_app.get("/api/artists/999/missing")
        assert resp.status_code == 404

    def test_missing_albums_by_entity_uid_artist_not_found(self, test_app):
        with patch(
            "crate.api.analytics.artist_name_from_entity_uid", return_value=None
        ):
            resp = test_app.get("/api/artists/by-entity/nonexistent/missing")
        assert resp.status_code == 404

    def test_missing_search_empty_query_returns_404(self, test_app):
        resp = test_app.get("/api/missing-search?q=")
        assert resp.status_code == 404

    def test_missing_search_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/missing-search?q=Radiohead")
        assert resp.status_code == 401


class TestArtistStatsAPI:
    def test_artist_stats_by_id_not_found(self, test_app):
        with patch("crate.api.analytics.artist_name_from_id", return_value=None):
            resp = test_app.get("/api/artists/999/stats")
        assert resp.status_code == 404

    def test_artist_stats_by_entity_uid_not_found(self, test_app):
        with patch(
            "crate.api.analytics.artist_name_from_entity_uid", return_value=None
        ):
            resp = test_app.get("/api/artists/by-entity/nonexistent/stats")
        assert resp.status_code == 404

    def test_artist_stats_returns_all_sections(self, test_app):
        with (
            patch("crate.api.analytics.artist_name_from_id", return_value="Tool"),
            patch(
                "crate.api.analytics.get_library_artist",
                return_value={"name": "Tool"},
            ),
            patch(
                "crate.api.analytics.get_artist_format_distribution",
                return_value={"flac": 50},
            ),
            patch(
                "crate.api.analytics.get_artist_albums_timeline",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_artist_audio_by_album",
                return_value=[],
            ),
            patch("crate.api.analytics.get_artist_top_tracks", return_value=[]),
            patch("crate.api.analytics.get_artist_genre_tags", return_value=[]),
        ):
            resp = test_app.get("/api/artists/7/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "formats" in data
        assert "albums_timeline" in data
        assert "audio_by_album" in data
        assert "top_tracks_by_popularity" in data
        assert "genres" in data

    def test_artist_stats_requires_auth(self, test_app):
        with (
            patch(
                "crate.api.analytics.artist_name_from_id",
                return_value="Tool",
            ),
            patch(
                "crate.api.auth.AuthMiddleware.resolve_user",
                _unauthenticated,
            ),
        ):
            resp = test_app.get("/api/artists/7/stats")
        assert resp.status_code == 401


class TestInsightsAPI:
    def test_insights_returns_all_sections(self, test_app):
        with (
            patch("crate.api.analytics.get_insights_countries", return_value=[]),
            patch(
                "crate.api.analytics.get_insights_bpm_distribution",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_insights_energy_danceability",
                return_value=[],
            ),
            patch("crate.api.analytics.get_insights_top_genres", return_value=[]),
            patch("crate.api.analytics.get_insights_popularity", return_value=[]),
            patch(
                "crate.api.analytics.get_insights_feature_coverage",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_insights_artist_depth",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_insights_albums_by_year",
                return_value=[],
            ),
            patch("crate.api.analytics.get_insights_top_albums", return_value=[]),
            patch(
                "crate.api.analytics.get_insights_acoustic_instrumental",
                return_value=[],
            ),
        ):
            resp = test_app.get("/api/insights")
        assert resp.status_code == 200
        data = resp.json()
        for key in (
            "countries",
            "bpm_distribution",
            "energy_danceability",
            "top_genres",
            "popularity",
            "albums_by_decade",
            "feature_coverage",
            "artist_depth",
            "top_albums",
            "acoustic_instrumental",
        ):
            assert key in data, f"Missing key: {key}"

    def test_insights_ensures_popularity_score_float(self, test_app):
        rows = [
            {
                "name": "1984",
                "artist": "Van Halen",
                "lastfm_listeners": None,
                "popularity": None,
                "popularity_score": 0.8234,
                "year": "1984",
            }
        ]
        with (
            patch("crate.api.analytics.get_insights_countries", return_value=[]),
            patch(
                "crate.api.analytics.get_insights_bpm_distribution",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_insights_energy_danceability",
                return_value=[],
            ),
            patch("crate.api.analytics.get_insights_top_genres", return_value=[]),
            patch("crate.api.analytics.get_insights_popularity", return_value=[]),
            patch(
                "crate.api.analytics.get_insights_feature_coverage",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_insights_artist_depth",
                return_value=[],
            ),
            patch(
                "crate.api.analytics.get_insights_albums_by_year",
                return_value=[],
            ),
            patch("crate.api.analytics.get_insights_top_albums", return_value=rows),
            patch(
                "crate.api.analytics.get_insights_acoustic_instrumental",
                return_value=[],
            ),
        ):
            resp = test_app.get("/api/insights")
        assert resp.status_code == 200
        top = resp.json()["top_albums"]
        assert len(top) == 1
        assert top[0]["popularity_score"] == 0.8234
        assert top[0]["popularity"] == 82

    def test_insights_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/insights")
        assert resp.status_code == 401
