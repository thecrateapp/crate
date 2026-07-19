import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _manifest() -> dict:
    return json.loads((ROOT / "deploy/readplane/routes.json").read_text())


def test_route_manifest_covers_interactive_sse_and_stream_reads():
    manifest = _manifest()
    routes = manifest["routes"]

    assert all(route["methods"] == ["GET"] for route in routes)
    by_class = {
        route_class: {
            route.get("path") or route.get("path_prefix")
            for route in routes
            if route["class"] == route_class
        }
        for route_class in ("interactive", "sse", "stream")
    }

    assert "/api/catalog/" in by_class["interactive"]
    assert "/api/me/home/" in by_class["interactive"]
    assert "/api/me/stats/dashboard" in by_class["interactive"]
    assert "/api/search" in by_class["interactive"]
    assert "/api/cache/events" in by_class["sse"]
    assert "/api/me/home/discovery-stream" in by_class["sse"]
    assert "/api/federation/remote/streams/" in by_class["stream"]
    assert "/api/tracks/" in by_class["stream"]


def test_listen_proxy_uses_bounded_route_specific_readplane_locations():
    nginx = (ROOT / "app/listen/nginx.conf").read_text()

    assert "map $request_method $read_backend" in nginx
    method_map = nginx.split("map $request_method $read_backend", 1)[1].split("}", 1)[0]
    assert "GET http://crate_readplane_backend;" in method_map
    assert "default http://crate-api:8585;" in method_map
    assert "upstream crate_readplane_backend" in nginx
    assert "server crate-api:8585 backup;" in nginx
    assert "location = /api/cache/events" in nginx
    assert "location = /api/me/home/discovery-stream" in nginx
    assert "location ^~ /api/catalog/" in nginx
    assert "location = /api/me/stats/dashboard" in nginx
    assert "location ^~ /api/federation/remote/streams/" in nginx
    assert "proxy_connect_timeout 1s;" in nginx
    assert "proxy_read_timeout 15s;" in nginx
    assert "proxy_read_timeout 86400s;" not in nginx
    assert nginx.count("proxy_pass $read_backend;") >= 6
    assert "error_page 418 = @api_mutation;" in nginx
    mutation_proxy = nginx.split("location @api_mutation {", 1)[1].split("}", 1)[0]
    assert "proxy_pass $api_backend;" in mutation_proxy
    assert "proxy_read_timeout 30s;" in mutation_proxy

    generic_api = nginx.split("location /api/ {", 1)[1].split("}", 1)[0]
    assert "proxy_pass $api_backend;" in generic_api
    assert "proxy_buffering off" not in generic_api
    assert "proxy_read_timeout 30s;" in generic_api


def test_api_domain_routes_readplane_classes_with_explicit_priority():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    labels = compose["services"]["crate-readplane"]["labels"]

    for router in ("interactive", "sse", "stream"):
        rule = labels[f"traefik.http.routers.crate-readplane-{router}.rule"]
        assert "Host(`api.${DOMAIN}`)" in rule
        assert "Method(`GET`)" in rule
        assert labels[f"traefik.http.routers.crate-readplane-{router}.priority"] >= 100

    assert (
        "PathPrefix(`/api/me/home/`)"
        in labels["traefik.http.routers.crate-readplane-interactive.rule"]
    )
    assert (
        "Path(`/api/me/stats/dashboard`)"
        in labels["traefik.http.routers.crate-readplane-interactive.rule"]
    )
    assert (
        "Path(`/api/cache/events`)"
        in labels["traefik.http.routers.crate-readplane-sse.rule"]
    )
    assert (
        "PathPrefix(`/api/federation/remote/streams/`)"
        in labels["traefik.http.routers.crate-readplane-stream.rule"]
    )
