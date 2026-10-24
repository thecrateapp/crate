"""Missing-album comparisons must work with an indexed, metadata-only library."""

from pathlib import Path
from unittest.mock import patch


def test_missing_albums_uses_indexed_inventory_without_audio(pg_db, test_app, tmp_path):
    artist = "Metadata Only Artist"
    entity_uid = "cb79e9ef-c6a0-4452-9857-c30a7f2721c7"
    pg_db.upsert_artist({"name": artist, "entity_uid": entity_uid})
    pg_db.upsert_album(
        {
            "artist": artist,
            "name": "Storage folder",
            "tag_album": "First Record",
            "path": "/music/not-mounted/first",
            "track_count": 8,
            "musicbrainz_albumid": "release-id",
            "musicbrainz_releasegroupid": "owned-group",
        }
    )
    pg_db.upsert_album(
        {
            "artist": artist,
            "name": "Second Record (Deluxe Edition)",
            "path": "/music/not-mounted/second",
            "track_count": 10,
        }
    )
    mb_albums = [
        {"title": "Renamed First Record", "release_group_id": "owned-group"},
        {"title": "Second Record", "release_group_id": "second-group"},
        {"title": "Absent Record", "release_group_id": "missing-group"},
        {"title": "Unrelated Release", "release_group_id": "release-id"},
    ]
    with (
        patch("crate.api.analytics.library_path", return_value=tmp_path),
        patch("crate.missing.get_audio_files") as audio_files,
        patch(
            "crate.missing._find_mb_artist",
            return_value={"id": "artist-mbid", "name": artist},
        ),
        patch("crate.missing._get_discography", return_value=mb_albums),
    ):
        response = test_app.get(f"/api/artists/by-entity/{entity_uid}/missing")

    assert response.status_code == 200
    result = response.json()
    assert result["artist"] == artist
    assert result["local_count"] == 2
    assert result["mb_count"] == 4
    assert result["missing"] == mb_albums[2:]
    owned_album = next(
        album for album in result["local"] if album["name"] == "Storage folder"
    )
    assert owned_album["album_tag"] == "First Record"
    assert owned_album["track_count"] == 8
    audio_files.assert_not_called()
    assert list(Path(tmp_path).iterdir()) == []


def test_artist_album_inventory_resolves_metadata_and_excludes_quarantine(pg_db):
    from sqlalchemy import text

    from crate.db.queries.missing_albums import get_artist_album_inventory
    from crate.db.tx import read_scope, transaction_scope

    artist = "Inventory Artist"
    pg_db.upsert_artist({"name": artist, "folder_name": "managed-artist-folder"})
    pg_db.upsert_artist({"name": "Empty Artist"})
    pg_db.upsert_album(
        {
            "artist": artist,
            "name": "Owned Album",
            "tag_album": "Canonical Album",
            "path": "/missing/owned",
            "track_count": 12,
            "musicbrainz_albumid": "release-only",
            "musicbrainz_releasegroupid": "release-group",
        }
    )
    removed_id = pg_db.upsert_album(
        {"artist": artist, "name": "Removed Album", "path": "/missing/removed"}
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET quarantined_at = NOW() WHERE id = :id"),
            {"id": removed_id},
        )

    assert get_artist_album_inventory("managed-artist-folder") == {
        "artist": artist,
        "local": [
            {
                "name": "Owned Album",
                "album_tag": "Canonical Album",
                "mbid": "release-group",
                "track_count": 12,
            }
        ],
    }
    with read_scope() as session:
        assert get_artist_album_inventory("empty artist", session=session) == {
            "artist": "Empty Artist",
            "local": [],
        }
    assert get_artist_album_inventory("Unknown Artist") is None


def test_missing_albums_filesystem_fallback_preserves_comparison(tmp_path):
    from crate.missing import find_missing_albums

    album_dir = tmp_path / "Owned Album"
    album_dir.mkdir()
    audio_file = album_dir / "01.flac"
    audio_file.touch()
    with (
        patch("crate.missing.get_audio_files", return_value=[audio_file]),
        patch("crate.missing.read_tags", return_value={"album": "Owned Album"}),
        patch(
            "crate.missing._find_mb_artist",
            return_value={"id": "artist-mbid", "name": "Legacy Artist"},
        ),
        patch(
            "crate.missing._get_discography",
            return_value=[{"title": "Owned Album"}, {"title": "Missing Album"}],
        ),
    ):
        result = find_missing_albums(tmp_path, {".flac"}, artist_name="Legacy Artist")

    assert result["artist"] == "Legacy Artist"
    assert result["local_count"] == 1
    assert result["missing"] == [{"title": "Missing Album"}]


def test_missing_albums_empty_inventory_does_not_query_musicbrainz():
    from crate.missing import compare_missing_albums

    with patch("crate.missing._find_mb_artist") as find_artist:
        result = compare_missing_albums("Empty Artist", [])

    assert result == {
        "artist": "Empty Artist",
        "local": [],
        "missing": [],
        "error": "No local albums",
    }
    find_artist.assert_not_called()


def test_missing_albums_unmatched_artist_keeps_local_inventory():
    from crate.missing import compare_missing_albums

    inventory = [
        {"name": "First Album", "album_tag": "", "mbid": None, "track_count": 4}
    ]
    with patch("crate.missing._find_mb_artist", return_value=None):
        result = compare_missing_albums("Unknown Artist", inventory)

    assert result == {
        "artist": "Unknown Artist",
        "local": inventory,
        "missing": [],
        "error": "Artist not found on MB",
    }
