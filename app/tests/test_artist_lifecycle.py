from contextlib import contextmanager


def test_run_artist_deletion_serializes_cleanup_and_database_change(monkeypatch):
    from crate import artist_lifecycle

    events: list[str] = []

    @contextmanager
    def publication_lock(_root, artist_id):
        assert artist_id == 42
        events.append("lock-enter")
        yield
        events.append("lock-exit")

    monkeypatch.setattr(
        artist_lifecycle,
        "get_library_artist",
        lambda _name: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        artist_lifecycle, "artist_hero_publication_lock", publication_lock
    )
    monkeypatch.setattr(
        artist_lifecycle,
        "delete_artist_hero_storage",
        lambda entity_uid: events.append(f"cleanup:{entity_uid}"),
    )

    result = artist_lifecycle.run_artist_deletion(
        "Artist", lambda: events.append("database-change") or "deleted"
    )

    assert result == "deleted"
    assert events == [
        "lock-enter",
        "cleanup:artist-entity",
        "database-change",
        "lock-exit",
    ]


def test_delete_artist_uses_shared_deletion_lifecycle(monkeypatch):
    from crate import artist_lifecycle

    deleted: list[str] = []
    monkeypatch.setattr(
        artist_lifecycle,
        "run_artist_deletion",
        lambda name, operation: operation(),
    )
    monkeypatch.setattr(
        artist_lifecycle,
        "db_delete_artist",
        lambda name: deleted.append(name),
    )

    artist_lifecycle.delete_artist("Artist")

    assert deleted == ["Artist"]
