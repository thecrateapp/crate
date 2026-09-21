"""Repository and query behavior for Listen Crates."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_crate_list_summaries_include_album_count_and_first_album(pg_db):
    from crate.db.queries.crates import (
        get_crates_for_user,
        get_public_crates_for_user,
    )
    from crate.db.repositories.crates import add_crate_album, create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Summary albums")
    first_album, second_album = (
        _seed_global_album("First album"),
        _seed_global_album("Second album"),
    )
    add_crate_album(crate_id, first_album)
    add_crate_album(crate_id, second_album)
    assert update_crate(crate_id, visibility="public")

    for crates in (get_crates_for_user(1), get_public_crates_for_user(1)):
        assert len(crates) == 1
        assert crates[0]["album_count"] == 2
        assert crates[0]["first_album"] == {
            "global_album_uid": first_album,
            "position": 0,
            "name": "First album",
            "artist_name": "Crate Test Artist",
            "year": None,
            "has_cover": False,
            "artwork_source_json": {},
        }


def _create_user(email: str) -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO users (email, name, password_hash, created_at)
                    VALUES (:email, 'Crate test user', 'test-hash', NOW())
                    RETURNING id
                    """
                ),
                {"email": email},
            ).scalar_one()
        )


def _seed_global_album(title: str) -> str:
    from crate.db.tx import transaction_scope

    artist_uid = str(uuid4())
    album_uid = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists (
                    global_artist_uid, canonical_name, sort_name, normalized_name
                ) VALUES (:uid, :name, :name, :name)
                """
            ),
            {"uid": artist_uid, "name": f"Artist {artist_uid[:8]}"},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums (
                    global_album_uid, global_artist_uid, canonical_name,
                    normalized_name, artist_name
                ) VALUES (:uid, :artist_uid, :title, :title, 'Crate Test Artist')
                """
            ),
            {"uid": album_uid, "artist_uid": artist_uid, "title": title},
        )
    return album_uid


def _seed_global_track(
    album_uid: str,
    title: str,
    *,
    disc_number: int,
    track_number: int,
    available: bool = True,
) -> str:
    from crate.db.tx import transaction_scope

    track_uid = str(uuid4())
    with transaction_scope() as session:
        artist_uid = session.execute(
            text(
                """
                SELECT global_artist_uid::text
                FROM global_catalog_albums
                WHERE global_album_uid = CAST(:album_uid AS uuid)
                """
            ),
            {"album_uid": album_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks (
                    global_track_uid, global_album_uid, global_artist_uid,
                    canonical_title, normalized_title, artist_name, album_name,
                    disc_number, track_number, duration_seconds,
                    has_local, has_remote
                ) VALUES (
                    CAST(:track_uid AS uuid), CAST(:album_uid AS uuid),
                    CAST(:artist_uid AS uuid), :title, :title, 'Crate Test Artist',
                    'Crate Test Album', :disc_number, :track_number, 180,
                    :has_local, false
                )
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "artist_uid": artist_uid,
                "title": title,
                "disc_number": disc_number,
                "track_number": track_number,
                "has_local": available,
            },
        )
    return track_uid


def _album_order(crate_id: str) -> list[str]:
    from crate.db.tx import read_scope

    with read_scope() as session:
        return list(
            session.execute(
                text(
                    """
                    SELECT global_album_uid::text
                    FROM crate_albums
                    WHERE crate_id = :crate_id
                    ORDER BY position
                    """
                ),
                {"crate_id": crate_id},
            ).scalars()
        )


def test_new_crates_are_private_and_only_listed_for_the_owner(pg_db):
    from crate.db.queries.crates import (
        get_crate,
        get_crate_access,
        get_crates_for_user,
    )
    from crate.db.repositories.crates import create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Year-end records")
    assert update_crate(crate_id, name="Year-end crate", description="Our picks")

    crate = get_crate(crate_id)
    assert crate is not None
    assert crate["name"] == "Year-end crate"
    assert crate["description"] == "Our picks"
    assert crate["visibility"] == "private"
    assert crate["is_collaborative"] is False
    assert [row["id"] for row in get_crates_for_user(1)] == [crate_id]
    assert get_crates_for_user(2) == []
    assert get_crate_access(crate_id, None) == "none"
    assert get_crate_access(crate_id, 1) == "owner"
    assert get_crate_access(crate_id, 2) == "none"


