"""Contract tests for the Genre API endpoints."""

from unittest.mock import patch


async def _unauthenticated(self, request):
    return None


async def _regular_user(self, request):
    return {
        "id": 2,
        "email": "user@test.com",
        "role": "user",
        "username": "testuser",
        "name": "Test User",
    }


class TestGenresListAPI:
    def test_list_genres_returns_genre_list(self, test_app):
        genres = [
            {
                "id": 1,
                "entity_uid": "g-uid-1",
                "name": "Post-Hardcore",
                "slug": "post-hardcore",
                "artist_count": 5,
                "album_count": 10,
            },
        ]
        with patch("crate.api.genres.get_all_genres", return_value=genres):
            resp = test_app.get("/api/genres")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Post-Hardcore"

    def test_list_genres_empty(self, test_app):
        with patch("crate.api.genres.get_all_genres", return_value=[]):
            resp = test_app.get("/api/genres")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_genres_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres")
        assert resp.status_code == 401


class TestUnmappedGenresAPI:
    def test_list_unmapped_genres_returns_list(self, test_app):
        unmapped = [{"id": 1, "name": "rock", "slug": "rock"}]
        with patch("crate.api.genres.get_unmapped_genres", return_value=unmapped):
            resp = test_app.get("/api/genres/unmapped")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_list_unmapped_genres_respects_limit(self, test_app):
        unmapped = [{"id": 1, "name": "rock", "slug": "rock"}]
        with patch("crate.api.genres.get_unmapped_genres") as mock:
            mock.return_value = unmapped
            resp = test_app.get("/api/genres/unmapped?limit=5")
        assert resp.status_code == 200
        mock.assert_called_once_with(limit=5)

    def test_list_unmapped_genres_default_limit(self, test_app):
        with patch("crate.api.genres.get_unmapped_genres") as mock:
            mock.return_value = []
            test_app.get("/api/genres/unmapped")
        mock.assert_called_once_with(limit=24)

    def test_list_unmapped_genres_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/unmapped")
        assert resp.status_code == 401


class TestGenreDetailAPI:
    def test_genre_detail_found(self, test_app):
        detail = {
            "id": 1,
            "name": "Post-Hardcore",
            "slug": "post-hardcore",
            "artists": [],
            "albums": [],
        }
        with patch("crate.api.genres.get_genre_detail", return_value=detail):
            resp = test_app.get("/api/genres/post-hardcore")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Post-Hardcore"

    def test_genre_detail_not_found(self, test_app):
        with patch("crate.api.genres.get_genre_detail", return_value=None):
            resp = test_app.get("/api/genres/nonexistent")
        assert resp.status_code == 404

    def test_genre_detail_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/post-hardcore")
        assert resp.status_code == 401


class TestGenreGraphAPI:
    def test_genre_graph_found(self, test_app):
        graph = {
            "nodes": [],
            "links": [],
            "mapping": {
                "name": "Post-Hardcore",
                "slug": "post-hardcore",
                "artist_count": 0,
                "album_count": 0,
            },
        }
        with patch("crate.api.genres.get_genre_graph", return_value=graph):
            resp = test_app.get("/api/genres/post-hardcore/graph")
        assert resp.status_code == 200
        assert resp.json()["mapping"]["slug"] == "post-hardcore"

    def test_genre_graph_not_found(self, test_app):
        with patch("crate.api.genres.get_genre_graph", return_value=None):
            resp = test_app.get("/api/genres/nonexistent/graph")
        assert resp.status_code == 404

    def test_genre_graph_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/post-hardcore/graph")
        assert resp.status_code == 401


