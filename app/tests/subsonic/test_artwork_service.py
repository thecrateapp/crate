from __future__ import annotations

from unittest.mock import Mock, patch

from fastapi import Response

from crate.db.repositories.playlists_collection_reads import get_playlist_cover_path
from crate.subsonic.services import artwork


def test_playlist_cover_delivery_checks_access_and_uses_private_variants(
    monkeypatch, tmp_path
):
    user = {"id": 9, "role": "user"}
    playlist = {"id": 7, "cover_path": "playlist-7.jpg", "scope": "user"}
    cover_path = tmp_path / "playlist-7.jpg"
    cover_path.write_bytes(b"cover")
    image = Response(b"variant", media_type="image/webp")
    monkeypatch.setattr(artwork, "get_playlist", lambda _playlist_id: playlist)
    monkeypatch.setattr(artwork, "can_view_playlist", lambda _playlist, _uid: True)
    monkeypatch.setattr(artwork, "playlist_cover_abspath", lambda _path: cover_path)
    delivery = Mock(return_value=image)
    monkeypatch.setattr(artwork, "deliver_artwork", delivery)

    response = artwork.serve_playlist_cover(7, user=user, size=384)

    assert response is image
    asset = delivery.call_args.args[0]
    assert asset.kind == "playlist-cover"
    assert asset.entity_key == "7"
    assert delivery.call_args.kwargs["requested_size"] == 384
    assert delivery.call_args.kwargs["local_original"] == cover_path
    assert delivery.call_args.kwargs["missing_response"].status_code == 404
    assert delivery.call_args.kwargs["cache_visibility"] == "private"


def test_playlist_cover_delivery_hides_private_playlist_from_other_users(
    monkeypatch,
):
    monkeypatch.setattr(
        artwork,
        "get_playlist",
        lambda _playlist_id: {"id": 7, "cover_path": "private.jpg"},
    )
    monkeypatch.setattr(artwork, "can_view_playlist", lambda *_args: False)
    with patch.object(artwork, "deliver_artwork") as delivery:
        response = artwork.serve_playlist_cover(
            7, user={"id": 9, "role": "user"}, size=None
        )

    assert response.status_code == 404
    delivery.assert_not_called()


def test_playlist_cover_delivery_allows_admin_and_returns_not_found_without_cover(
    monkeypatch,
):
    monkeypatch.setattr(
        artwork,
        "get_playlist",
        lambda _playlist_id: {"id": 7, "cover_path": None},
    )
    can_view = Mock(return_value=False)
    monkeypatch.setattr(artwork, "can_view_playlist", can_view)
    monkeypatch.setattr(artwork, "playlist_cover_abspath", lambda _path: None)

    response = artwork.serve_playlist_cover(
        7, user={"id": 1, "role": "admin"}, size=512
    )

    assert response.status_code == 404
    can_view.assert_not_called()


def test_playlist_cover_path_query_only_reads_the_cover_column():
    class FakeResult:
        def scalar_one_or_none(self):
            return "playlist-7.jpg"

    class FakeSession:
        statement = None

        def execute(self, statement):
            self.statement = statement
            return FakeResult()

    session = FakeSession()

    cover_path = get_playlist_cover_path(7, session=session)

    assert cover_path == "playlist-7.jpg"
    assert "playlists.cover_path" in str(session.statement)
    assert list(session.statement.compile().params.values()) == [7]