def test_collaborators_can_list_private_crates_but_public_profile_is_owner_only(
    pg_db,
):
    from crate.db.queries.crates import (
        get_crate_access,
        get_crates_for_user,
        get_public_crates_for_user,
    )
    from crate.db.repositories.crates import create_crate, update_crate
    from crate.db.tx import transaction_scope

    owner_id = 1
    collaborator_id = _create_user(f"collaborator-{uuid4()}@example.test")
    crate_id = create_crate(
        owner_id=owner_id,
        name="Private collaboration",
        is_collaborative=True,
    )
    collaborative_public_id = create_crate(
        owner_id=collaborator_id,
        name="Shared but not owned",
        is_collaborative=True,
    )
    assert update_crate(collaborative_public_id, visibility="public")

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO crate_members (crate_id, user_id, invited_by)
                VALUES (:crate_id, :user_id, :invited_by)
                """
            ),
            {
                "crate_id": crate_id,
                "user_id": collaborator_id,
                "invited_by": owner_id,
            },
        )

    assert {row["id"] for row in get_crates_for_user(collaborator_id)} == {
        crate_id,
        collaborative_public_id,
    }
    assert get_crate_access(crate_id, collaborator_id) == "collaborator"
    assert get_public_crates_for_user(owner_id) == []
    assert [row["id"] for row in get_public_crates_for_user(collaborator_id)] == [
        collaborative_public_id
    ]


def test_public_crate_can_be_read_without_a_session(pg_db):
    from crate.db.queries.crates import get_crate_access
    from crate.db.repositories.crates import create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Public records")
    assert update_crate(crate_id, visibility="public")

    assert get_crate_access(crate_id, None) == "public"
    assert get_crate_access(crate_id, 2) == "public"


def test_albums_are_added_once_in_order_and_unknown_catalog_ids_are_rejected(pg_db):
    from crate.db.queries.crates import get_crate
    from crate.db.repositories.crates import (
        CrateAlbumAlreadyExistsError,
        CrateAlbumNotFoundError,
        add_crate_album,
        create_crate,
    )

    crate_id = create_crate(owner_id=1, name="Albums")
    first_album = _seed_global_album("First album")
    second_album = _seed_global_album("Second album")

    first = add_crate_album(crate_id, first_album, added_by=1)
    second = add_crate_album(crate_id, second_album, added_by=1)

    assert [first["position"], second["position"]] == [0, 1]
    assert _album_order(crate_id) == [first_album, second_album]
    crate = get_crate(crate_id)
    assert [album["global_album_uid"] for album in crate["albums"]] == [
        first_album,
        second_album,
    ]
    with pytest.raises(CrateAlbumAlreadyExistsError):
        add_crate_album(crate_id, first_album, added_by=1)
    with pytest.raises(CrateAlbumNotFoundError):
        add_crate_album(crate_id, str(uuid4()), added_by=1)


def test_removing_and_reordering_albums_preserves_a_contiguous_manual_order(pg_db):
    from crate.db.queries.crates import get_crate
    from crate.db.repositories.crates import (
        InvalidCrateAlbumOrderError,
        add_crate_album,
        create_crate,
        remove_crate_album,
        reorder_crate_albums,
    )
    from crate.db.tx import transaction_scope

    crate_id = create_crate(owner_id=1, name="Ordered albums")
    album_ids = [_seed_global_album(f"Album {index}") for index in range(3)]
    for album_id in album_ids:
        add_crate_album(crate_id, album_id, added_by=1)

    with transaction_scope() as session:
        session.execute(
            text(
                """
                CREATE UNIQUE INDEX crate_albums_test_position_unique
                ON crate_albums(crate_id, position)
                """
            )
        )

    assert remove_crate_album(crate_id, album_ids[0]) is True
    remaining = [album_ids[1], album_ids[2]]
    assert _album_order(crate_id) == remaining
    crate = get_crate(crate_id)
    assert [album["position"] for album in crate["albums"]] == [0, 1]

    reorder_crate_albums(crate_id, list(reversed(remaining)))
    assert _album_order(crate_id) == list(reversed(remaining))

    with pytest.raises(InvalidCrateAlbumOrderError):
        reorder_crate_albums(crate_id, remaining[:1])
    assert _album_order(crate_id) == list(reversed(remaining))


def test_accept_crate_invite_locks_crate_before_invitation(pg_db):
    from crate.db.repositories.crates import accept_crate_invite

    crate_id = str(uuid4())
    statements: list[str] = []

    class Result:
        def __init__(self, *, mapping=None, scalar=None):
            self.mapping = mapping
            self.scalar = scalar

        def mappings(self):
            return self

        def first(self):
            return self.mapping

        def scalar_one_or_none(self):
            return self.scalar

    class Session:
        def execute(self, statement, params=None):
            del params
            sql = statement.text
            statements.append(sql)
            if "SELECT crate_id::text" in sql:
                return Result(scalar=crate_id)
            if "FROM crates" in sql and "FOR UPDATE" in sql:
                return Result(
                    mapping={
                        "crate_id": crate_id,
                        "owner_id": 1,
                        "is_collaborative": True,
                    }
                )
            if "FROM crate_invites" in sql and "FOR UPDATE" in sql:
                return Result(
                    mapping={
                        "crate_id": crate_id,
                        "created_by": 1,
                        "expires_at": None,
                        "max_uses": None,
                        "use_count": 0,
                        "owner_id": 1,
                        "is_collaborative": True,
                    }
                )
            if "FROM crate_members" in sql:
                return Result(scalar=None)
            return Result()

    assert accept_crate_invite("invite-token", 2, session=Session()) == {
        "crate_id": crate_id
    }
    lock_statements = [sql for sql in statements if "FOR UPDATE" in sql]
    assert "FROM crates" in lock_statements[0]


def test_disabling_collaboration_revokes_members_and_pending_invites(pg_db):
    from crate.db.queries.crates import get_crate_access, get_crate
    from crate.db.repositories.crates import create_crate, update_crate
    from crate.db.tx import transaction_scope

    collaborator_id = _create_user(f"revoked-{uuid4()}@example.test")
    crate_id = create_crate(
        owner_id=1,
        name="Collaboration",
        is_collaborative=True,
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO crate_members (crate_id, user_id, invited_by)
                VALUES (:crate_id, :user_id, 1)
                """
            ),
            {"crate_id": crate_id, "user_id": collaborator_id},
        )
        session.execute(
            text(
                """
                INSERT INTO crate_invites (token, crate_id, created_by)
                VALUES ('revocable-token', :crate_id, 1)
                """
            ),
            {"crate_id": crate_id},
        )

    assert update_crate(crate_id, is_collaborative=False)

    assert get_crate_access(crate_id, collaborator_id) == "none"
    assert get_crate(crate_id)["is_collaborative"] is False
    with transaction_scope() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM crate_members WHERE crate_id = :crate_id"),
                {"crate_id": crate_id},
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM crate_invites WHERE crate_id = :crate_id"),
                {"crate_id": crate_id},
            ).scalar_one()
            == 0
        )


