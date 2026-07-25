from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT / "app/crate/db/migrations/versions/077_genre_alias_provenance.py"
).read_text()


def test_genre_alias_provenance_migration_is_revision_077() -> None:
    assert 'revision = "077"' in MIGRATION
    assert 'down_revision = "076"' in MIGRATION


def test_genre_alias_provenance_is_bounded_and_reversible() -> None:
    assert "origin IN ('core', 'manual', 'inferred', 'legacy')" in MIGRATION
    assert "confidence >= 0 AND confidence <= 1" in MIGRATION
    assert "DROP COLUMN IF EXISTS confidence" in MIGRATION
    assert "DROP COLUMN IF EXISTS origin" in MIGRATION
