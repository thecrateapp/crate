from __future__ import annotations

import asyncio

import pytest
from starlette.responses import Response


@pytest.mark.parametrize(
    ("header", "size", "expected"),
    [
        (None, 1000, 1000),
        ("bytes=0-99", 1000, 100),
        ("bytes=900-", 1000, 100),
        ("bytes=-50", 1000, 50),
        ("bytes=1000-2000", 1000, 0),
    ],
)
def test_requested_byte_count_matches_single_range_semantics(header, size, expected):
    from crate.federation.stream_proxy import requested_byte_count

    assert requested_byte_count(size, header) == expected


def test_quota_wrapper_reconciles_partial_disconnect_and_releases_slot():
    from crate.federation.stream_proxy import FederationQuotaResponse

    calls: list[tuple] = []

    class Inner:
        async def __call__(self, scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send(
                {"type": "http.response.body", "body": b"1234", "more_body": True}
            )
            raise asyncio.CancelledError

    response = FederationQuotaResponse(
        Inner(),
        redis_client=object(),
        node_uid="peer-a",
        subject_hash="subject-a",
        stream_id="stream-a",
        ticket_uid="ticket-a",
        reserved_bytes=10,
        reconcile=lambda *args, **kwargs: calls.append(("reconcile", kwargs)),
        release=lambda *args, **kwargs: calls.append(("release", args)),
        revoked=lambda *args, **kwargs: False,
    )

    async def run():
        sent: list[dict] = []
        with pytest.raises(asyncio.CancelledError):
            await response({}, lambda: None, sent.append)
        return sent

    sent = asyncio.run(run())

    assert sent[1]["body"] == b"1234"
    assert calls[0][0] == "reconcile"
    assert calls[0][1]["actual_bytes"] == 4
    assert calls[1][0] == "release"


def test_quota_wrapper_is_a_framework_response():
    from crate.federation.stream_proxy import FederationQuotaResponse

    response = FederationQuotaResponse(
        Response(b"audio"),
        redis_client=object(),
        node_uid="peer-a",
        subject_hash="subject-a",
        stream_id="stream-a",
        ticket_uid="ticket-a",
        reserved_bytes=5,
        reconcile=lambda *args, **kwargs: None,
        release=lambda *args, **kwargs: None,
        revoked=lambda *args, **kwargs: False,
    )

    assert isinstance(response, Response)


def test_quota_wrapper_cuts_revoked_stream_before_next_chunk():
    from crate.federation.stream_proxy import FederationQuotaResponse

    class Inner:
        async def __call__(self, scope, receive, send):
            del scope, receive
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send(
                {"type": "http.response.body", "body": b"first", "more_body": True}
            )
            await send(
                {"type": "http.response.body", "body": b"second", "more_body": False}
            )

    checks = iter([False, True])
    response = FederationQuotaResponse(
        Inner(),
        redis_client=object(),
        node_uid="peer-a",
        subject_hash=None,
        stream_id="stream-a",
        ticket_uid="ticket-a",
        reserved_bytes=11,
        reconcile=lambda *args, **kwargs: None,
        release=lambda *args, **kwargs: None,
        revoked=lambda *args, **kwargs: next(checks),
    )

    async def run():
        sent: list[dict] = []
        await response({}, lambda: None, sent.append)
        return sent

    sent = asyncio.run(run())

    assert [message.get("body") for message in sent[1:]] == [b"first", b""]


def test_signal_active_stream_revocations_marks_every_matching_ticket(monkeypatch):
    from crate.federation import events

    marked: list[str] = []
    monkeypatch.setattr(
        events,
        "list_active_tickets",
        lambda **filters: [
            {"ticket_uid": "ticket-a"},
            {"ticket_uid": "ticket-b"},
        ],
    )
    monkeypatch.setattr(events, "get_redis", lambda: object())
    monkeypatch.setattr(
        events,
        "revoke_active_stream",
        lambda _redis, ticket_uid: marked.append(ticket_uid),
    )

    signalled = events.signal_active_stream_revocations(
        node_uid="peer-a",
        subject_hash="subject-a",
    )

    assert signalled == 2
    assert marked == ["ticket-a", "ticket-b"]


def test_signal_active_stream_revocations_is_safe_when_redis_is_unavailable(
    monkeypatch,
):
    from crate.federation import events

    monkeypatch.setattr(
        events,
        "list_active_tickets",
        lambda **filters: [{"ticket_uid": "ticket-a"}],
    )
    monkeypatch.setattr(events, "get_redis", lambda: None)

    assert events.signal_active_stream_revocations(node_uid="peer-a") == 0
