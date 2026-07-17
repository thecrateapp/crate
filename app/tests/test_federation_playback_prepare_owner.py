from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

from fastapi import HTTPException


PEER_UID = uuid.UUID("11111111-1111-4111-8111-111111111111")
TRACK_UID = uuid.UUID("22222222-2222-4222-8222-222222222222")


def _body():
    from crate.api.schemas.federation import FederatedPlaybackPrepareBody

    return FederatedPlaybackPrepareBody(
        requesting_node_uid=PEER_UID,
        delivery_policy="balanced",
        remote_entity_uids=[TRACK_UID],
    )


def _patch_authorized_owner(monkeypatch):
    from crate.api import federation as federation_api

    async def signed_peer(_request):
        return {"node_uid": str(PEER_UID)}

    monkeypatch.setattr(federation_api, "_require_signed_node_request", signed_peer)
    monkeypatch.setattr(
        federation_api,
        "_require_user_assertion",
        lambda *_args, **_kwargs: {"sub": "subject", "roles": ["user"]},
    )
    monkeypatch.setattr(
        federation_api,
        "_require_capability",
        lambda *_args, **_kwargs: SimpleNamespace(constraints=None),
    )
    monkeypatch.setattr(federation_api, "entity_is_allowed", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        federation_api,
        "get_track_delivery_row_by_entity_uid",
        lambda _uid: {"id": 7, "entity_uid": str(TRACK_UID)},
        raising=False,
    )
    monkeypatch.setattr(federation_api, "_request_redis", lambda _request: object())
    monkeypatch.setattr(
        federation_api, "record_playback_prepare_request", lambda _policy: None
    )
    monkeypatch.setattr(
        federation_api,
        "record_playback_prepare_result",
        lambda _status, _policy: None,
    )
    return federation_api


def test_owner_queues_authorized_preparation_without_creating_stream_state(monkeypatch):
    from crate.federation.playback_prepare import PrepareReservation

    federation_api = _patch_authorized_owner(monkeypatch)
    prepared: list[tuple[dict, str, str]] = []
    ticket_calls: list[object] = []

    monkeypatch.setattr(
        federation_api,
        "inspect_playback_preparation",
        lambda _track, _policy: SimpleNamespace(cache_key="variant-a", ready=False),
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "acquire_prepare_reservation",
        lambda *_args: PrepareReservation.ACCEPTED,
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "prepare_playback",
        lambda track, policy, *, reason: prepared.append((track, policy, reason))
        or SimpleNamespace(cache_hit=False, preparing=True),
        raising=False,
    )
    monkeypatch.setattr(
        "crate.federation.stream_proxy.create_ticket",
        lambda **_kwargs: ticket_calls.append(_kwargs),
    )

    result = asyncio.run(federation_api.prepare_playback_variants(_body(), object()))

    assert result.items[0].remote_entity_uid == TRACK_UID
    assert result.items[0].status == "preparing"
    assert prepared == [
        ({"id": 7, "entity_uid": str(TRACK_UID)}, "balanced", "lookahead")
    ]
    assert ticket_calls == []


def test_owner_returns_ready_without_reserving_or_queueing(monkeypatch):
    federation_api = _patch_authorized_owner(monkeypatch)

    monkeypatch.setattr(
        federation_api,
        "inspect_playback_preparation",
        lambda _track, _policy: SimpleNamespace(cache_key="variant-a", ready=True),
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "acquire_prepare_reservation",
        lambda *_args: (_ for _ in ()).throw(AssertionError("must not reserve")),
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "prepare_playback",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not queue")),
        raising=False,
    )

    result = asyncio.run(federation_api.prepare_playback_variants(_body(), object()))

    assert result.items[0].status == "ready"


def test_owner_records_only_aggregate_prepare_outcomes(monkeypatch):
    federation_api = _patch_authorized_owner(monkeypatch)
    recorded: list[tuple[str, str]] = []
    monkeypatch.setattr(
        federation_api,
        "inspect_playback_preparation",
        lambda _track, _policy: SimpleNamespace(cache_key="variant-a", ready=True),
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "record_playback_prepare_request",
        lambda policy: recorded.append(("requested", policy)),
    )
    monkeypatch.setattr(
        federation_api,
        "record_playback_prepare_result",
        lambda status, policy: recorded.append((status, policy)),
    )

    asyncio.run(federation_api.prepare_playback_variants(_body(), object()))

    assert recorded == [("requested", "balanced"), ("ready", "balanced")]


def test_owner_returns_unavailable_for_disallowed_entity(monkeypatch):
    federation_api = _patch_authorized_owner(monkeypatch)
    monkeypatch.setattr(federation_api, "entity_is_allowed", lambda *_args, **_kwargs: False)

    result = asyncio.run(federation_api.prepare_playback_variants(_body(), object()))

    assert result.items[0].status == "unavailable"


def test_owner_returns_rate_limited_without_queueing(monkeypatch):
    from crate.federation.playback_prepare import PrepareReservation

    federation_api = _patch_authorized_owner(monkeypatch)
    monkeypatch.setattr(
        federation_api,
        "inspect_playback_preparation",
        lambda _track, _policy: SimpleNamespace(cache_key="variant-a", ready=False),
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "acquire_prepare_reservation",
        lambda *_args: PrepareReservation.PEER_LIMITED,
        raising=False,
    )
    monkeypatch.setattr(
        federation_api,
        "prepare_playback",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not queue")),
        raising=False,
    )

    result = asyncio.run(federation_api.prepare_playback_variants(_body(), object()))

    assert result.items[0].status == "rate_limited"


def test_owner_rejects_a_requesting_node_uid_mismatch(monkeypatch):
    federation_api = _patch_authorized_owner(monkeypatch)
    body = _body().model_copy(update={"requesting_node_uid": uuid.uuid4()})

    try:
        asyncio.run(federation_api.prepare_playback_variants(body, object()))
    except HTTPException as exc:
        assert exc.status_code == 403
        assert exc.detail == "requesting_node_uid mismatch"
    else:
        raise AssertionError("expected requesting node mismatch to be rejected")
