from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request


def _request(user: dict | None) -> Request:
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/capabilities",
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 443),
        }
    )
    request.state.user = user
    return request


def _token_user(*scopes: str) -> dict:
    return {
        "id": 42,
        "email": "dj@example.com",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 11,
        "scopes": list(scopes),
    }


def _enable(monkeypatch, *, vdj: bool, automation: bool) -> None:
    monkeypatch.setenv("CRATE_SMART_MIX_ENABLED", "true")
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true" if vdj else "false")
    monkeypatch.setenv(
        "CRATE_VDJ_AUTOMATION_ENABLED", "true" if automation else "false"
    )


@pytest.mark.parametrize(
    ("vdj", "automation", "scopes", "expected"),
    [
        (True, True, ("vdj.automation.execute",), True),
        (True, True, ("vdj.catalog.read",), False),
        (True, False, ("vdj.automation.execute",), False),
        (False, True, ("vdj.automation.execute",), False),
        (True, True, ("vdj.automation",), False),
    ],
)
def test_capabilities_report_effective_automation_for_the_token(
    monkeypatch, vdj, automation, scopes, expected
):
    from crate.api.capabilities import get_capabilities

    _enable(monkeypatch, vdj=vdj, automation=automation)

    capabilities = get_capabilities(_request(_token_user(*scopes)))

    assert capabilities.access_token is not None
    assert capabilities.access_token.scopes == list(scopes)
    assert capabilities.access_token.automation is expected


def test_capabilities_without_a_token_omit_the_token_section(monkeypatch):
    from crate.api.capabilities import get_capabilities

    _enable(monkeypatch, vdj=True, automation=True)

    capabilities = get_capabilities(_request({"id": 1, "email": "a@b.c"}))

    assert capabilities.access_token is None
    assert "access_token" not in capabilities.model_dump()


def test_disabled_vdj_rejects_access_token_work(monkeypatch):
    from crate.api.auth import _require_vdj_scope

    _enable(monkeypatch, vdj=False, automation=False)

    with pytest.raises(HTTPException) as error:
        _require_vdj_scope(
            _request(_token_user("vdj.catalog.read")), "vdj.catalog.read"
        )

    assert error.value.status_code == 403


def test_disabled_vdj_keeps_session_users_working(monkeypatch):
    from crate.api.auth import _require_vdj_scope

    _enable(monkeypatch, vdj=False, automation=False)
    session_user = {"id": 1, "email": "a@b.c", "session_id": "s-1"}

    assert (
        _require_vdj_scope(_request(session_user), "vdj.catalog.read") == session_user
    )


def test_enabled_vdj_still_requires_the_scope(monkeypatch):
    from crate.api.auth import _require_vdj_scope

    _enable(monkeypatch, vdj=True, automation=False)
    user = _token_user("vdj.media.read")

    assert _require_vdj_scope(_request(user), "vdj.media.read") == user
    with pytest.raises(HTTPException):
        _require_vdj_scope(_request(user), "vdj.catalog.read")
