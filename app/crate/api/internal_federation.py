"""Private control-plane endpoints used by the Go federation data plane."""

from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

from crate.db.repositories import federation as federation_repo
from crate.db.repositories import federation_stream_tickets as stream_ticket_repo
from crate.federation.client import build_signed_headers, prepare_outbound_resource


router = APIRouter(prefix="/internal/federation", include_in_schema=False)
AUTHORIZATION_TTL_SECONDS = 15
SERVICE_TOKEN_MIN_BYTES = 32


class StreamAuthorizationRequest(BaseModel):
    ticket_uid: uuid.UUID
    local_user_id: int = Field(gt=0)
    method: Literal["GET"]
    request_path: str = Field(min_length=1, max_length=256)
    audience: Literal["crate-readplane"]
    range_header: str | None = Field(default=None, alias="range", max_length=256)
    if_range: str | None = Field(default=None, max_length=512)
    accept: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def validate_path_binding(self) -> StreamAuthorizationRequest:
        expected = f"/api/federation/remote/streams/{self.ticket_uid}"
        if self.request_path != expected:
            raise ValueError("request_path is not bound to ticket_uid")
        if self.range_header and not self.range_header.lower().startswith("bytes="):
            raise ValueError("range must use the bytes unit")
        return self


class StreamAuthorizationResponse(BaseModel):
    authorization_uid: uuid.UUID
    ticket_uid: uuid.UUID
    remote_node_uid: uuid.UUID
    audience: Literal["crate-readplane"]
    method: Literal["GET"]
    request_path: str
    external_url: str
    connection_url: str
    host_header: str
    sni_hostname: str
    signed_headers: dict[str, str]
    expires_at: datetime


def validate_service_token_configuration() -> str:
    token = os.environ.get("CRATE_READPLANE_SERVICE_TOKEN", "")
    if not token:
        raise RuntimeError("CRATE_READPLANE_SERVICE_TOKEN is required")
    if len(token.encode("utf-8")) < SERVICE_TOKEN_MIN_BYTES:
        raise RuntimeError("CRATE_READPLANE_SERVICE_TOKEN must be at least 32 bytes")
    return token


def _require_service_identity(presented_token: str | None) -> None:
    try:
        configured_token = validate_service_token_configuration()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503, detail="Readplane service identity unavailable"
        ) from exc
    if not presented_token or not secrets.compare_digest(
        presented_token.encode("utf-8"), configured_token.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="Invalid service identity")


@router.post(
    "/streams/authorize",
    response_model=StreamAuthorizationResponse,
)
def authorize_stream(
    body: StreamAuthorizationRequest,
    x_crate_service_token: str | None = Header(
        default=None, alias="X-Crate-Service-Token"
    ),
) -> StreamAuthorizationResponse:
    """Consume one local relay ticket and issue ephemeral peer request material."""
    _require_service_identity(x_crate_service_token)

    ticket_uid = str(body.ticket_uid)
    ticket = stream_ticket_repo.validate_ticket(
        ticket_uid,
        expected_local_user_id=body.local_user_id,
        requested_range=body.range_header,
    )
    if ticket is None:
        raise HTTPException(status_code=410, detail="Stream ticket expired or consumed")

    local_node = federation_repo.get_local_node()
    peer = federation_repo.get_peer(str(ticket["node_uid"]))
    if local_node is None or not local_node.get("active_key_id"):
        raise HTTPException(
            status_code=503, detail="Local node signing identity unavailable"
        )
    if peer is None or peer.get("trust_state") != "approved" or peer.get("disabled_at"):
        raise HTTPException(status_code=403, detail="Federation peer is not trusted")

    remote_ticket_uid = str(ticket["remote_entity_uid"])
    remote_path = f"/api/federation/v1/streams/{remote_ticket_uid}"
    try:
        prepared = prepare_outbound_resource(str(peer["api_base_url"]), remote_path)
        signed_headers = build_signed_headers(
            method="GET",
            url=prepared.external_url,
            node_id=str(local_node["node_uid"]),
            key_id=str(local_node["active_key_id"]),
            private_key_ref=str(local_node["private_key_ref"]),
            body=b"",
            content_type="",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail="Federation destination rejected"
        ) from exc

    forwarded = {
        "Range": body.range_header,
        "If-Range": body.if_range,
        "Accept": body.accept,
    }
    signed_headers.update(
        {name: value for name, value in forwarded.items() if value is not None}
    )
    constraints = ticket.get("constraints_json") or {}
    if isinstance(constraints, dict):
        playback_session = str(constraints.get("playback_session") or "")
        if playback_session:
            signed_headers["X-Crate-Playback-Session"] = playback_session

    return StreamAuthorizationResponse(
        authorization_uid=uuid.uuid4(),
        ticket_uid=body.ticket_uid,
        remote_node_uid=uuid.UUID(str(ticket["node_uid"])),
        audience="crate-readplane",
        method="GET",
        request_path=body.request_path,
        external_url=prepared.external_url,
        connection_url=prepared.connection_url,
        host_header=prepared.host_header,
        sni_hostname=prepared.sni_hostname,
        signed_headers=signed_headers,
        expires_at=datetime.now(timezone.utc)
        + timedelta(seconds=AUTHORIZATION_TTL_SECONDS),
    )


__all__ = [
    "AUTHORIZATION_TTL_SECONDS",
    "StreamAuthorizationRequest",
    "StreamAuthorizationResponse",
    "authorize_stream",
    "router",
    "validate_service_token_configuration",
]
