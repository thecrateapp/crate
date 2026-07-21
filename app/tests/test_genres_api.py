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
            "track_count": 118,
            "cover_url": "/api/genres/post-hardcore/cover?size=640&format=webp",
            "artists": [],
            "albums": [],
        }
        with (
            patch("crate.api.genres.get_genre_detail", return_value=detail),
            patch("crate.api.genres.get_user_by_id", return_value={}),
        ):
            resp = test_app.get("/api/genres/post-hardcore")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Post-Hardcore"
        assert resp.json()["track_count"] == 118
        assert resp.json()["shows"] == []
        assert (
            resp.json()["cover_url"]
            == "/api/genres/post-hardcore/cover?size=640&format=webp"
        )

    def test_genre_detail_includes_location_filtered_shows(self, test_app):
        detail = {
            "id": 1,
            "name": "Post-Hardcore",
            "slug": "post-hardcore",
            "track_count": 118,
            "artists": [],
            "albums": [],
        }
        show = {
            "id": 9,
            "artist_name": "Converge",
            "artist_id": 12,
            "artist_slug": "converge",
            "date": "2030-07-03",
            "local_time": "20:00",
            "venue": "Circolo Magnolia",
            "city": "Segrate",
            "country": "Italy",
            "country_code": "IT",
            "latitude": 45.48,
            "longitude": 9.27,
            "url": "https://tickets.example",
            "artist_genres": ["hardcore"],
        }
        with (
            patch("crate.api.genres.get_genre_detail", return_value=detail),
            patch(
                "crate.api.genres.get_user_by_id",
                return_value={
                    "latitude": 45.46,
                    "longitude": 9.19,
                    "show_radius_km": 80,
                    "show_location_mode": "fixed",
                },
            ),
            patch(
                "crate.api.genres.get_genre_upcoming_shows",
                return_value=[show],
            ) as get_shows,
        ):
            resp = test_app.get("/api/genres/post-hardcore")

        assert resp.status_code == 200
        assert resp.json()["shows"][0]["artist"] == "Converge"
        assert resp.json()["shows"][0]["title"] == "Circolo Magnolia"
        get_shows.assert_called_once_with(
            "post-hardcore",
            latitude=45.46,
            longitude=9.19,
            radius_km=80,
            limit=5,
        )

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

    def test_taxonomy_tree_exposes_editable_relation_sets(self, test_app):
        catalog = {
            "post-hardcore": {
                "name": "Post-Hardcore",
                "parents": ["rock"],
                "related": ["emo"],
                "influenced_by": ["hardcore-punk"],
                "fusion_of": ["punk-rock", "alternative-rock"],
                "top_level": False,
            },
            "screamo": {
                "name": "Screamo",
                "parents": [],
                "influenced_by": ["post-hardcore"],
                "top_level": False,
            },
            "swancore": {
                "name": "Swancore",
                "parents": [],
                "fusion_of": ["post-hardcore"],
                "top_level": False,
            },
        }
        with (
            patch("crate.genre_taxonomy.get_genre_catalog", return_value=catalog),
            patch("crate.db.genres.get_all_genres", return_value=[]),
            patch("crate.genre_taxonomy.resolve_genre_eq_preset", return_value=None),
        ):
            resp = test_app.get("/api/genres/taxonomy/tree")

        assert resp.status_code == 200
        node = next(n for n in resp.json()["nodes"] if n["slug"] == "post-hardcore")
        assert node["parent_slugs"] == ["rock"]
        assert node["related_slugs"] == ["emo"]
        assert node["influenced_by_slugs"] == ["hardcore-punk"]
        assert node["fusion_of_slugs"] == ["punk-rock", "alternative-rock"]
        assert node["influences_slugs"] == ["screamo"]
        assert node["fusion_genre_slugs"] == ["swancore"]

    def test_taxonomy_tree_requires_auth(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/taxonomy/tree")
        assert resp.status_code == 401

    def test_update_taxonomy_node_saves_curator_metadata(self, test_app):
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch(
                "crate.api.genres.update_genre_taxonomy_node_metadata",
                return_value=True,
            ) as update_metadata,
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache") as invalidate,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed"),
        ):
            resp = test_app.patch(
                "/api/genres/taxonomy/Post-Hardcore",
                json={
                    "description": "Angular guitar music rooted in hardcore.",
                    "top_level": False,
                },
            )

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "slug": "post-hardcore"}
        update_metadata.assert_called_once_with(
            "post-hardcore",
            name=None,
            description="Angular guitar music rooted in hardcore.",
            top_level=False,
        )
        invalidate.assert_called_once_with(broadcast=True)

    def test_upload_taxonomy_cover_stores_cover_path(self, test_app):
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch("crate.api.genres.create_task", return_value="task-1") as create_task,
        ):
            resp = test_app.post(
                "/api/genres/taxonomy/Post-Hardcore/cover",
                files={"file": ("cover.png", b"fake image bytes", "image/png")},
            )

        assert resp.status_code == 200
        assert resp.json() == {
            "ok": True,
            "slug": "post-hardcore",
            "cover_url": "/api/genres/post-hardcore/cover?size=640&format=webp",
            "task_id": "task-1",
        }
        assert create_task.call_args.args[0] == "upload_image"
        assert create_task.call_args.args[1]["type"] == "genre_cover"
        assert create_task.call_args.args[1]["slug"] == "post-hardcore"

    def test_infer_taxonomy_node_proposal_returns_reviewable_diff(self, test_app):
        proposal = {
            "ok": True,
            "slug": "post-hardcore",
            "name": "Post-Hardcore",
            "description": "Angular post-punk pressure filtered through hardcore.",
            "aliases": ["post hardcore"],
            "relations": [
                {
                    "relation_type": "parent",
                    "target_slugs": ["hardcore-punk"],
                    "confidence": 0.88,
                    "reasoning": "The genre emerged from hardcore.",
                }
            ],
            "reasoning": "Local artists and lineage match the node.",
            "current_relations": {"parent": ["rock"]},
        }
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch(
                "crate.api.genres.build_genre_taxonomy_node_proposal",
                return_value=proposal,
            ) as build_proposal,
        ):
            resp = test_app.post("/api/genres/taxonomy/post-hardcore/proposal")

        assert resp.status_code == 200
        data = resp.json()
        assert data["slug"] == "post-hardcore"
        assert data["description"].startswith("Angular")
        assert data["relations"][0]["relation_type"] == "parent"
        build_proposal.assert_called_once_with("post-hardcore")

    def test_infer_taxonomy_node_proposal_allows_raw_unmapped_genres(self, test_app):
        proposal = {
            "ok": True,
            "slug": "instrumental",
            "name": "Instrumental",
            "source_kind": "raw_genre",
            "recommended_action": "alias_existing",
            "recommended_target_slug": "instrumental-rock",
            "description": "Instrumental rock without vocals.",
            "aliases": ["instrumental"],
            "relations": [],
            "reasoning": "Local evidence points to instrumental-rock.",
            "current_relations": {},
            "evidence": {"seed_artists": ["Mogwai"]},
        }
        with patch(
            "crate.api.genres.build_genre_taxonomy_node_proposal",
            return_value=proposal,
        ) as build_proposal:
            resp = test_app.post("/api/genres/taxonomy/instrumental/proposal")

        assert resp.status_code == 200
        data = resp.json()
        assert data["source_kind"] == "raw_genre"
        assert data["recommended_action"] == "alias_existing"
        assert data["recommended_target_slug"] == "instrumental-rock"
        assert data["evidence"]["seed_artists"] == ["Mogwai"]
        build_proposal.assert_called_once_with("instrumental")

    def test_apply_taxonomy_proposal_maps_raw_genre_as_alias(self, test_app):
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=12),
            patch(
                "crate.api.genres.assign_genre_alias_value",
                side_effect=[True, True, False],
            ) as assign_alias,
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache") as invalidate,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed") as broadcast,
        ):
            resp = test_app.post(
                "/api/genres/taxonomy/crank-wave/proposal/apply",
                json={
                    "source_kind": "raw_genre",
                    "recommended_action": "alias_existing",
                    "recommended_target_slug": "post-punk",
                    "name": "crank wave",
                    "description": "Niche tag covered by post-punk.",
                    "aliases": ["crank-wave"],
                    "relations": [],
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "alias_existing"
        assert data["target_slug"] == "post-punk"
        assert data["applied_aliases"] == ["crank-wave", "crank wave"]
        assign_alias.assert_any_call("crank-wave", "post-punk")
        assign_alias.assert_any_call("crank wave", "post-punk")
        invalidate.assert_called_once_with(broadcast=True)
        broadcast.assert_called_once_with("genre:crank-wave", "genre:post-punk")

    def test_apply_taxonomy_proposal_creates_node_and_relations(self, test_app):
        with (
            patch(
                "crate.api.genres.upsert_genre_taxonomy_node",
                return_value={"slug": "crank-wave"},
            ) as upsert_node,
            patch(
                "crate.api.genres.assign_genre_alias_value",
                return_value=True,
            ) as assign_alias,
            patch(
                "crate.api.genres.replace_genre_taxonomy_edges",
                return_value={"updated": True, "added": ["post-punk"], "missing": []},
            ) as replace_edges,
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache") as invalidate,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed") as broadcast,
        ):
            resp = test_app.post(
                "/api/genres/taxonomy/crank-wave/proposal/apply",
                json={
                    "source_kind": "raw_genre",
                    "recommended_action": "create_node",
                    "name": "Crank Wave",
                    "description": "Angular punk pressure with post-punk edges.",
                    "aliases": ["crank wave"],
                    "relations": [
                        {
                            "relation_type": "parent",
                            "target_slugs": ["post-punk"],
                            "confidence": 0.88,
                            "reasoning": "Strong local evidence.",
                        }
                    ],
                },
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["action"] == "create_node"
        assert data["target_slug"] == "crank-wave"
        assert data["relation_results"][0]["added"] == ["post-punk"]
        upsert_node.assert_called_once_with(
            "crank-wave",
            name="Crank Wave",
            description="Angular punk pressure with post-punk edges.",
            is_top_level=False,
        )
        assign_alias.assert_any_call("crank-wave", "crank-wave")
        assign_alias.assert_any_call("crank wave", "crank-wave")
        replace_edges.assert_called_once_with(
            "crank-wave",
            relation_type="parent",
            target_slugs=["post-punk"],
            created_by=1,
            source="ai_proposal",
        )
        invalidate.assert_called_once_with(broadcast=True)
        broadcast.assert_called_once_with("genre:crank-wave", "genre:crank-wave")

    def test_delete_library_genre_removes_raw_assignments(self, test_app):
        with (
            patch(
                "crate.api.genres.delete_library_genre",
                return_value={
                    "slug": "crank-wave",
                    "name": "crank wave",
                    "deleted_library_genres": 1,
                    "deleted_taxonomy_nodes": 0,
                    "removed_artist_assignments": 1,
                    "removed_album_assignments": 3,
                    "removed_raw_genres": ["crank-wave"],
                },
            ) as delete_genre,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed") as broadcast,
        ):
            resp = test_app.delete("/api/genres/crank-wave")

        assert resp.status_code == 200
        data = resp.json()
        assert data["removed_artist_assignments"] == 1
        assert data["removed_album_assignments"] == 3
        delete_genre.assert_called_once_with("crank-wave")
        broadcast.assert_called_once_with("genre:crank-wave")

    def test_delete_taxonomy_genre_removes_node_and_mapped_assignments(self, test_app):
        with (
            patch(
                "crate.api.genres.delete_taxonomy_genre",
                return_value={
                    "slug": "post-punk",
                    "name": "Post-Punk",
                    "deleted_library_genres": 2,
                    "deleted_taxonomy_nodes": 1,
                    "removed_artist_assignments": 8,
                    "removed_album_assignments": 12,
                    "removed_raw_genres": ["crank-wave", "post-punk"],
                },
            ) as delete_taxonomy,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed") as broadcast,
        ):
            resp = test_app.delete("/api/genres/taxonomy/post-punk")

        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted_taxonomy_nodes"] == 1
        assert data["removed_raw_genres"] == ["crank-wave", "post-punk"]
        delete_taxonomy.assert_called_once_with("post-punk")
        broadcast.assert_called_once_with("genre:post-punk")

    def test_delete_library_genre_returns_404_for_missing_genre(self, test_app):
        with patch("crate.api.genres.delete_library_genre", return_value=None):
            resp = test_app.delete("/api/genres/missing")

        assert resp.status_code == 404

    def test_update_taxonomy_relations_replaces_selected_relation(self, test_app):
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch(
                "crate.api.genres.replace_genre_taxonomy_edges",
                return_value={
                    "updated": True,
                    "added": ["emo"],
                    "missing": ["unknown-scene"],
                },
            ) as replace_edges,
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache") as invalidate,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed"),
        ):
            resp = test_app.put(
                "/api/genres/taxonomy/post-hardcore/relations",
                json={
                    "relation_type": "related",
                    "target_slugs": ["emo", "unknown-scene"],
                },
            )

        assert resp.status_code == 200
        assert resp.json() == {
            "ok": True,
            "slug": "post-hardcore",
            "relation_type": "related",
            "added": ["emo"],
            "missing": ["unknown-scene"],
        }
        replace_edges.assert_called_once_with(
            "post-hardcore",
            relation_type="related",
            target_slugs=["emo", "unknown-scene"],
            created_by=1,
            source="manual",
        )
        invalidate.assert_called_once_with(broadcast=True)

    def test_update_taxonomy_relations_rejects_unknown_relation_type(self, test_app):
        with patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1):
            resp = test_app.put(
                "/api/genres/taxonomy/post-hardcore/relations",
                json={"relation_type": "primary_color", "target_slugs": ["emo"]},
            )

        assert resp.status_code == 400

    def test_update_taxonomy_aliases_applies_aliases_for_curator(self, test_app):
        with (
            patch("crate.api.genres.get_genre_taxonomy_node_id", return_value=1),
            patch(
                "crate.api.genres.assign_genre_alias_value",
                side_effect=[True, False],
            ) as assign_alias,
            patch("crate.api.genres.invalidate_runtime_taxonomy_cache") as invalidate,
            patch("crate.api.genres._broadcast_genre_taxonomy_changed"),
        ):
            resp = test_app.put(
                "/api/genres/taxonomy/post-hardcore/aliases",
                json={"alias_names": ["post hardcore", ""]},
            )

        assert resp.status_code == 200
        assert resp.json() == {
            "ok": True,
            "slug": "post-hardcore",
            "applied": ["post hardcore"],
            "skipped": [],
        }
        assign_alias.assert_called_once_with("post hardcore", "post-hardcore")
        invalidate.assert_called_once_with(broadcast=True)

    def test_rebuild_taxonomy_proposal_queues_review_task(self, test_app):
        with (
            patch("crate.api.genres.list_tasks", return_value=[]),
            patch(
                "crate.api.genres.create_task",
                return_value="rebuild-genre-proposal-task",
            ) as create_task,
        ):
            resp = test_app.post(
                "/api/genres/taxonomy/rebuild-proposal",
                json={
                    "alias_limit": 42,
                    "node_limit": 7,
                    "include_external": False,
                    "aggressive": False,
                },
            )

        assert resp.status_code == 200
        assert resp.json()["task_id"] == "rebuild-genre-proposal-task"
        create_task.assert_called_once_with(
            "rebuild_genre_taxonomy_proposals",
            {
                "alias_limit": 42,
                "node_limit": 7,
                "include_external": False,
                "aggressive": False,
            },
        )


