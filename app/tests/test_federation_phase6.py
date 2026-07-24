"""Phase 6 tests — community directory, manifest validation, node import."""

from crate.federation.directory import (
    build_community_manifest,
    _validate_manifest,
    import_nodes_from_manifest,
    MANIFEST_VERSION,
)


class TestCommunityManifest:
    def test_build_manifest_has_required_fields(self):
        nodes = [
            {
                "node_uid": "node-1",
                "name": "Friend Crate",
                "api_base_url": "https://api.test.net",
                "suggested_preset": "discovery",
            }
        ]
        manifest = build_community_manifest(nodes, name="Test Community")
        assert manifest["manifest_version"] == MANIFEST_VERSION
        assert manifest["name"] == "Test Community"
        assert len(manifest["nodes"]) == 1

    def test_validate_rejects_wrong_version(self):
        assert _validate_manifest({"manifest_version": "0"}) is False

    def test_validate_rejects_missing_nodes(self):
        assert _validate_manifest({"manifest_version": MANIFEST_VERSION}) is False

    def test_validate_rejects_node_without_uid(self):
        assert (
            _validate_manifest(
                {
                    "manifest_version": MANIFEST_VERSION,
                    "nodes": [{"api_base_url": "https://test"}],
                }
            )
            is False
        )

    def test_validate_accepts_valid(self):
        assert (
            _validate_manifest(
                {
                    "manifest_version": MANIFEST_VERSION,
                    "nodes": [
                        {"node_uid": "n1", "api_base_url": "https://test", "name": "T"}
                    ],
                }
            )
            is True
        )

    def test_validate_accepts_multiple_nodes(self):
        assert (
            _validate_manifest(
                {
                    "manifest_version": MANIFEST_VERSION,
                    "nodes": [
                        {"node_uid": "n1", "api_base_url": "https://a"},
                        {"node_uid": "n2", "api_base_url": "https://b"},
                    ],
                }
            )
            is True
        )


class TestImportNodes:
    def test_import_returns_discovered_nodes(self):
        data = {
            "manifest_version": MANIFEST_VERSION,
            "name": "Test",
            "nodes": [
                {
                    "node_uid": "n1",
                    "name": "Node 1",
                    "api_base_url": "https://api1.test",
                    "suggested_preset": "catalog",
                },
                {
                    "node_uid": "n2",
                    "name": "Node 2",
                    "api_base_url": "https://api2.test",
                },
            ],
        }
        discovered = import_nodes_from_manifest(data)
        assert len(discovered) == 2
        assert discovered[0]["display_name"] == "Node 1"
        assert discovered[0]["suggested_preset"] == "catalog"
        assert discovered[1]["suggested_preset"] == "discovery"

    def test_dry_run_does_not_change_peers(self):
        data = {
            "manifest_version": MANIFEST_VERSION,
            "nodes": [{"node_uid": "n1", "name": "N", "api_base_url": "https://api"}],
        }
        discovered = import_nodes_from_manifest(data, dry_run=True)
        assert len(discovered) == 1
