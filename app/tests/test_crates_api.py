"""HTTP contract and authorization tests for Listen Crates."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def crate_api_client(test_app, monkeypatch):
    from crate.api.auth import AuthMiddleware

    async def resolve_test_user(self, request):
        user_id = request.headers.get("x-test-user")
        if not user_id:
            return None
        return {
            "id": int(user_id),
            "role": "user",
            "username": f"crate-user-{user_id}",
            "name": f"Crate user {user_id}",
        }

    monkeypatch.setattr(AuthMiddleware, "resolve_user", resolve_test_user)
    return test_app


def _headers(user_id: int) -> dict[str, str]:
    return {"x-test-user": str(user_id)}


def _create_user(email: str) -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO users (email, name, password_hash, created_at)
                    VALUES (:email, 'Crate API user', 'test-hash', NOW())
                    RETURNING id
                    """
                ),
                {"email": email},
            ).scalar_one()
        )


def _create_crate(*, owner_id: int = 1, is_collaborative: bool = False) -> str:
    from crate.db.repositories.crates import create_crate

    return create_crate(
        owner_id=owner_id,
        name="API crate",
        is_collaborative=is_collaborative,
    )


def _add_member(crate_id: str, user_id: int, *, invited_by: int = 1) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO crate_members (crate_id, user_id, invited_by)
                VALUES (CAST(:crate_id AS uuid), :user_id, :invited_by)
                """
            ),
            {"crate_id": crate_id, "user_id": user_id, "invited_by": invited_by},
        )


def _seed_album(title: str) -> str:
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
                ) VALUES (:uid, :artist_uid, :title, :title, 'API Test Artist')
                """
            ),
            {"uid": album_uid, "artist_uid": artist_uid, "title": title},
        )
    return album_uid


def test_create_defaults_private_and_requires_authentication(pg_db, crate_api_client):
    response = crate_api_client.post(
        "/api/crates",
        json={"name": "Year-end records"},
        headers=_headers(1),
    )
    assert response.status_code == 201
    crate_id = response.json()["id"]

    detail = crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(1))
    assert detail.status_code == 200
    assert detail.json()["visibility"] == "private"
    assert detail.json()["albums"] == []

    listing = crate_api_client.get("/api/me/crates", headers=_headers(1))
    assert listing.status_code == 200
    assert [crate["id"] for crate in listing.json()] == [crate_id]
    assert crate_api_client.get(f"/api/crates/{crate_id}").status_code == 401
    assert (
        crate_api_client.post(
            "/api/crates", json={"name": "   "}, headers=_headers(1)
        ).status_code
        == 422
    )


