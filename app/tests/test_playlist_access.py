"""Viewer access for user playlists: owner, collaborator, public or none."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

OWNER, COLLAB, OTHER = 1, 2, 3


def _playlist(**overrides):
    return {
        "id": 10,
        "scope": "user",
        "user_id": OWNER,
        "visibility": "public",
        "is_collaborative": True,
        **overrides,
    }


def _member(user_id: int):
    return {"role": "collab"} if user_id == COLLAB else None


@pytest.mark.parametrize(
    ("playlist", "viewer", "expected"),
    [
        (_playlist(), OWNER, "owner"),
        (_playlist(), COLLAB, "collaborator"),
        (_playlist(is_collaborative=False), COLLAB, "public"),
        (_playlist(visibility="private", is_collaborative=False), COLLAB, "public"),
        (_playlist(), OTHER, "public"),
        (_playlist(visibility="private"), OTHER, "none"),
        (_playlist(scope="system", user_id=None), OTHER, "public"),
        (_playlist(visibility="private"), None, "none"),
        (None, OWNER, "none"),
    ],
)
def test_playlist_access_matrix(playlist, viewer, expected):
    from crate.db.repositories import playlists_membership_reads as reads

    with patch.object(
        reads,
        "get_playlist_member",
        side_effect=lambda _pid, uid, session=None: _member(uid),
    ):
        assert reads.get_playlist_access(playlist, viewer) == expected
        assert reads.can_edit_playlist(playlist, viewer) is (
            expected in {"owner", "collaborator"}
        )


def test_only_the_creator_owns_a_playlist():
    from crate.db.repositories.playlists_membership_reads import is_playlist_owner

    assert is_playlist_owner(_playlist(), OWNER) is True
    assert is_playlist_owner(_playlist(), COLLAB) is False
    assert is_playlist_owner(_playlist(scope="system"), OWNER) is False


def _user(session, name: str) -> int:
    return session.execute(
        text(
            "INSERT INTO users (email, username, created_at) "
            "VALUES (:email, :name, now()) RETURNING id"
        ),
        {"email": f"{name}@example.test", "name": name},
    ).scalar_one()


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_public_user_playlists_can_be_followed_by_others_only(pg_db):
    from crate.db.repositories.playlists_collection_reads import (
        get_playlist_follow_state,
    )
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_follows import follow_playlist
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        owner = _user(session, "owner")
        fan = _user(session, "fan")
    public = create_playlist(name="Public", user_id=owner, visibility="public")
    private = create_playlist(name="Private", user_id=owner, visibility="private")

    assert follow_playlist(fan, public) is True
    assert follow_playlist(fan, public) is False
    assert follow_playlist(owner, public) is False
    assert follow_playlist(fan, private) is False
    assert get_playlist_follow_state(public, fan) == {
        "follower_count": 1,
        "is_followed": True,
    }
    assert get_playlist_follow_state(public, owner)["is_followed"] is False


def _act_as(monkeypatch, user_id: int, username: str) -> None:
    async def _resolve(self, request):
        return {"id": user_id, "role": "user", "username": username, "email": "x"}

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", _resolve)


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_owner_adds_collaborators_who_can_edit_and_leave(pg_db, test_app, monkeypatch):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        owner = _user(session, "owner")
        collab = _user(session, "collab")
        other = _user(session, "other")
    playlist_id = create_playlist(name="Shared", user_id=owner, visibility="public")

    _act_as(monkeypatch, owner, "owner")
    added = test_app.post(
        f"/api/playlists/{playlist_id}/members", json={"username": "@collab"}
    )
    assert added.status_code == 200
    assert {m["user_id"] for m in added.json()["members"]} >= {collab}

    _act_as(monkeypatch, collab, "collab")
    seen = test_app.get(f"/api/playlists/{playlist_id}").json()
    assert seen["access"] == "collaborator"
    assert seen["can_edit"] is True
    assert seen["members"]

    _act_as(monkeypatch, other, "other")
    public = test_app.get(f"/api/playlists/{playlist_id}").json()
    assert public["access"] == "public"
    assert public["can_edit"] is False
    assert public["members"] == []
    assert test_app.get(f"/api/playlists/{playlist_id}/members").status_code == 403
    assert (
        test_app.put(
            f"/api/playlists/{playlist_id}", json={"name": "Hijack"}
        ).status_code
        == 403
    )

    _act_as(monkeypatch, collab, "collab")
    assert test_app.post(f"/api/playlists/{playlist_id}/leave").status_code == 200
    assert test_app.get(f"/api/playlists/{playlist_id}").json()["access"] == "public"

    _act_as(monkeypatch, owner, "owner")
    assert test_app.post(f"/api/playlists/{playlist_id}/leave").status_code == 404


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_public_viewers_follow_and_copy_but_invites_are_gone(
    pg_db, test_app, monkeypatch
):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.tx import read_scope, transaction_scope

    with transaction_scope() as session:
        owner = _user(session, "owner")
        fan = _user(session, "fan")
    playlist_id = create_playlist(
        name="Night Drive", user_id=owner, visibility="public"
    )
    private_id = create_playlist(name="Mine", user_id=owner, visibility="private")

    _act_as(monkeypatch, fan, "fan")
    followed = test_app.post(f"/api/playlists/{playlist_id}/follow").json()
    assert followed["is_followed"] is True
    assert followed["follower_count"] == 1
    assert test_app.post(f"/api/playlists/{private_id}/follow").status_code == 403
    assert test_app.get(f"/api/playlists/{playlist_id}").json()["is_followed"] is True
    unfollowed = test_app.delete(f"/api/playlists/{playlist_id}/follow").json()
    assert unfollowed["is_followed"] is False

    copied = test_app.post(f"/api/playlists/{playlist_id}/copy")
    assert copied.status_code == 200
    with read_scope() as session:
        row = session.execute(
            text("SELECT user_id, visibility, name FROM playlists WHERE id = :id"),
            {"id": copied.json()["id"]},
        ).one()
    assert (row.user_id, row.visibility, row.name) == (fan, "private", "Night Drive")
    assert test_app.post(f"/api/playlists/{private_id}/copy").status_code == 403

    _act_as(monkeypatch, owner, "owner")
    assert (
        test_app.post(f"/api/playlists/{playlist_id}/invites", json={}).status_code
        == 410
    )
    assert test_app.post("/api/playlists/invites/abc/accept").status_code == 410
