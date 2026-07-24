from __future__ import annotations

import importlib


def test_global_track_likes_migration_backfills_and_tracks_unresolved(monkeypatch):
    migration = importlib.import_module(
        "crate.db.migrations.versions.068_global_track_likes_and_scrobble"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert migration.down_revision == "067a"
    assert "CREATE TABLE IF NOT EXISTS user_global_track_likes" in sql
    assert "PRIMARY KEY (user_id, global_track_uid)" in sql
    assert "user_global_track_like_repairs" in sql
    assert "FROM user_liked_tracks" in sql
    assert "ON CONFLICT" in sql
    assert "remote_scrobbling_enabled" in sql
    assert "content_origin" in sql
    assert "source_node_uid" in sql


def test_global_track_likes_downgrade_preserves_legacy_likes(monkeypatch):
    migration = importlib.import_module(
        "crate.db.migrations.versions.068_global_track_likes_and_scrobble"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()

    sql = "\n".join(statements)
    assert "DROP TABLE user_liked_tracks" not in sql
    assert "DROP TABLE IF EXISTS user_global_track_likes" in sql
