from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from uuid import UUID

from crate.db.repositories.library_sync_writes import upsert_scanned_album


def test_upsert_scanned_album_returns_persisted_album_entity_uid():
    session = MagicMock()
    session.execute.return_value.scalar_one.return_value = UUID(
        "22222222-2222-5222-8222-222222222222"
    )

    @contextmanager
    def fake_transaction_scope():
        yield session

    with (
        patch(
            "crate.db.repositories.library_sync_writes.transaction_scope",
            fake_transaction_scope,
        ),
        patch(
            "crate.db.repositories.library_sync_writes.upsert_artist",
            return_value="Artist",
        ),
        patch(
            "crate.db.repositories.library_sync_writes.upsert_album", return_value=42
        ),
        patch("crate.db.repositories.library_sync_writes.upsert_track") as upsert_track,
    ):
        result = upsert_scanned_album(
            artist_payload={"name": "Artist"},
            album_payload={"name": "Album", "path": "/music/Artist/Album"},
            track_payloads=[{"path": "/music/Artist/Album/01.flac"}],
        )

    assert result == (
        "Artist",
        42,
        "22222222-2222-5222-8222-222222222222",
        {"/music/Artist/Album/01.flac"},
    )
    upsert_track.assert_called_once_with(
        {"path": "/music/Artist/Album/01.flac", "album_id": 42}, session=session
    )
