from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
ACCESS_TOKEN_ROUTER = "traefik.http.routers.crate-api-access-token"
READPLANE_ROUTERS = (
    "crate-readplane-interactive",
    "crate-readplane-sse",
    "crate-readplane-stream",
)


def _labels(compose_file: str, service: str) -> dict:
    compose = yaml.safe_load((ROOT / compose_file).read_text())
    return compose["services"][service]["labels"]


@pytest.mark.parametrize(
    "compose_file", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
def test_access_tokens_reach_fastapi_before_any_readplane_router(compose_file):
    api_labels = _labels(compose_file, "crate-api")
    readplane_labels = _labels(compose_file, "crate-readplane")

    rule = api_labels[f"{ACCESS_TOKEN_ROUTER}.rule"]
    assert "HeaderRegexp(`Authorization`, `^Bearer\\s+crv_`)" in rule
    assert rule.startswith("Host(`api.${DOMAIN")
    assert api_labels[f"{ACCESS_TOKEN_ROUTER}.service"] == "crate-api"
    priority = int(api_labels[f"{ACCESS_TOKEN_ROUTER}.priority"])
    for router in READPLANE_ROUTERS:
        assert priority > int(
            readplane_labels[f"traefik.http.routers.{router}.priority"]
        )


@pytest.mark.parametrize(
    "compose_file", ["docker-compose.yaml", "docker-compose.home.yaml"]
)
def test_access_token_router_keeps_tls_and_entrypoint(compose_file):
    api_labels = _labels(compose_file, "crate-api")

    assert f"{ACCESS_TOKEN_ROUTER}.entryPoints" in api_labels
    assert f"{ACCESS_TOKEN_ROUTER}.tls" in api_labels


def test_dev_caddy_routes_access_tokens_to_fastapi():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()

    assert "@vdj_auth header_regexp Authorization ^Bearer[[:space:]]+crv_" in caddyfile


def test_invalid_access_token_is_rejected_without_jwt_fallback():
    import asyncio
    from unittest.mock import patch

    from starlette.requests import Request

    from crate.api.auth import AuthMiddleware

    middleware = AuthMiddleware(lambda scope, receive, send: None)
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/search",
            "headers": [(b"authorization", b"Bearer crv_revoked")],
            "query_string": b"",
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 443),
        }
    )
    with (
        patch(
            "crate.db.repositories.access_tokens.resolve_access_token",
            return_value=None,
        ),
        patch.object(middleware, "_resolve_token_user") as jwt,
    ):
        resolved = asyncio.run(middleware.resolve_user(request))

    assert resolved is None
    jwt.assert_not_called()
