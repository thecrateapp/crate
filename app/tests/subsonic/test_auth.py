from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone

import pytest

from crate.subsonic.auth import authenticate
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.params import RequestParameters


SECRET = "subsonic-dedicated-secret"
USER = {
    "id": 17,
    "email": "listener@example.test",
    "username": "listener",
    "status": "active",
    "deleted_at": None,
    "secret_ref": "opensubsonic:opaque-ref",
    "api_key_digest": hashlib.sha256(SECRET.encode()).hexdigest(),
}


@pytest.fixture
def auth_dependencies(monkeypatch):
    from crate.subsonic import auth

    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_identity",
        lambda identity, session=None: dict(USER),
    )
    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_api_key_digest",
        lambda digest, session=None: (
            dict(USER) if hmac.compare_digest(digest, USER["api_key_digest"]) else None
        ),
    )
    monkeypatch.setattr(
        auth,
        "load_secret",
        lambda secret_ref, scope=None, session=None: {"secret": SECRET},
    )
    return auth


def params(**values: str) -> RequestParameters:
    return RequestParameters({key: (value,) for key, value in values.items()})


def test_api_key_authenticates_without_username(auth_dependencies):
    user = authenticate(params(apiKey=SECRET))

    assert user == {
        key: value
        for key, value in USER.items()
        if key not in {"secret_ref", "api_key_digest"}
    }


def test_authenticated_user_does_not_expose_crate_password_hash(
    auth_dependencies, monkeypatch
):
    from crate.subsonic import auth

    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_identity",
        lambda *_args, **_kwargs: {**USER, "password_hash": "private-hash"},
    )

    user = authenticate(params(u="listener", p=SECRET))

    assert "password_hash" not in user


def test_plain_password_authenticates_only_with_dedicated_credential(auth_dependencies):
    user = authenticate(params(u="listener", p=SECRET))

    assert user["id"] == USER["id"]


def test_encoded_password_authenticates_with_dedicated_credential(auth_dependencies):
    encoded = "enc:" + SECRET.encode().hex()

    assert authenticate(params(u="listener", p=encoded))["id"] == USER["id"]


def test_challenge_auth_uses_md5_of_dedicated_credential_and_salt(auth_dependencies):
    salt = "random-client-salt"
    token = hashlib.md5((SECRET + salt).encode(), usedforsecurity=False).hexdigest()

    assert authenticate(params(u="listener", t=token, s=salt))["id"] == USER["id"]


@pytest.mark.parametrize(
    "credentials",
    [
        {"apiKey": SECRET, "u": "listener"},
        {"apiKey": SECRET, "p": SECRET},
        {"apiKey": SECRET, "t": "token"},
        {"apiKey": SECRET, "s": "salt"},
        {"u": "listener", "p": SECRET, "t": "token", "s": "salt"},
    ],
)
def test_conflicting_authentication_mechanisms_return_code_43(
    auth_dependencies, credentials
):
    with pytest.raises(OpenSubsonicError) as error:
        authenticate(params(**credentials))

    assert error.value.code == ErrorCode.CONFLICTING_AUTH_MECHANISMS


def test_invalid_api_key_returns_code_44(auth_dependencies, monkeypatch):
    from crate.subsonic import auth

    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_api_key_digest",
        lambda *_args, **_kwargs: None,
    )

    with pytest.raises(OpenSubsonicError) as error:
        authenticate(params(apiKey="invalid"))

    assert error.value.code == ErrorCode.INVALID_API_KEY


@pytest.mark.parametrize(
    "credentials",
    [
        {"u": "listener", "p": "wrong"},
        {"u": "listener", "t": "wrong", "s": "salt"},
    ],
)
def test_invalid_legacy_credentials_return_code_40(auth_dependencies, credentials):
    with pytest.raises(OpenSubsonicError) as error:
        authenticate(params(**credentials))

    assert error.value.code == ErrorCode.INVALID_CREDENTIALS


@pytest.mark.parametrize("credentials", [{"t": "token"}, {"u": "listener"}])
def test_incomplete_authentication_mechanism_returns_code_42(
    auth_dependencies, credentials
):
    with pytest.raises(OpenSubsonicError) as error:
        authenticate(params(**credentials))

    assert error.value.code == ErrorCode.AUTH_MECHANISM_UNSUPPORTED


@pytest.mark.parametrize(
    "user_changes",
    [
        {"status": "suspended"},
        {"status": "disabled"},
        {"deleted_at": datetime.now(timezone.utc)},
    ],
)
def test_inactive_users_are_rejected_even_with_valid_credentials(
    auth_dependencies, monkeypatch, user_changes
):
    from crate.subsonic import auth

    inactive = {**USER, **user_changes}
    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_identity",
        lambda *_args, **_kwargs: inactive,
    )

    with pytest.raises(OpenSubsonicError) as error:
        authenticate(params(u="listener", p=SECRET))

    assert error.value.code == ErrorCode.NOT_AUTHORIZED


def test_api_key_for_suspended_user_returns_not_authorized(
    auth_dependencies, monkeypatch
):
    from crate.subsonic import auth

    suspended = {**USER, "status": "suspended"}
    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_api_key_digest",
        lambda *_args, **_kwargs: suspended,
    )

    with pytest.raises(OpenSubsonicError) as error:
        authenticate(params(apiKey=SECRET))

    assert error.value.code == ErrorCode.NOT_AUTHORIZED


def test_api_key_and_legacy_fields_conflict_case_insensitively(auth_dependencies):
    with pytest.raises(OpenSubsonicError) as error:
        authenticate(RequestParameters({"APIKEY": (SECRET,), "U": ("listener",)}))

    assert error.value.code == ErrorCode.CONFLICTING_AUTH_MECHANISMS


def test_repeated_credential_parameters_are_rejected_as_ambiguous(auth_dependencies):
    with pytest.raises(OpenSubsonicError) as error:
        authenticate(
            RequestParameters({"u": ("listener", "other-user"), "p": (SECRET,)})
        )

    assert error.value.code == ErrorCode.CONFLICTING_AUTH_MECHANISMS


def test_credential_rotation_revokes_old_secret_and_persists_only_digest(monkeypatch):
    from crate.subsonic import auth

    rotated = []
    monkeypatch.setattr(
        auth,
        "rotate_user_subsonic_credential",
        lambda user_id, secret, session=None: rotated.append(
            (user_id, secret, session)
        ),
    )

    api_key = auth.create_user_credential(17)

    assert len(api_key) >= 40
    assert rotated == [(17, api_key, None)]


def test_credential_read_reports_presence_without_loading_secret(monkeypatch):
    from crate.subsonic import auth

    monkeypatch.setattr(
        auth,
        "get_user_subsonic_credential_by_user_id",
        lambda user_id, session=None: {"secret_ref": "opensubsonic:opaque"},
    )

    assert auth.has_user_credential(17) is True


def test_credential_revoke_removes_lookup_and_revokes_ciphertext(monkeypatch):
    from crate.subsonic import auth

    revoked_users = []
    monkeypatch.setattr(
        auth,
        "revoke_user_subsonic_credential",
        lambda user_id, session=None: revoked_users.append((user_id, session)) or True,
    )

    assert auth.revoke_user_credential(17) is True
    assert revoked_users == [(17, None)]
