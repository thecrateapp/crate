"""Repository and query behavior for Listen Crates."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


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

    crate_id = create_crate(owner_id=1, name="Ordered albums")
    album_ids = [_seed_global_album(f"Album {index}") for index in range(3)]
    for album_id in album_ids:
        add_crate_album(crate_id, album_id, added_by=1)

    assert remove_crate_album(crate_id, album_ids[1]) is True
    remaining = [album_ids[0], album_ids[2]]
    assert _album_order(crate_id) == remaining
    crate = get_crate(crate_id)
    assert [album["position"] for album in crate["albums"]] == [0, 1]

    reorder_crate_albums(crate_id, list(reversed(remaining)))
    assert _album_order(crate_id) == list(reversed(remaining))

    with pytest.raises(InvalidCrateAlbumOrderError):
        reorder_crate_albums(crate_id, remaining[:1])
    assert _album_order(crate_id) == list(reversed(remaining))


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
