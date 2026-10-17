"""Authlib authorization-server adapter and official SDK token verifier."""

import secrets
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, ClassVar, cast

import anyio
from authlib.oauth2.rfc6749 import AuthorizationServer, ClientMixin, OAuth2Request
from authlib.oauth2.rfc6749.errors import (
    InvalidGrantError,
    InvalidRequestError,
    InvalidScopeError,
)
from authlib.oauth2.rfc6749.grants import AuthorizationCodeGrant, RefreshTokenGrant
from authlib.oauth2.rfc6749.requests import BasicOAuth2Payload
from authlib.oauth2.rfc6750 import BearerTokenGenerator
from authlib.oauth2.rfc7009 import RevocationEndpoint
from authlib.oauth2.rfc7636 import CodeChallenge
from mcp.server.auth.provider import AccessToken

from crate.agent_access import ALLOWED_GRANTS
from crate.db.repositories import mcp_oauth as store
from crate.db.repositories.agent_credentials import resolve_credential
from crate.mcp.oauth_config import oauth_enabled, oauth_settings


class OAuthRequest(OAuth2Request):
    def __init__(self, method, path, parameters, headers=None):
        super().__init__(method, oauth_settings().issuer + path, headers=headers)
        self.payload: BasicOAuth2Payload = BasicOAuth2Payload(parameters)

    @property
    def form(self):
        return self.payload.data

    @property
    def args(self):
        return self.payload.data


class OAuthClient(ClientMixin):
    def __init__(self, row):
        self.row = row
        self.client_id = row["client_id"]

    def get_client_id(self):
        return self.client_id

    def get_default_redirect_uri(self):
        # Require the client to explicitly repeat the exact callback.
        return None

    def get_allowed_scope(self, scope):
        requested = set(scope.split() if isinstance(scope, str) else scope or ())
        allowed = requested & set(self.row["scopes"])
        if not allowed:
            raise InvalidScopeError()
        return " ".join(sorted(allowed))

    def check_redirect_uri(self, redirect_uri):
        return redirect_uri in self.row["redirect_uris"]

    def check_client_secret(self, client_secret):
        return False

    def check_endpoint_auth_method(self, method, endpoint):
        return method == "none"

    def check_response_type(self, response_type):
        return response_type == "code"

    def check_grant_type(self, grant_type):
        return grant_type in {"authorization_code", "refresh_token"}


class _S256(CodeChallenge):
    SUPPORTED_CODE_CHALLENGE_METHOD: ClassVar[list[str]] = ["S256"]

    def validate_code_challenge(self, grant, redirect_uri):
        data = grant.request.payload.data
        if data.get("code_challenge_method") != "S256" or not data.get(
            "code_challenge"
        ):
            raise InvalidRequestError("PKCE S256 is required")
        super().validate_code_challenge(grant, redirect_uri)


class _Code(SimpleNamespace):
    def get_redirect_uri(self):
        return self.redirect_uri

    def get_scope(self):
        return " ".join(self.scopes)


class _Token(SimpleNamespace):
    def check_client(self, client):
        return self.client_id == client.client_id

    def get_scope(self):
        return " ".join(self.scopes)


class _CodeGrant(AuthorizationCodeGrant):
    TOKEN_ENDPOINT_AUTH_METHODS = ("none",)

    def validate_authorization_request(self):
        redirect = super().validate_authorization_request()
        _validate_resource(self.request)
        return redirect

    def save_authorization_code(self, code, request):
        request = cast(OAuthRequest, request)
        client = cast(OAuthClient, request.client)
        user = cast(dict, request.user)
        authorization_id = store.create_authorization(
            user["id"],
            client.get_client_id(),
            request.scope.split(),
            session=self.server.session,
        )
        store.save_code(
            code,
            authorization_id,
            request.payload.data,
            request.scope.split(),
            session=self.server.session,
        )

    def query_authorization_code(self, code, client):
        _validate_resource(self.request)
        row = store.query_code(
            code, client.get_client_id(), session=self.server.session
        )
        if row is None:
            return None
        _validate_credential_resource(row)
        return _Code(**row)

    def delete_authorization_code(self, authorization_code):
        store.consume_code(authorization_code.code_digest, session=self.server.session)

    def authenticate_user(self, authorization_code):
        return store.credential_user(
            vars(authorization_code), session=self.server.session
        )


