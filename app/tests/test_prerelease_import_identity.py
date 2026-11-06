"""An advance single keeps its saved references when imported in the full album."""

from uuid import uuid4

from sqlalchemy import text

from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
from crate.db.tx import read_scope, transaction_scope
from crate.library_sync import LibrarySync
from crate.storage_import import move_album_tree
from tests.test_storage_import import _write_flac


def test_full_album_import_preserves_single_identity_playlist_and_history(
    pg_db, tmp_path
):
    artist = "Comeback Kid"
    library = tmp_path / "library"
    target = library / str(uuid4()) / str(uuid4())
    original_path = target / f"{uuid4()}.flac"
    _write_flac(
        original_path,
        title="Chosen Hell",
        position=1,
        checksum=42,
        date="2026-08-27",
    )
    sync = LibrarySync({"library_path": str(library), "audio_extensions": [".flac"]})
    initial_album = sync.sync_album(target, artist)
    original = pg_db.get_library_track_by_path(str(original_path))
    storage_id = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET storage_id=CAST(:uid AS uuid) WHERE id=:id"
            ),
            {"uid": storage_id, "id": original["id"]},
        )
        history_id = session.execute(
            text("""
                INSERT INTO user_play_events (
                    user_id,track_id,track_entity_uid,track_path,title,artist,album,
                    started_at,ended_at,played_seconds,created_at
                ) VALUES (
                    1,:id,CAST(:uid AS uuid),:path,'Chosen Hell',:artist,'Chosen Hell',
                    NOW()-INTERVAL '158 seconds',NOW(),158,NOW()
                ) RETURNING id
            """),
            {
                "id": original["id"],
                "uid": str(original["entity_uid"]),
                "path": str(original_path),
                "artist": artist,
            },
        ).scalar_one()
    playlist_id = pg_db.create_playlist("Advance single", user_id=1)
    pg_db.add_playlist_tracks(playlist_id, [{"track_id": original["id"]}])

    staged = tmp_path / "staging"
    _write_flac(staged / "01.flac", title="Target On My Back", position=1, checksum=1)
    _write_flac(staged / "02.flac", title="Vindication", position=2, checksum=2)
    _write_flac(staged / "06.flac", title="Chosen Hell", position=6, checksum=42)
    moved = move_album_tree(
        staged,
        target,
        managed_track_names=True,
        artist_name=artist,
        album_name="Chosen Hell",
        library_root=library,
    )

    imported_album = sync.sync_album(target, artist)

    assert moved == 3
    assert imported_album["album_id"] == initial_album["album_id"]
    assert imported_album["track_count"] == 3
    current = pg_db.get_library_track_by_path(str(original_path))
    assert current["id"] == original["id"]
    assert str(current["entity_uid"]) == str(original["entity_uid"])
    assert str(current["storage_id"]) == storage_id
    assert current["slug"] == original["slug"]
    assert current["track_number"] == 6
    playlist = get_playlist_tracks(playlist_id)
    assert len(playlist) == 1
    assert playlist[0]["track_id"] == original["id"]
    with read_scope() as session:
        playlist_reference = session.execute(
            text("""
                SELECT track_id,track_entity_uid::text,track_storage_id::text,track_path
                FROM playlist_tracks WHERE playlist_id=:id
            """),
            {"id": playlist_id},
        ).one()
        history_reference = session.execute(
            text("""
                SELECT track_id,track_entity_uid::text,track_path
                FROM user_play_events WHERE id=:id
            """),
            {"id": history_id},
        ).one()
    assert tuple(playlist_reference) == (
        original["id"],
        str(original["entity_uid"]),
        storage_id,
        str(original_path),
    )
    assert tuple(history_reference) == (
        original["id"],
        str(original["entity_uid"]),
        str(original_path),
    )
