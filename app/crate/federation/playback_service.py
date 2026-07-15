from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
import uuid

from fastapi.responses import FileResponse, StreamingResponse

from crate.db.repositories import federation as federation_repo
from crate.db.repositories.streaming import (
    get_track_delivery_row_by_entity_uid,
    get_track_delivery_row_by_id,
)
from crate.federation.assertions import build_outbound_user_assertion
from crate.federation.client import (
    DEFAULT_TIMEOUT,
    SignedFederationClient,
    federated_post,
)
from crate.federation.global_playback import resolve_global_track_playback
from crate.federation.stream_proxy import filter_response_headers


class PlaybackServiceError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _remember_source(
    *, user_id: int, global_track_uid: str, origin: str, source_node_uid: str | None
) -> None:
    from crate.db.cache_store import set_cache

    set_cache(
        f"subsonic:playback-source:{user_id}:{global_track_uid}",
        {"content_origin": origin, "source_node_uid": source_node_uid},
        ttl=21600,
    )


def get_remembered_source(user_id: int, global_track_uid: str) -> dict | None:
    from crate.db.cache_store import get_cache

    value = get_cache(
        f"subsonic:playback-source:{user_id}:{global_track_uid}",
        max_age_seconds=21600,
    )
    return dict(value) if isinstance(value, dict) else None


def _local_track(selection: dict) -> dict | None:
    entity_uid = selection.get("local_track_entity_uid")
    if entity_uid:
        track = get_track_delivery_row_by_entity_uid(str(entity_uid))
        if track:
            return track
    local_id = selection.get("local_track_id")
    return get_track_delivery_row_by_id(int(local_id)) if local_id is not None else None


def _local_file_response(selection: dict) -> FileResponse:
    track = _local_track(selection)
    if track is None:
        raise PlaybackServiceError(404, "Track not found")
    from crate.api._deps import library_path

    root = library_path().resolve()
    path = Path(str(track.get("path") or ""))
    if not path.is_absolute():
        path = root / path
    path = path.resolve()
    if not path.is_relative_to(root):
        raise PlaybackServiceError(403, "Track path is outside the library")
    if not path.is_file():
        raise PlaybackServiceError(404, "Track file not found")
    from crate.streaming.service import media_type_for_path

    return FileResponse(
        str(path),
        media_type=media_type_for_path(path),
        headers={"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"},
    )


def stream_global_track(
    global_track_uid: str,
    *,
    user: dict,
    request_headers: dict[str, str],
    delivery_policy: str = "balanced",
):
    selection = resolve_global_track_playback(global_track_uid)
    if selection["kind"] == "local":
        from crate.playback_provenance import resolve_local_content_provenance

        origin, source_node_uid = resolve_local_content_provenance(
            selection.get("local_track_id")
        )
        _remember_source(
            user_id=int(user["id"]),
            global_track_uid=global_track_uid,
            origin=origin,
            source_node_uid=source_node_uid,
        )
        return _local_file_response(selection)

    local_node = federation_repo.get_local_node()
    peer = federation_repo.get_peer(str(selection["node_uid"]))
    if local_node is None or peer is None or peer.get("trust_state") != "approved":
        raise PlaybackServiceError(503, "Remote source is unavailable")
    playback_session = str(uuid.uuid4())
    assertion = build_outbound_user_assertion(
        local_node=local_node,
        peer=peer,
        user=user,
        purpose="stream.ticket",
        capabilities=["federation.stream.play"],
    )
    ticket_response = federated_post(
        base_url=peer["api_base_url"],
        path="/api/federation/v1/stream-tickets",
        node_id=local_node["node_uid"],
        key_id=local_node["active_key_id"],
        private_key_ref=local_node["private_key_ref"],
        json_body={
            "remote_entity_uid": selection["remote_entity_uid"],
            "delivery_policy": delivery_policy,
            "requesting_node_uid": local_node["node_uid"],
            "playback_session": playback_session,
        },
        timeout=DEFAULT_TIMEOUT,
        user_assertion=assertion,
    )
    if ticket_response.status_code >= 400:
        raise PlaybackServiceError(ticket_response.status_code, "Remote ticket denied")
    ticket = ticket_response.json()
    ticket_uid = str(ticket.get("ticket_uid") or "")
    if not ticket_uid:
        raise PlaybackServiceError(502, "Remote ticket response is invalid")

    client = SignedFederationClient(
        base_url=peer["api_base_url"],
        node_id=local_node["node_uid"],
        key_id=local_node["active_key_id"],
        private_key_ref=local_node["private_key_ref"],
        timeout=DEFAULT_TIMEOUT,
    )
    forwarded = {
        name: value
        for name, value in request_headers.items()
        if name.lower() in {"range", "if-range", "accept"}
    }
    forwarded["X-Crate-Playback-Session"] = playback_session
    context = client.stream(
        f"/api/federation/v1/streams/{ticket_uid}", headers=forwarded
    )
    try:
        upstream = context.__enter__()
        if upstream.status_code >= 400:
            status = upstream.status_code
            context.__exit__(None, None, None)
            client.close()
            from crate.federation.abuse import observe_risk_signal

            observe_risk_signal(
                "stream_error",
                peer_node_uid=str(selection["node_uid"]),
                severity="low",
                reason_code="upstream_error",
            )
            raise PlaybackServiceError(status, "Remote stream unavailable")
    except Exception:
        client.close()
        raise

    _remember_source(
        user_id=int(user["id"]),
        global_track_uid=global_track_uid,
        origin="remote",
        source_node_uid=str(selection["node_uid"]),
    )

    def body() -> Iterator[bytes]:
        try:
            for chunk in upstream.iter_bytes(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            context.__exit__(None, None, None)
            client.close()

    response_headers = filter_response_headers(dict(upstream.headers))
    response_headers["cache-control"] = "private, no-store"
    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
        headers=response_headers,
    )


__all__ = [
    "PlaybackServiceError",
    "get_remembered_source",
    "stream_global_track",
]
