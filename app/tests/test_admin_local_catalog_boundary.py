from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_admin_browse_frontend_uses_local_library_routes_only():
    source = _read("ui/src/pages/Browse.tsx")

    assert "`/api/artists?${params.toString()}`" in source
    assert "/api/catalog" not in source
    assert "scope=auto" not in source
    assert "scope=federated" not in source
    assert "global_catalog" not in source


def test_admin_browse_backend_uses_local_library_queries_only():
    for path in (
        "crate/api/browse_artist.py",
        "crate/db/queries/browse_artist.py",
        "crate/db/queries/browse_artist_listing.py",
        "crate/db/queries/browse_artist_genres.py",
    ):
        source = _read(path)
        assert "global_catalog" not in source
        assert "federation_catalog" not in source
        assert "federated_search" not in source


def test_admin_catalog_mutations_resolve_against_local_library_repositories():
    deps_source = _read("crate/api/_deps.py")
    management_source = _read("crate/api/management.py")

    assert "get_library_artist_by_entity_uid" in deps_source
    assert "get_library_album_by_entity_uid" in deps_source
    assert "get_library_track_by_entity_uid" in management_source
    assert "global_catalog" not in deps_source
    assert "federation_catalog" not in deps_source
    assert "global_catalog" not in management_source
    assert "federation_catalog" not in management_source
