import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_playlist_and_global_track(pg_db):
    from crate.db.tx import transaction_scope

    playlist_id = pg_db.create_playlist("Global Queue", user_id=1)
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (global_artist_uid, canonical_name, sort_name, normalized_name, has_remote)
                VALUES
                    (:artist_uid, 'Rival Schools', 'Rival Schools', 'rival schools', true)
                """
            ),
            {"artist_uid": artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums
                    (
                        global_album_uid,
                        global_artist_uid,
                        canonical_name,
                        normalized_name,
                        artist_name,
                        has_remote
                    )
                VALUES
                    (:album_uid, :artist_uid, 'Pedals', 'pedals', 'Rival Schools', true)
                """
            ),
            {"album_uid": album_uid, "artist_uid": artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks
                    (
                        global_track_uid,
                        global_album_uid,
                        global_artist_uid,
                        canonical_title,
                        normalized_title,
                        artist_name,
                        album_name,
                        duration_seconds,
                        has_remote
                    )
                VALUES
                    (
                        :track_uid,
                        :album_uid,
                        :artist_uid,
                        'Wring It Out',
                        'wring it out',
                        'Rival Schools',
                        'Pedals',
                        214,
                        true
                    )
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "artist_uid": artist_uid,
            },
        )
    return playlist_id, artist_uid, album_uid, track_uid


def test_add_playlist_tracks_accepts_global_refs_without_a_gate(test_app):
    with (
        patch("crate.api.playlists.get_playlist", return_value={"id": 1, "user_id": 1}),
        patch("crate.api.playlists.can_edit_playlist", return_value=True),
        patch("crate.api.playlists.add_playlist_tracks", return_value=1),
    ):
        response = test_app.post(
            "/api/playlists/1/tracks",
            json={"tracks": [{"global_track_uid": str(uuid.uuid4())}]},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "added": 1}


def test_playlist_repository_persists_global_track_refs(pg_db):
    from crate.db.repositories.playlists_tracks import add_playlist_tracks
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks

    playlist_id, artist_uid, album_uid, track_uid = _seed_playlist_and_global_track(
        pg_db
    )
    added = add_playlist_tracks(
        playlist_id,
        [{"global_track_uid": track_uid, "source": "manual"}],
    )
    tracks = get_playlist_tracks(playlist_id)

    assert added == 1
    assert tracks[0]["global_track_uid"] == track_uid
    assert tracks[0]["global_artist_uid"] == artist_uid
    assert tracks[0]["global_album_uid"] == album_uid
    assert tracks[0]["track_id"] is None
    assert tracks[0]["title"] == "Wring It Out"
    assert tracks[0]["artist"] == "Rival Schools"


def test_replacing_and_duplicating_a_playlist_preserves_global_track_refs(pg_db):
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_duplicate import duplicate_playlist
    from crate.db.repositories.playlists_tracks import replace_playlist_tracks

    playlist_id, _artist_uid, _album_uid, track_uid = _seed_playlist_and_global_track(
        pg_db
    )
    assert (
        replace_playlist_tracks(
            playlist_id,
            [{"global_track_uid": track_uid, "source": "manual"}],
        )
        == 1
    )
    assert get_playlist_tracks(playlist_id)[0]["global_track_uid"] == track_uid

    duplicated = duplicate_playlist(playlist_id)

    assert duplicated is not None
    assert (
        get_playlist_tracks(int(duplicated["id"]))[0]["global_track_uid"] == track_uid
    )
