from sqlalchemy import inspect


EXPECTED_ACTIVE_TABLES = {
    "auth_invites",
    "library_albums",
    "library_artists",
    "library_tracks",
    "metric_minute_snapshots",
    "new_releases",
    "playlist_members",
    "playlist_tracks",
    "playlists",
    "sessions",
    "user_external_identities",
    "user_followed_playlists",
    "users",
}


class _UniqueInspectorStub:
    def get_unique_constraints(self, table_name):
        del table_name
        return [{"column_names": ["email"]}]

    def get_indexes(self, table_name):
        del table_name
        return [
            {"unique": True, "column_names": ["slug"]},
            {"unique": True, "column_names": ["slug", None]},
        ]

    def get_pk_constraint(self, table_name):
        del table_name
        return {"constrained_columns": ["id"]}


def test_database_unique_sets_ignore_expression_indexes() -> None:
    from crate.db.orm.contract import _database_unique_sets

    assert _database_unique_sets(_UniqueInspectorStub(), "users") == {
        frozenset({"email"}),
        frozenset({"slug"}),
        frozenset({"id"}),
    }


def test_active_orm_mappings_match_postgres_head(pg_db):
    del pg_db
    from crate.db.engine import get_engine
    from crate.db.orm.contract import ACTIVE_ORM_MODELS, find_active_orm_schema_drift

    assert {
        model.__table__.name for model in ACTIVE_ORM_MODELS
    } == EXPECTED_ACTIVE_TABLES
    assert find_active_orm_schema_drift(inspect(get_engine())) == []


def test_metric_minute_table_has_unique_series_and_minute_identity(pg_db):
    del pg_db
    from crate.db.engine import get_engine
    from crate.db.orm.contract import _database_unique_sets

    inspector = inspect(get_engine())
    assert inspector.has_table("metric_minute_snapshots")
    assert frozenset({"series_id", "bucket_start"}) in _database_unique_sets(
        inspector, "metric_minute_snapshots"
    )
