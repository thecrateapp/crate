from __future__ import annotations

from unittest.mock import patch

from crate.api import auth as auth_routes


def test_credential_creation_returns_api_key_once(monkeypatch):
    monkeypatch.setattr(auth_routes, "_require_auth", lambda _request: {"id": 12})
    with patch(
        "crate.subsonic.auth.create_user_credential", return_value="one-time-key"
    ) as create_credential:
        response = auth_routes.generate_subsonic_token(object())

    create_credential.assert_called_once_with(12)
    assert response == {"api_key": "one-time-key"}


def test_credential_read_returns_status_without_secret(monkeypatch):
    monkeypatch.setattr(auth_routes, "_require_auth", lambda _request: {"id": 12})
    monkeypatch.setattr(
        auth_routes,
        "get_user_by_id",
        lambda _user_id: (_ for _ in ()).throw(AssertionError("secret read")),
    )
    with patch("crate.subsonic.auth.has_user_credential", return_value=True):
        response = auth_routes.get_subsonic_token(object())

    assert response == {"configured": True}
    assert "secret" not in str(response)


def test_credential_delete_revokes_encrypted_credential(monkeypatch):
    monkeypatch.setattr(auth_routes, "_require_auth", lambda _request: {"id": 12})
    with patch("crate.subsonic.auth.revoke_user_credential") as revoke_credential:
        response = auth_routes.delete_subsonic_token(object())

    revoke_credential.assert_called_once_with(12)
    assert response == {"ok": True}