def test_crate_playback_tracks_follow_crate_and_disc_track_order(pg_db):
    from crate.db.queries.crates import get_crate_playback_tracks
    from crate.db.repositories.crates import add_crate_album, create_crate

    crate_id = create_crate(owner_id=1, name="Ordered playback")
    first_album = _seed_global_album("First album")
    second_album = _seed_global_album("Second album")
    first_disc_two = _seed_global_track(
        first_album, "Disc two", disc_number=2, track_number=1
    )
    first_disc_one_track_two = _seed_global_track(
        first_album, "Disc one track two", disc_number=1, track_number=2
    )
    first_disc_one_track_one = _seed_global_track(
        first_album, "Disc one track one", disc_number=1, track_number=1
    )
    second_album_track = _seed_global_track(
        second_album, "Second album track", disc_number=1, track_number=1
    )
    add_crate_album(crate_id, first_album)
    add_crate_album(crate_id, second_album)

    tracks = get_crate_playback_tracks(crate_id)

    assert [track["global_track_uid"] for track in tracks] == [
        first_disc_one_track_one,
        first_disc_one_track_two,
        first_disc_two,
        second_album_track,
    ]


def test_crate_playback_skips_unavailable_tracks_and_empty_albums(pg_db):
    from crate.db.queries.crates import get_crate_playback_tracks
    from crate.db.repositories.crates import add_crate_album, create_crate

    crate_id = create_crate(owner_id=1, name="Partially available")
    album_with_tracks = _seed_global_album("Partially available album")
    empty_album = _seed_global_album("Empty album")
    available_track = _seed_global_track(
        album_with_tracks, "Available", disc_number=1, track_number=1
    )
    _seed_global_track(
        album_with_tracks,
        "Unavailable",
        disc_number=1,
        track_number=2,
        available=False,
    )
    add_crate_album(crate_id, album_with_tracks)
    add_crate_album(crate_id, empty_album)

    tracks = get_crate_playback_tracks(crate_id)

    assert [track["global_track_uid"] for track in tracks] == [available_track]


def test_crate_playback_is_empty_when_no_tracks_are_available(pg_db):
    from crate.db.queries.crates import get_crate_playback_tracks
    from crate.db.repositories.crates import add_crate_album, create_crate

    crate_id = create_crate(owner_id=1, name="Unavailable")
    album_uid = _seed_global_album("Unavailable album")
    _seed_global_track(
        album_uid,
        "Unavailable track",
        disc_number=1,
        track_number=1,
        available=False,
    )
    add_crate_album(crate_id, album_uid)

    assert get_crate_playback_tracks(crate_id) == []
