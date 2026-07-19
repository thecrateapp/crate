from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_dev_caddy_routes_canonical_catalog_reads_through_readplane():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()
    compose = yaml.safe_load((ROOT / "docker-compose.readplane.dev.yaml").read_text())

    assert "method GET" in caddyfile
    assert "/api/catalog/*" in caddyfile
    assert "reverse_proxy readplane:8686" in caddyfile
    assert (
        compose["services"]["readplane"]["environment"]["READPLANE_ROUTE_MODE"]
        == "active"
    )


def test_production_traefik_routes_canonical_catalog_gets_to_readplane():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    readplane = compose["services"]["crate-readplane"]
    labels = readplane["labels"]

    assert labels["traefik.enable"] is True
    rule = labels["traefik.http.routers.crate-readplane-interactive.rule"]
    assert "Host(`api.${DOMAIN}`)" in rule
    assert "Method(`GET`)" in rule
    assert "PathPrefix(`/api/catalog/`)" in rule
    assert labels["traefik.http.routers.crate-readplane-interactive.priority"] > 0
    assert (
        labels["traefik.http.services.crate-readplane.loadbalancer.server.port"] == 8686
    )
    assert (
        "READPLANE_ROUTE_MODE=${READPLANE_ROUTE_MODE:-active}"
        in readplane["environment"]
    )