class _RefreshGrant(RefreshTokenGrant):
    TOKEN_ENDPOINT_AUTH_METHODS = ("none",)
    INCLUDE_NEW_REFRESH_TOKEN = True

    def authenticate_refresh_token(self, refresh_token):
        _validate_resource(self.request)
        row = store.get_oauth_token(
            refresh_token, refresh=True, lock=True, session=self.server.session
        )
        if (
            row is None
            or self.request.client is None
            or row["client_id"] != self.request.client.get_client_id()
        ):
            return None
        if row["refresh_used_at"] is not None:
            store.revoke_token_family(
                str(row["family_id"]), session=self.server.session
            )
            return None
        if row["revoked_at"] is not None or row["refresh_expires_at"] <= datetime.now(
            UTC
        ):
            return None
        _validate_credential_resource(row)
        return _Token(**row)

    def authenticate_user(self, refresh_token):
        return store.credential_user(vars(refresh_token), session=self.server.session)

    def revoke_old_credential(self, refresh_token):
        store.mark_refresh_used(
            str(vars(refresh_token)["id"]), session=self.server.session
        )


class _Revocation(RevocationEndpoint):
    CLIENT_AUTH_METHODS = ("none",)

    def query_token(self, token_string, token_type_hint):
        row = None
        if token_type_hint != "refresh_token":
            row = store.get_oauth_token(token_string, session=self.server.session)
        if row is None and token_type_hint != "access_token":
            row = store.get_oauth_token(
                token_string, refresh=True, session=self.server.session
            )
        return _Token(**row) if row else None

    def revoke_token(self, token, request):
        store.revoke_oauth_authorization(
            str(token.authorization_id), session=self.server.session
        )


def _validate_resource(request):
    if request.payload.data.get("resource") != oauth_settings().resource:
        raise InvalidRequestError("The exact MCP resource is required")


def _validate_credential_resource(credential):
    settings = oauth_settings()
    if (
        credential["issuer"] != settings.issuer
        or credential["resource"] != settings.resource
    ):
        raise InvalidGrantError("This credential belongs to another issuer or resource")


class _TokenResponse(dict):
    def __repr__(self):
        return "<OAuth token response redacted>"


class _CrateTokenGenerator(BearerTokenGenerator):
    def __init__(self):
        super().__init__(
            access_token_generator=lambda **kwargs: (
                "crate_mcp_at_" + secrets.token_urlsafe(32)
            ),
            refresh_token_generator=lambda **kwargs: (
                "crate_mcp_rt_" + secrets.token_urlsafe(32)
            ),
            expires_generator=lambda client, grant_type: 900,
        )

    def __call__(self, *args, **kwargs):
        return _TokenResponse(super().__call__(*args, **kwargs))


class CrateAuthorizationServer(AuthorizationServer):
    def __init__(self, session):
        super().__init__(scopes_supported=sorted(ALLOWED_GRANTS))
        self.session = session
        self.register_grant(_CodeGrant, [_S256(required=True)])
        self.register_grant(_RefreshGrant)
        self.register_endpoint(_Revocation)
        self.register_token_generator("default", _CrateTokenGenerator())

    def query_client(self, client_id):
        row = store.get_oauth_client(client_id, session=self.session)
        return OAuthClient(row) if row and row["enabled"] else None

    def create_oauth2_request(self, request):
        return request

    def save_token(self, token, request):
        credential = request.authorization_code or request.refresh_token
        store.save_oauth_token(token, vars(credential), session=self.session)

    def send_signal(self, name, *args, **kwargs):
        pass

    def handle_response(self, status, body, headers):
        return status, body, dict(headers)


