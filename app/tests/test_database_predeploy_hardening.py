from pathlib import Path

from sqlalchemy import text


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT / "app/crate/db/migrations/versions/076_database_predeploy_hardening.py"
)

EXPECTED_FK_INDEXES = {
    "idx_user_global_track_likes_global_track_uid",
    "idx_federation_nodes_directory_candidate_id",
    "idx_bandcamp_imports_bandcamp_item_id",
    "idx_bandcamp_imports_connection_id",
    "idx_bandcamp_radar_items_bandcamp_item_id",
    "idx_user_bandcamp_items_bandcamp_item_id",
    "idx_user_bandcamp_items_connection_id",
}


def test_predeploy_hardening_migration_is_revision_076():
    migration = MIGRATION.read_text()

    assert 'revision = "076"' in migration
    assert 'down_revision = "075"' in migration
    for index_name in EXPECTED_FK_INDEXES:
        assert index_name in migration


def test_predeploy_hardening_indexes_exist_at_head(pg_db):
    del pg_db
    from crate.db.tx import read_scope

    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = ANY(:index_names)
                """
            ),
            {"index_names": sorted(EXPECTED_FK_INDEXES)},
        ).scalars()

    assert set(rows) == EXPECTED_FK_INDEXES