class TestGenreTaxonomyAPI:
    def test_taxonomy_tree_returns_nodes_and_top_level(self, test_app):
        catalog = {
            "post-hardcore": {
                "name": "Post-Hardcore",
                "parents": [],
                "top_level": True,
            },
            "emo": {
                "name": "Emo",
                "parents": ["post-hardcore"],
                "top_level": False,
            },
        }
        genre_list = [
            {
                "canonical_slug": "post-hardcore",
                "artist_count": 5,
                "album_count": 10,
            },
            {
                "canonical_slug": "emo",
                "artist_count": 3,
                "album_count": 6,
            },
        ]
        with (
            patch("crate.genre_taxonomy.get_genre_catalog", return_value=catalog),
            patch("crate.db.genres.get_all_genres", return_value=genre_list),
            patch(
                "crate.genre_taxonomy.resolve_genre_eq_preset",
                return_value=None,
            ),
        ):
            resp = test_app.get("/api/genres/taxonomy/tree")
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "top_level_slugs" in data
        assert len(data["nodes"]) == 2
        assert data["top_level_slugs"] == ["post-hardcore"]

    def test_taxonomy_tree_node_has_children(self, test_app):
        catalog = {
            "post-hardcore": {
                "name": "Post-Hardcore",
                "parents": [],
                "top_level": True,
            },
            "emo": {
                "name": "Emo",
                "parents": ["post-hardcore"],
                "top_level": False,
            },
        }
        with (
            patch("crate.genre_taxonomy.get_genre_catalog", return_value=catalog),
            patch("crate.db.genres.get_all_genres", return_value=[]),
            patch(
                "crate.genre_taxonomy.resolve_genre_eq_preset",
                return_value=None,
            ),
        ):
            resp = test_app.get("/api/genres/taxonomy/tree")
        assert resp.status_code == 200
        data = resp.json()
        ph_node = next(n for n in data["nodes"] if n["slug"] == "post-hardcore")
        assert "emo" in ph_node["children_slugs"]

    def test_taxonomy_tree_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/taxonomy/tree")
        assert resp.status_code == 401


class TestInvalidTaxonomyAPI:
    def test_invalid_taxonomy_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.get("/api/genres/taxonomy/invalid")
        assert resp.status_code == 403

    def test_invalid_taxonomy_unauth_returns_401(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/taxonomy/invalid")
        assert resp.status_code == 401


class TestGenreAdminActionsAPI:
    def test_reindex_genres_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.post("/api/genres/index")
        assert resp.status_code == 403

    def test_infer_taxonomy_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.post("/api/genres/infer")
        assert resp.status_code == 403

    def test_enrich_descriptions_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.post("/api/genres/descriptions/enrich")
        assert resp.status_code == 403

    def test_musicbrainz_sync_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.post("/api/genres/musicbrainz/sync")
        assert resp.status_code == 403

    def test_cleanup_invalid_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.post("/api/genres/taxonomy/cleanup-invalid")
        assert resp.status_code == 403


class TestGenreEQPresetAPI:
    def test_eq_preset_invalid_gains_count(self, test_app):
        with patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1):
            resp = test_app.patch(
                "/api/genres/post-hardcore/eq-preset",
                json={"gains": [1.0, 2.0]},
            )
        assert resp.status_code == 400

    def test_eq_preset_genre_not_found(self, test_app):
        with patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=None):
            resp = test_app.patch(
                "/api/genres/nonexistent/eq-preset",
                json={"gains": [0.0] * 10},
            )
        assert resp.status_code == 404

    def test_eq_preset_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.patch(
                "/api/genres/post-hardcore/eq-preset",
                json={"gains": [0.0] * 10},
            )
        assert resp.status_code == 403

    def test_eq_preset_clear_gains(self, test_app):
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch("crate.api.genres.set_genre_eq_gains"),
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache"),
            patch(
                "crate.api.genres.resolve_genre_eq_preset",
                return_value={"gains": None},
            ),
        ):
            resp = test_app.patch(
                "/api/genres/post-hardcore/eq-preset",
                json={"gains": None},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["slug"] == "post-hardcore"
        assert data["eq_gains"] is None

    def test_eq_preset_set_valid_gains(self, test_app):
        gains = [round(float(i - 5), 1) for i in range(10)]
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch("crate.api.genres.set_genre_eq_gains"),
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache"),
            patch(
                "crate.api.genres.resolve_genre_eq_preset",
                return_value={"gains": gains},
            ),
        ):
            resp = test_app.patch(
                "/api/genres/post-hardcore/eq-preset",
                json={"gains": gains},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["eq_gains"] == gains

    def test_eq_preset_empty_slug_returns_400(self, test_app):
        resp = test_app.patch("/api/genres/ /eq-preset", json={"gains": [0.0] * 10})
        assert resp.status_code == 400


class TestGenreGenerateEQAPI:
    def test_generate_eq_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.post("/api/genres/post-hardcore/generate-eq")
        assert resp.status_code == 403

    def test_generate_eq_genre_not_found(self, test_app):
        with patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=None):
            resp = test_app.post("/api/genres/nonexistent/generate-eq")
        assert resp.status_code == 404

    def test_generate_eq_empty_slug_returns_400(self, test_app):
        resp = test_app.post("/api/genres/ /generate-eq")
        assert resp.status_code == 400