def prepare_consent(parameters, user):
    def _impl(session):
        server = CrateAuthorizationServer(session)
        request = OAuthRequest("GET", "/oauth/authorize", parameters)
        grant = server.get_consent_grant(request, end_user=user)
        accepted = (
            set(request.scope.split())
            & store.current_user_scopes(user["id"], session=session)
            & store.current_connection_scopes(
                user["id"], parameters["client_id"], session=session
            )
        )
        if not accepted:
            raise InvalidScopeError(
                "The user cannot delegate any requested permissions"
            )
        accepted_parameters = {**parameters, "scope": " ".join(sorted(accepted))}
        consent_id, nonce = store.create_consent(
            user["id"], user["session_id"], accepted_parameters, session=session
        )
        return (
            {**grant.request.client.row, "accepted_scopes": sorted(accepted)},
            consent_id,
            nonce,
        )

    return store.oauth_transaction(_impl)


def complete_consent(consent_id, nonce, user, approved):
    def _impl(session):
        parameters = store.consume_consent(
            consent_id, nonce, user["id"], user["session_id"], session=session
        )
        if parameters is None:
            raise InvalidRequestError(
                "Consent expired, was used or belongs to another session"
            )
        server = CrateAuthorizationServer(session)
        request = OAuthRequest("GET", "/oauth/authorize", parameters)
        grant = server.get_consent_grant(request, end_user=user)
        if not set(request.scope.split()) <= (
            store.current_user_scopes(user["id"], session=session)
            & store.current_connection_scopes(
                user["id"], parameters["client_id"], session=session
            )
        ):
            raise InvalidScopeError(
                "Current user permissions do not allow this consent"
            )
        result = cast(
            tuple[int, Any, dict[str, str]],
            server.create_authorization_response(
                request, grant_user=user if approved else None, grant=grant
            ),
        )
        # Mix-up defenses: a successful authorization response identifies its issuer.
        if result[0] == 302:
            from authlib.common.urls import add_params_to_uri

            result[2]["Location"] = add_params_to_uri(
                result[2]["Location"], [("iss", oauth_settings().issuer)]
            )
        return result

    return store.oauth_transaction(_impl)


def token_response(parameters, headers=None):
    def _impl(session):
        return CrateAuthorizationServer(session).create_token_response(
            OAuthRequest("POST", "/oauth/token", parameters, headers)
        )

    return store.oauth_transaction(_impl)


def revocation_response(parameters, headers=None):
    def _impl(session):
        return CrateAuthorizationServer(session).create_endpoint_response(
            "revocation", OAuthRequest("POST", "/oauth/revoke", parameters, headers)
        )

    return store.oauth_transaction(_impl)


class CrateTokenVerifier:
    def __init__(self, limiter=None, *, service_resolver=None):
        self.limiter = limiter or anyio.CapacityLimiter(8)
        self.service_resolver = service_resolver or resolve_credential

    async def verify_token(self, token: str) -> AccessToken | None:
        if token.startswith("crate_mcp_at_"):
            resolved = await anyio.to_thread.run_sync(
                store.resolve_oauth_access_token, token, limiter=self.limiter
            )
            if resolved is None:
                return None
            principal, expires_at = resolved
            if principal.client_id is None or principal.actor_user_id is None:
                return None
            return AccessToken(
                token=token,
                client_id=principal.client_id,
                scopes=sorted(principal.grants),
                expires_at=int(expires_at.timestamp()),
                resource=oauth_settings().resource,
                subject=str(principal.actor_user_id),
                claims={"iss": oauth_settings().issuer, "agent_principal": principal},
            )
        principal = await anyio.to_thread.run_sync(
            self.service_resolver, token, limiter=self.limiter
        )
        if principal is None:
            return None
        return AccessToken(
            token=token,
            client_id=principal.id,
            scopes=sorted(principal.grants),
            resource=oauth_settings().resource if oauth_enabled() else None,
            claims={"agent_principal": principal},
        )


__all__ = [
    "CrateAuthorizationServer",
    "CrateTokenVerifier",
    "OAuthClient",
    "OAuthRequest",
    "complete_consent",
    "prepare_consent",
    "revocation_response",
    "token_response",
]
