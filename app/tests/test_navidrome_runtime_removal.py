from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_FILES = (
    ROOT / "app/crate/db/queries/user_library_shared.py",
    ROOT / "app/crate/db/queries/user_library_history.py",
    ROOT / "app/crate/db/repositories/user_library_shared.py",
    ROOT / "app/readplane/internal/catalog/store.go",
)
PUBLIC_SITE_SOURCES = ROOT / "app/web/src"
MIGRATION = (
    ROOT / "app/crate/db/migrations/versions/081_remove_navidrome_compatibility.py"
)


def test_runtime_no_longer_contains_navidrome_compatibility():
    for path in RUNTIME_FILES:
        assert "navidrome" not in path.read_text().lower(), path


# The engineering blog tells how Crate replaced Navidrome, so its history may name it.
BLOG_HISTORY = (
    PUBLIC_SITE_SOURCES / "content/blog",
    PUBLIC_SITE_SOURCES / "data/blog-calendar.ts",
    PUBLIC_SITE_SOURCES / "data/engineering-timeline.ts",
)


def test_public_site_does_not_advertise_navidrome_compatibility():
    assert all(path.exists() for path in BLOG_HISTORY)
    for path in PUBLIC_SITE_SOURCES.rglob("*"):
        if not path.is_file():
            continue
        if any(path == history or history in path.parents for history in BLOG_HISTORY):
            continue
        assert "navidrome" not in path.read_text().lower(), path


def test_migration_removes_deprecated_navidrome_column_conditionally():
    migration = MIGRATION.read_text()

    assert 'revision = "081"' in migration
    assert 'down_revision = "080"' in migration
    assert "column_name = 'navidrome_id'" in migration
    assert 'op.drop_column("library_tracks", "navidrome_id")' in migration
    assert "op.add_column(" in migration
    assert '"library_tracks",' in migration
