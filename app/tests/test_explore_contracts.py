"""Regression contracts for Listen Explore endpoints."""

from unittest.mock import MagicMock, patch
from contextlib import contextmanager


def _make_mock_session(fetchall_side_effects: list[list[dict]]):
    """Create a mock session that returns successive results for .execute().mappings().all()/.first()."""
    call_index = [0]

    class MockMappings:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

        def first(self):
            return self._rows[0] if self._rows else None

    class MockSession:
        def execute(self, *args, **kwargs):
            idx = call_index[0]
            call_index[0] += 1
            rows = (
                fetchall_side_effects[idx] if idx < len(fetchall_side_effects) else []
            )
            return MagicMock(mappings=lambda: MockMappings(rows))

    @contextmanager
    def mock_scope():
        yield MockSession()

    return mock_scope


class TestExploreFiltersContract:
    def test_browse_filters_exposes_genres_and_decades(self, test_app):
        mock_scope = _make_mock_session(
            [
                [{"name": "Metalcore", "cnt": 4}, {"name": "Post-Hardcore", "cnt": 2}],
                [],
                [{"country": "US", "cnt": 3}],
                [
                    {"year": "1994"},
                    {"year": "2005"},
                    {"year": "2001"},
                ],
                [{"format": "FLAC", "cnt": 12}],
            ]
        )

        with patch("crate.db.queries.browse_artist_filters.read_scope", mock_scope):
            resp = test_app.get("/api/browse/filters")
            assert resp.status_code == 200
            data = resp.json()
            assert [genre["name"] for genre in data["genres"]] == [
                "Metalcore",
                "Post-Hardcore",
            ]
            assert data["genres"][0]["description"] is None
            assert data["genres"][0]["top_artists"] == []
            assert data["genres"][0]["cover_url"] is None
            assert data["decades"] == ["1990s", "2000s"]
            assert data["formats"][0]["name"] == "FLAC"

    def test_explore_page_bundles_filters_playlists_and_moods(self, test_app):
        playlist_rows = [
            {
                "id": index,
                "name": f"Playlist {index}",
                "track_count": 12,
                "is_smart": False,
                "follower_count": 0,
                "is_followed": False,
            }
            for index in range(1, 11)
        ]

        with (
            patch(
                "crate.api.browse.api_browse_filters",
                return_value={
                    "genres": [{"name": "Metalcore", "count": 4}],
                    "countries": [],
                    "decades": ["2000s"],
                    "formats": [],
                },
            ),
            patch("crate.api.browse.curated_playlists", return_value=playlist_rows),
            patch(
                "crate.api.browse.api_browse_moods",
                return_value=[
                    {
                        "name": "energetic",
                        "track_count": 42,
                        "filters": {"energy_min": 0.7},
                    }
                ],
            ),
        ):
            resp = test_app.get("/api/browse/explore-page")
            assert resp.status_code == 200
            data = resp.json()
            assert data["filters"]["genres"][0]["name"] == "Metalcore"
            assert len(data["playlists"]) == 8
            assert data["playlists"][0]["name"] == "Playlist 1"
            assert data["moods"][0]["name"] == "energetic"

    def test_explore_page_uses_global_genre_ranking_and_artwork_when_ready(
        self,
        test_app,
        monkeypatch,
    ):
        from crate.api import browse

        monkeypatch.setattr(
            browse,
            "get_catalog_state",
            lambda: {"status": "ready", "last_full_reconcile_at": object()},
            raising=False,
        )
        monkeypatch.setattr(
            browse,
            "catalog_serves_global",
            lambda state: state["status"] == "ready",
            raising=False,
        )
        monkeypatch.setattr(
            browse,
            "list_global_catalog_genres",
            lambda: [
                {
                    "canonical_name": "Death Metal",
                    "canonical_slug": "death-metal",
                    "artist_count": 2,
                    "description": "Extreme metal rooted in speed and precision.",
                    "top_artists": ["Death", "BLOCKHEADS"],
                    "cover_url": (
                        "/api/catalog/artists/death-global/background"
                        "?size=640&format=webp"
                    ),
                }
            ],
            raising=False,
        )

        with (
            patch(
                "crate.api.browse.api_browse_filters",
                return_value={
                    "genres": [{"name": "Legacy Genre", "count": 99}],
                    "countries": [],
                    "decades": [],
                    "formats": [],
                },
            ),
            patch("crate.api.browse.curated_playlists", return_value=[]),
            patch("crate.api.browse.api_browse_moods", return_value=[]),
            patch("crate.api.browse.get_cache", return_value=None),
            patch("crate.api.browse.set_cache"),
        ):
            response = test_app.get("/api/browse/explore-page")

        assert response.status_code == 200
        assert response.json()["filters"]["genres"] == [
            {
                "name": "Death Metal",
                "slug": "death-metal",
                "cnt": 2,
                "count": 2,
                "description": "Extreme metal rooted in speed and precision.",
                "top_artists": ["Death", "BLOCKHEADS"],
                "cover_url": (
                    "/api/catalog/artists/death-global/background?size=640&format=webp"
                ),
            }
        ]

    def test_explore_page_reads_persisted_global_genre_snapshot(
        self,
        test_app,
        monkeypatch,
    ):
        from crate.api import browse

        monkeypatch.setattr(
            browse,
            "get_catalog_state",
            lambda: {"status": "ready", "last_full_reconcile_at": object()},
        )
        monkeypatch.setattr(browse, "catalog_serves_global", lambda _state: True)
        monkeypatch.setattr(
            browse,
            "get_ui_snapshot",
            lambda scope, subject_key, **_kwargs: {
                "scope": scope,
                "subject_key": subject_key,
                "payload_json": {
                    "items": [
                        {
                            "canonical_name": "Death Metal",
                            "canonical_slug": "death-metal",
                            "artist_count": 2,
                            "description": "Extreme metal.",
                            "top_artists": ["Death"],
                            "cover_url": "/api/genres/death-metal/cover",
                        }
                    ]
                },
                "version": 4,
            },
            raising=False,
        )
        monkeypatch.setattr(
            browse,
            "list_global_catalog_genres",
            MagicMock(side_effect=AssertionError("live genre query must stay cold")),
        )

        with (
            patch(
                "crate.api.browse.api_browse_filters",
                return_value={
                    "genres": [{"name": "Legacy Genre", "count": 99}],
                    "countries": [],
                    "decades": [],
                    "formats": [],
                },
            ),
            patch("crate.api.browse.curated_playlists", return_value=[]),
            patch("crate.api.browse.api_browse_moods", return_value=[]),
            patch("crate.api.browse.get_cache", return_value=None),
            patch("crate.api.browse.set_cache"),
        ):
            response = test_app.get("/api/browse/explore-page")

        assert response.status_code == 200
        assert response.json()["filters"]["genres"][0]["name"] == "Death Metal"

    def test_explore_page_keeps_local_genres_during_catalog_warming(
        self,
        test_app,
        monkeypatch,
    ):
        from crate.api import browse

        monkeypatch.setattr(
            browse,
            "get_catalog_state",
            lambda: {"status": "backfilling", "last_full_reconcile_at": None},
            raising=False,
        )
        monkeypatch.setattr(
            browse,
            "catalog_serves_global",
            lambda state: False,
            raising=False,
        )
        monkeypatch.setattr(
            browse,
            "list_global_catalog_genres",
            MagicMock(side_effect=AssertionError("global genres must not be read")),
            raising=False,
        )
        local_genres = [{"name": "Local Genre", "count": 4}]

        with (
            patch(
                "crate.api.browse.api_browse_filters",
                return_value={
                    "genres": local_genres,
                    "countries": [],
                    "decades": [],
                    "formats": [],
                },
            ),
            patch("crate.api.browse.curated_playlists", return_value=[]),
            patch("crate.api.browse.api_browse_moods", return_value=[]),
            patch("crate.api.browse.get_cache", return_value=None),
            patch("crate.api.browse.set_cache"),
        ):
            response = test_app.get("/api/browse/explore-page")

        assert response.status_code == 200
        assert response.json()["filters"]["genres"] == [
            {
                "name": "Local Genre",
                "slug": None,
                "cnt": None,
                "count": 4,
                "description": None,
                "top_artists": [],
                "cover_url": None,
            }
        ]


