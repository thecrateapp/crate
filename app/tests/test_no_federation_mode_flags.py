from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROHIBITED = {
    "CRATE_FEDERATION_ENABLED",
    "CRATE_GLOBAL_CATALOG_ENABLED",
    "CRATE_GLOBAL_CATALOG_LISTEN_SURFACES",
    "CRATE_GLOBAL_CATALOG_ALLOW_REMOTE_PLAYLIST_REFS",
    "global_catalog_surface_enabled",
    "is_global_catalog_enabled",
    "require_federation_enabled",
}


def test_runtime_has_no_standalone_or_federation_mode_switches():
    files = list((ROOT / "app/crate").rglob("*.py")) + [
        ROOT / "docker-compose.yaml",
        ROOT / "docker-compose.home.yaml",
        ROOT / "docker-compose.dev.yaml",
        ROOT / "docker-compose.federation-dev.yaml",
        ROOT / "Makefile",
    ]

    matches = {
        str(path.relative_to(ROOT)): sorted(
            token for token in PROHIBITED if token in path.read_text()
        )
        for path in files
        if path.exists()
    }
    matches = {path: tokens for path, tokens in matches.items() if tokens}

    assert matches == {}
