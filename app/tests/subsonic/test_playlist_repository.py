from unittest.mock import patch

from sqlalchemy.dialects import postgresql

from crate.db.repositories.playlists_collection_reads import (
    get_open_subsonic_playlists,
)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.statement = None

    def execute(self, statement):
        self.statement = statement
        return _Result(self.rows)


def test_visible_playlist_query_includes_public_system_owned_and_membership_rows():
    row = object()
    session = _Session([row])
    with (
        patch(
            "crate.db.repositories.playlists_collection_reads.playlist_to_dict",
            return_value={"id": 1},
        ),
        patch(
            "crate.db.repositories.playlists_collection_reads.attach_artwork_tracks",
            side_effect=lambda _session, playlists: playlists,
        ),
    ):
        result = get_open_subsonic_playlists(user_id=23, session=session)

    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert result == [{"id": 1}]
    assert "playlists.scope" in sql
    assert "playlists.visibility" in sql
    assert "playlists.user_id" in sql
    assert "playlist_members" in sql


def test_admin_playlist_query_does_not_restrict_visible_playlists():
    row = object()
    session = _Session([row])
    with (
        patch(
            "crate.db.repositories.playlists_collection_reads.playlist_to_dict",
            return_value={"id": 1},
        ),
        patch(
            "crate.db.repositories.playlists_collection_reads.attach_artwork_tracks",
            side_effect=lambda _session, playlists: playlists,
        ),
    ):
        result = get_open_subsonic_playlists(is_admin=True, session=session)

    sql = str(session.statement.compile(dialect=postgresql.dialect()))
    assert result == [{"id": 1}]
    assert " WHERE " not in sql
    assert "playlist_members" not in sql
