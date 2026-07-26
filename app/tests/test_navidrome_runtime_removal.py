from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_FILES = (
    ROOT / "app/crate/db/queries/user_library_shared.py",
    ROOT / "app/crate/db/queries/user_library_history.py",
    ROOT / "app/crate/db/repositories/user_library_shared.py",
    ROOT / "app/readplane/internal/catalog/store.go",
)
MIGRATION = (
    ROOT / "app/crate/db/migrations/versions/081_remove_navidrome_compatibility.py"
)


def test_runtime_no_longer_contains_navidrome_compatibility():
    for path in RUNTIME_FILES:
        assert "navidrome" not in path.read_text().lower(), path


def test_migration_removes_deprecated_navidrome_column_conditionally():
    migration = MIGRATION.read_text()

    assert 'revision = "081"' in migration
    assert 'down_revision = "080"' in migration
    assert "column_name = 'navidrome_id'" in migration
    assert 'op.drop_column("library_tracks", "navidrome_id")' in migration
    assert "op.add_column(" in migration
    assert '"library_tracks",' in migration
