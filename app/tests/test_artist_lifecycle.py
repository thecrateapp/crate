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
        "database-change",
        "cleanup:artist-entity",
        "lock-exit",
    ]


def test_run_artist_deletion_preserves_storage_when_database_change_fails(monkeypatch):
    from crate import artist_lifecycle

    cleanup_calls: list[str] = []

    @contextmanager
    def publication_lock(_root, _artist_id):
        yield

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
        lambda entity_uid: cleanup_calls.append(entity_uid),
    )

    def fail_database_change():
        raise RuntimeError("database change failed")

    try:
        artist_lifecycle.run_artist_deletion("Artist", fail_database_change)
    except RuntimeError as exc:
        assert str(exc) == "database change failed"
    else:
        raise AssertionError("Expected the database change to fail")

    assert cleanup_calls == []


def test_run_artist_deletion_keeps_database_result_when_cleanup_fails(monkeypatch):
    from crate import artist_lifecycle

    @contextmanager
    def publication_lock(_root, _artist_id):
        yield

    monkeypatch.setattr(
        artist_lifecycle,
        "get_library_artist",
        lambda _name: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        artist_lifecycle, "artist_hero_publication_lock", publication_lock
    )

    def fail_cleanup(_entity_uid):
        raise OSError("storage unavailable")

    monkeypatch.setattr(artist_lifecycle, "delete_artist_hero_storage", fail_cleanup)

    assert (
        artist_lifecycle.run_artist_deletion("Artist", lambda: "deleted") == "deleted"
    )


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
