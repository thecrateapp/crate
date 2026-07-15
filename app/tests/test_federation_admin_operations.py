from __future__ import annotations

from types import SimpleNamespace


def _request(*permissions: str):
    return SimpleNamespace(
        state=SimpleNamespace(
            user={
                "id": 1,
                "role": "admin",
                "permissions": list(permissions),
            }
        )
    )


def test_risk_dashboard_is_bounded_and_redacts_metadata(monkeypatch):
    from crate.api import admin_federation

    monkeypatch.setattr(
        admin_federation.risk_repo,
        "get_risk_dashboard",
        lambda **kwargs: {"peer_node_uid": kwargs["peer_node_uid"], "items": []},
    )

    result = admin_federation.get_risk_dashboard(
        _request("federation.nodes.view"),
        node_uid="11111111-1111-4111-8111-111111111111",
        limit=25,
    )

    assert result["peer_node_uid"] == "11111111-1111-4111-8111-111111111111"


def test_operator_can_reverse_temporary_action_and_audit_it(monkeypatch):
    from crate.api import admin_federation

    monkeypatch.setattr(
        admin_federation.risk_repo,
        "reverse_temporary_action",
        lambda action_id: action_id == 7,
    )
    monkeypatch.setattr(admin_federation.repo, "record_audit_event", lambda **_kw: None)

    result = admin_federation.reverse_risk_action(
        7, _request("federation.nodes.manage")
    )

    assert result == {"ok": True}


def test_operator_can_list_and_revoke_active_ticket(monkeypatch):
    from crate.api import admin_federation

    monkeypatch.setattr(
        admin_federation.stream_ticket_repo,
        "list_active_tickets",
        lambda **_kwargs: [{"ticket_uid": "ticket-1", "status": "active"}],
    )
    monkeypatch.setattr(
        admin_federation.stream_ticket_repo,
        "revoke_ticket",
        lambda ticket_uid: ticket_uid == "ticket-1",
    )
    monkeypatch.setattr(admin_federation.repo, "record_audit_event", lambda **_kw: None)

    listed = admin_federation.list_active_stream_tickets(
        _request("federation.nodes.view"), node_uid=None, subject_hash=None
    )
    revoked = admin_federation.revoke_stream_ticket(
        "ticket-1", _request("federation.nodes.manage")
    )

    assert listed == [{"ticket_uid": "ticket-1", "status": "active"}]
    assert revoked == {"ok": True}
