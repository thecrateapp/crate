"""Authorization-aware artwork delivery for OpenSubsonic resources."""

from __future__ import annotations

from fastapi import Response

from crate.api.artwork_delivery import deliver_artwork
from crate.artwork_variants import ArtworkAsset
from crate.db.repositories.playlists_collection_reads import get_playlist
from crate.db.repositories.playlists_membership_reads import can_view_playlist
from crate.playlist_covers import playlist_cover_abspath


def serve_playlist_cover(playlist_id: int, *, user: dict, size: int | None) -> Response:
    playlist = get_playlist(playlist_id)
    if playlist is None:
        return Response(status_code=404)
    if user.get("role") != "admin" and not can_view_playlist(playlist, user.get("id")):
        return Response(status_code=404)

    cover_path = playlist_cover_abspath(playlist.get("cover_path"))
    if cover_path is None or not cover_path.is_file():
        return Response(status_code=404)

    return deliver_artwork(
        ArtworkAsset("playlist-cover", str(playlist_id)),
        requested_size=size,
        local_original=cover_path,
        missing_response=Response(status_code=404),
        cache_visibility="private",
    )


__all__ = ["serve_playlist_cover"]
