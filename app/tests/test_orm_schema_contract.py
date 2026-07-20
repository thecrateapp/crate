from sqlalchemy import inspect


EXPECTED_ACTIVE_TABLES = {
    "auth_invites",
    "library_albums",
    "library_artists",
    "library_tracks",
    "new_releases",
    "playlist_members",
    "playlist_tracks",
    "playlists",
    "sessions",
    "user_external_identities",
    "user_followed_playlists",
    "users",
}


def test_active_orm_mappings_match_postgres_head(pg_db):
    del pg_db
    from crate.db.engine import get_engine
    from crate.db.orm.contract import ACTIVE_ORM_MODELS, find_active_orm_schema_drift

    assert {
        model.__table__.name for model in ACTIVE_ORM_MODELS
    } == EXPECTED_ACTIVE_TABLES
    assert find_active_orm_schema_drift(inspect(get_engine())) == []