class TestInvalidTaxonomyAPI:
    def test_invalid_taxonomy_admin_required(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.get("/api/genres/taxonomy/invalid")
        assert resp.status_code == 403

    def test_invalid_taxonomy_unauth_returns_401(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
            resp = test_app.get("/api/genres/taxonomy/invalid")
        assert resp.status_code == 401

    def test_sound_intelligence_health_requires_genre_curator(self, test_app):
        with patch("crate.api.auth.AuthMiddleware.resolve_user", _regular_user):
            resp = test_app.get("/api/genres/sound-intelligence/health")
        assert resp.status_code == 403

    def test_sound_intelligence_health_returns_snapshot(self, test_app):
        with patch(
            "crate.api.genres.get_sound_intelligence_health",
            return_value={
                "eq": {
                    "total_tracks": 2,
                    "sources": [
                        {
                            "source": "audio_analysis_preset",
                            "count": 2,
                            "percent": 100.0,
                        }
                    ],
                },
                "taxonomy": {
                    "node_count": 3,
                    "top_level_count": 1,
                    "orphan_count": 0,
                    "missing_description_count": 1,
                    "missing_direct_eq_count": 2,
                    "unmapped_raw_count": 4,
                    "edge_count": 5,
                    "locked_edge_count": 1,
                    "manual_edge_count": 5,
                    "ai_edge_count": 0,
                },
            },
        ):
            resp = test_app.get("/api/genres/sound-intelligence/health")

        assert resp.status_code == 200
        assert resp.json()["eq"]["total_tracks"] == 2
        assert resp.json()["taxonomy"]["unmapped_raw_count"] == 4


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
            patch("crate.api.genres._broadcast_genre_taxonomy_changed"),
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
            patch("crate.api.genres._broadcast_genre_taxonomy_changed"),
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
