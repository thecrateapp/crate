from __future__ import annotations

from datetime import datetime, timedelta, timezone


def test_stream_ticket_is_bound_to_authorization_and_allows_range_retries(pg_db):
    del pg_db
    from crate.db.repositories.federation_stream_tickets import (
        create_ticket,
        list_active_tickets,
        validate_ticket,
    )

    ticket = create_ticket(
        node_uid="11111111-1111-4111-8111-111111111111",
        remote_entity_uid="track-a",
        subject_hash="subject-a",
        audience="22222222-2222-4222-8222-222222222222",
        playback_session="session-a",
        delivery_policy="balanced",
        range_policy="bytes",
        max_bytes=1024,
        grant_uid="33333333-3333-4333-8333-333333333333",
        policy_revision=7,
        assertion_jti="assertion-a",
        local_user_id=7,
    )

    assert ticket["expires_at"] <= datetime.now(timezone.utc) + timedelta(minutes=15)
    assert ticket["constraints_json"]["max_bytes"] == 1024
    assert [
        row["ticket_uid"]
        for row in list_active_tickets(node_uid="11111111-1111-4111-8111-111111111111")
    ] == [ticket["ticket_uid"]]
    assert (
        validate_ticket(
            str(ticket["ticket_uid"]),
            expected_node_uid="11111111-1111-4111-8111-111111111111",
            expected_audience="22222222-2222-4222-8222-222222222222",
            expected_subject="subject-a",
            expected_local_user_id=7,
            playback_session="session-a",
            requested_range="bytes=0-99",
            current_policy_revision=7,
        )
        is not None
    )
    assert (
        validate_ticket(
            str(ticket["ticket_uid"]),
            expected_node_uid="11111111-1111-4111-8111-111111111111",
            expected_audience="22222222-2222-4222-8222-222222222222",
            expected_subject="subject-a",
            expected_local_user_id=7,
            playback_session="session-a",
            requested_range="bytes=100-199",
            current_policy_revision=7,
        )
        is not None
    )


def test_ticket_mismatch_or_policy_downgrade_does_not_authorize(pg_db):
    del pg_db
    from crate.db.repositories.federation_stream_tickets import (
        create_ticket,
        validate_ticket,
    )

    ticket = create_ticket(
        node_uid="11111111-1111-4111-8111-111111111111",
        remote_entity_uid="track-a",
        subject_hash="subject-a",
        audience="22222222-2222-4222-8222-222222222222",
        playback_session="session-a",
        grant_uid="33333333-3333-4333-8333-333333333333",
        policy_revision=7,
        local_user_id=7,
    )

    assert (
        validate_ticket(
            str(ticket["ticket_uid"]),
            expected_local_user_id=8,
        )
        is None
    )

    assert (
        validate_ticket(
            str(ticket["ticket_uid"]),
            expected_audience="wrong-audience",
        )
        is None
    )
    assert (
        validate_ticket(
            str(ticket["ticket_uid"]),
            expected_audience="22222222-2222-4222-8222-222222222222",
            current_policy_revision=8,
        )
        is None
    )
