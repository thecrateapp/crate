from unittest.mock import Mock

from crate.db.repositories.library_stats_reads import has_library_catalog_data


def test_has_library_catalog_data_is_false_for_an_empty_catalog():
    session = Mock()
    session.execute.return_value.scalar_one.return_value = False

    assert has_library_catalog_data(session=session) is False


def test_metadata_only_artists_and_albums_count_as_library_data(pg_db):
    pg_db.upsert_artist({"name": "Metadata Only Artist"})
    pg_db.upsert_album(
        {
            "artist": "Metadata Only Artist",
            "name": "Metadata Only Album",
            "path": "/music/Metadata Only Artist/Metadata Only Album",
        }
    )

    assert pg_db.get_library_track_count() == 0
    assert has_library_catalog_data() is True
