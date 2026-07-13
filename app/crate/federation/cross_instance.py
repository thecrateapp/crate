"""Cross-instance semantics — guards that prevent remote refs from leaking
into local-only features (playlists, favorites, offline, radio, Smart Play).

These are explicit API denials for non-imported remote refs. Import is the
boundary where a remote track becomes a normal local item.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def is_remote_ref(payload: dict) -> bool:
    return payload.get("origin") == "remote"


def is_imported_remote_ref(payload: dict) -> bool:
    if not is_remote_ref(payload):
        return True
    return bool(payload.get("_imported"))


def deny_remote_for_local_action(
    payload: dict,
    action: str,
) -> None:
    if is_remote_ref(payload) and not is_imported_remote_ref(payload):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=422,
            detail=(
                f"Cannot {action} remote content. "
                "Import the content locally first, or use queue for temporary playback."
            ),
        )


def sanitize_queue_track(track: dict) -> dict:
    safe = dict(track)
    safe.pop("stream_url", None)
    safe.pop("ticket_url", None)
    safe.pop("ticket_uid", None)
    safe.pop("bearer_token", None)
    safe.pop("path", None)
    safe.pop("local_path", None)
    return safe


def build_remote_album_detail(peer: dict, remote_data: dict) -> dict:
    return {
        "origin": "remote",
        "node_uid": peer["node_uid"],
        "node_name": peer["display_name"],
        "name": remote_data.get("name", ""),
        "artist": remote_data.get("artist", ""),
        "year": remote_data.get("year"),
        "has_cover": remote_data.get("has_cover", False),
        "tracks": [
            {
                "origin": "remote",
                "node_uid": peer["node_uid"],
                "node_name": peer["display_name"],
                "remote_entity_uid": t.get("entity_uid", ""),
                "title": t.get("title", ""),
                "artist": t.get("artist", ""),
                "album": remote_data.get("name", ""),
                "album_entity_uid": remote_data.get("entity_uid", ""),
                "duration": t.get("duration"),
                "track_number": t.get("track_number"),
                "disc_number": t.get("disc_number"),
                "availability": {
                    "catalog": True,
                    "stream": _peer_allows(peer, "stream.proxy"),
                    "import": _peer_allows(peer, "import.request"),
                },
            }
            for t in remote_data.get("tracks", [])
        ],
        "availability": {
            "catalog": True,
            "stream": _peer_allows(peer, "stream.proxy"),
            "import": _peer_allows(peer, "import.request"),
        },
    }


def _peer_allows(peer: dict, capability: str) -> bool:
    from crate.federation.grants import preset_allows

    preset = peer.get("default_grant_preset", "discovery")
    return preset_allows(preset, capability)