class TestExploreSearchContract:
    def test_search_short_query_still_returns_tracks_key(self, test_app):
        resp = test_app.get("/api/search?q=a")
        assert resp.status_code == 200
        assert resp.json() == {"artists": [], "albums": [], "tracks": []}

    def test_search_returns_full_payload_shape(self, test_app):
        mock_scope = _make_mock_session(
            [
                [
                    {
                        "id": 1,
                        "slug": "converge",
                        "name": "Converge",
                        "album_count": 10,
                        "has_photo": 1,
                    }
                ],
                [
                    {
                        "id": 5,
                        "slug": "jane-doe",
                        "artist": "Converge",
                        "name": "Jane Doe",
                        "year": "2001",
                        "has_cover": 1,
                        "artist_id": 1,
                        "artist_slug": "converge",
                    }
                ],
                [
                    {
                        "id": 99,
                        "storage_id": None,
                        "slug": "concubine",
                        "title": "Concubine",
                        "artist": "Converge",
                        "album_id": 5,
                        "album_slug": "jane-doe",
                        "album": "Jane Doe",
                        "artist_id": 1,
                        "artist_slug": "converge",
                        "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                        "duration": 94.0,
                    }
                ],
            ]
        )

        with (
            patch("crate.local_search.has_library_data", return_value=True),
            patch("crate.local_search.get_cache", return_value=None),
            patch("crate.local_search.set_cache"),
            patch("crate.local_search.record_later"),
            patch("crate.db.queries.browse_media_search.read_scope", mock_scope),
        ):
            resp = test_app.get("/api/search?q=converge&limit=10")
            assert resp.status_code == 200
            data = resp.json()
            assert data["artists"][0]["name"] == "Converge"
            assert data["artists"][0]["album_count"] == 10
            assert data["artists"][0]["has_photo"] is True
            assert data["albums"][0]["name"] == "Jane Doe"
            assert data["albums"][0]["artist"] == "Converge"
            assert data["tracks"][0]["title"] == "Concubine"