def test_private_crates_are_hidden_and_collaborators_cannot_manage_owner_settings(
    pg_db,
    crate_api_client,
):
    collaborator_id = _create_user(f"crate-collaborator-{uuid4()}@example.test")
    stranger_id = _create_user(f"crate-stranger-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    _add_member(crate_id, collaborator_id)
    url = f"/api/crates/{crate_id}"

    assert crate_api_client.get(url, headers=_headers(stranger_id)).status_code == 404
    assert (
        crate_api_client.get(url, headers=_headers(collaborator_id)).status_code == 200
    )

    edited = crate_api_client.put(
        url,
        json={"name": "Collaborator edit"},
        headers=_headers(collaborator_id),
    )
    assert edited.status_code == 200
    assert crate_api_client.get(url, headers=_headers(1)).json()["name"] == (
        "Collaborator edit"
    )

    assert (
        crate_api_client.put(
            url,
            json={"visibility": "public"},
            headers=_headers(collaborator_id),
        ).status_code
        == 403
    )
    assert (
        crate_api_client.get(
            f"{url}/members", headers=_headers(collaborator_id)
        ).status_code
        == 403
    )
    assert (
        crate_api_client.post(
            f"{url}/invites",
            json={},
            headers=_headers(collaborator_id),
        ).status_code
        == 403
    )
    assert (
        crate_api_client.delete(url, headers=_headers(collaborator_id)).status_code
        == 403
    )

    assert (
        crate_api_client.put(
            url,
            json={"visibility": "public"},
            headers=_headers(1),
        ).status_code
        == 200
    )
    public_detail = crate_api_client.get(url, headers=_headers(stranger_id))
    assert public_detail.status_code == 200
    assert public_detail.json()["access"] == "public"


def test_album_endpoints_validate_uniqueness_and_preserve_manual_order(
    pg_db,
    crate_api_client,
):
    from crate.db.repositories.crates import create_crate

    crate_id = create_crate(owner_id=1, name="Album API")
    album_ids = [_seed_album(f"API Album {index}") for index in range(3)]
    url = f"/api/crates/{crate_id}/albums"

    first = crate_api_client.post(
        url,
        json={"global_album_uid": album_ids[0]},
        headers=_headers(1),
    )
    assert first.status_code == 201
    assert (
        crate_api_client.post(
            url,
            json={"global_album_uid": album_ids[0]},
            headers=_headers(1),
        ).status_code
        == 409
    )
    assert (
        crate_api_client.post(
            url,
            json={"global_album_uid": str(uuid4())},
            headers=_headers(1),
        ).status_code
        == 404
    )
    for album_id in album_ids[1:]:
        assert (
            crate_api_client.post(
                url,
                json={"global_album_uid": album_id},
                headers=_headers(1),
            ).status_code
            == 201
        )

    detail_url = f"/api/crates/{crate_id}"
    assert [
        album["global_album_uid"]
        for album in crate_api_client.get(detail_url, headers=_headers(1)).json()[
            "albums"
        ]
    ] == album_ids

    reordered = list(reversed(album_ids))
    assert (
        crate_api_client.put(
            f"{url}/order",
            json={"global_album_uids": reordered},
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert (
        crate_api_client.put(
            f"{url}/order",
            json={"global_album_uids": reordered[:1]},
            headers=_headers(1),
        ).status_code
        == 422
    )
    assert (
        crate_api_client.delete(
            f"{url}/{reordered[0]}",
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert [
        album["global_album_uid"]
        for album in crate_api_client.get(detail_url, headers=_headers(1)).json()[
            "albums"
        ]
    ] == reordered[1:]


def test_invites_are_owner_managed_and_acceptance_does_not_publish_crate(
    pg_db,
    crate_api_client,
):
    invitee_id = _create_user(f"crate-invitee-{uuid4()}@example.test")
    second_invitee_id = _create_user(f"crate-second-invitee-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    crate_url = f"/api/crates/{crate_id}"

    response = crate_api_client.post(
        f"{crate_url}/invites",
        json={"expires_in_hours": 168, "max_uses": 1},
        headers=_headers(1),
    )
    assert response.status_code == 201
    invite = response.json()
    token = invite["token"]
    assert (
        crate_api_client.get(
            f"/api/crates/invites/{token}", headers=_headers(invitee_id)
        ).status_code
        == 200
    )

    accepted = crate_api_client.post(
        f"/api/crates/invites/{token}/accept",
        headers=_headers(invitee_id),
    )
    assert accepted.status_code == 200
    assert accepted.json()["crate_id"] == crate_id
    detail = crate_api_client.get(crate_url, headers=_headers(invitee_id)).json()
    assert detail["visibility"] == "private"
    assert crate_id in {
        crate["id"]
        for crate in crate_api_client.get(
            "/api/me/crates", headers=_headers(invitee_id)
        ).json()
    }
    assert (
        crate_api_client.post(
            f"/api/crates/invites/{token}/accept",
            headers=_headers(second_invitee_id),
        ).status_code
        == 404
    )

    members = crate_api_client.get(f"{crate_url}/members", headers=_headers(1))
    assert members.status_code == 200
    assert [member["user_id"] for member in members.json()] == [invitee_id]
    assert (
        crate_api_client.delete(
            f"{crate_url}/members/{invitee_id}",
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert (
        crate_api_client.get(f"{crate_url}/members", headers=_headers(1)).json() == []
    )


def test_accepting_crate_invite_does_not_return_member_directory(
    pg_db,
    crate_api_client,
):
    existing_member_id = _create_user(f"crate-existing-member-{uuid4()}@example.test")
    invitee_id = _create_user(f"crate-new-member-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)

    invite = crate_api_client.post(
        f"/api/crates/{crate_id}/invites",
        json={"expires_in_hours": 168, "max_uses": 2},
        headers=_headers(1),
    )
    assert invite.status_code == 201
    token = invite.json()["token"]

    existing_member_acceptance = crate_api_client.post(
        f"/api/crates/invites/{token}/accept",
        headers=_headers(existing_member_id),
    )
    assert existing_member_acceptance.status_code == 200

    accepted = crate_api_client.post(
        f"/api/crates/invites/{token}/accept",
        headers=_headers(invitee_id),
    )

    assert accepted.status_code == 200
    assert accepted.json()["crate_id"] == crate_id
    assert "members" not in accepted.json()


def test_expired_and_revoked_invites_cannot_be_accepted(pg_db, crate_api_client):
    from crate.db.tx import transaction_scope

    invitee_id = _create_user(f"crate-expired-invitee-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    crate_url = f"/api/crates/{crate_id}"

    expired = crate_api_client.post(
        f"{crate_url}/invites",
        json={"expires_in_hours": 12, "max_uses": 2},
        headers=_headers(1),
    ).json()["token"]
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE crate_invites
                SET expires_at = NOW() - INTERVAL '1 hour'
                WHERE token = :token
                """
            ),
            {"token": expired},
        )
    assert (
        crate_api_client.post(
            f"/api/crates/invites/{expired}/accept",
            headers=_headers(invitee_id),
        ).status_code
        == 404
    )

    revoked = crate_api_client.post(
        f"{crate_url}/invites",
        json={"max_uses": 2},
        headers=_headers(1),
    ).json()["token"]
    assert (
        crate_api_client.delete(
            f"{crate_url}/invites/{revoked}",
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert (
        crate_api_client.post(
            f"/api/crates/invites/{revoked}/accept",
            headers=_headers(invitee_id),
        ).status_code
        == 404
    )


def test_only_owner_can_delete_crate_and_delete_cascades_contents(
    pg_db,
    crate_api_client,
):
    collaborator_id = _create_user(f"crate-delete-collab-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    _add_member(crate_id, collaborator_id)
    url = f"/api/crates/{crate_id}"

    assert (
        crate_api_client.delete(url, headers=_headers(collaborator_id)).status_code
        == 403
    )
    deleted = crate_api_client.delete(url, headers=_headers(1))
    assert deleted.status_code == 200
    assert crate_api_client.get(url, headers=_headers(1)).status_code == 404
