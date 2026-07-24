from __future__ import annotations


def test_artist_sync_lock_owns_connection_for_lock_lifetime(monkeypatch):
    from crate.db import advisory_locks

    events: list[tuple] = []

    class FakeCursor:
        def execute(self, statement, params):
            events.append((statement, params))

        def close(self):
            events.append(("cursor_closed",))

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def close(self):
            events.append(("connection_closed",))

    class FakeEngine:
        def raw_connection(self):
            return FakeConnection()

    monkeypatch.setattr(advisory_locks, "get_engine", lambda: FakeEngine())

    with advisory_locks.artist_sync_lock(" High Vis "):
        events.append(("inside",))

    assert events == [
        (
            "SELECT pg_advisory_lock(hashtext(%s))",
            ("library-sync:high vis",),
        ),
        ("cursor_closed",),
        ("inside",),
        (
            "SELECT pg_advisory_unlock(hashtext(%s))",
            ("library-sync:high vis",),
        ),
        ("cursor_closed",),
        ("connection_closed",),
    ]


def test_process_lifecycle_resets_database_runtime(monkeypatch):
    from crate.db import process_lifecycle

    calls: list[str] = []
    monkeypatch.setattr(
        process_lifecycle, "reset_engine", lambda: calls.append("reset")
    )

    process_lifecycle.reset_database_runtime_after_fork()

    assert calls == ["reset"]


def test_resolve_track_reference_read_owns_its_read_scope(pg_db):
    from crate.db.repositories.user_library_shared import resolve_track_reference_read

    artist = "Reference Adapter Artist"
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {
            "artist": artist,
            "name": "Reference Adapter Album",
            "path": "/music/reference-adapter/album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": "Reference Adapter Album",
            "filename": "01.flac",
            "title": "Reference Adapter Track",
            "path": "/music/reference-adapter/album/01.flac",
        }
    )
    from crate.db.queries.browse_media_track_lookup import find_track_id_by_path

    track_id = find_track_id_by_path("/music/reference-adapter/album/01.flac")
    assert track_id is not None

    reference = resolve_track_reference_read(track_id=track_id)

    assert reference is not None
    assert reference["track_id"] == track_id
    assert reference["track_path"] == "/music/reference-adapter/album/01.flac"
