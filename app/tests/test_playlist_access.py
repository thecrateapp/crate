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
