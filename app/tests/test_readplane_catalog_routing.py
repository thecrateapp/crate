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


def test_dev_caddy_routes_only_smart_mix_summaries_through_readplane():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()

    assert "@smart_mix_full" in caddyfile
    assert "path /api/tracks/by-entity/*/mix-profile" in caddyfile
    assert "query detail=full" in caddyfile
    full_route = caddyfile.split("handle @smart_mix_full", maxsplit=1)[1].split(
        "}", maxsplit=1
    )[0]
    assert "reverse_proxy api:8585" in full_route
    assert "method GET" in caddyfile


def test_dynamic_and_admin_smart_mix_routes_stay_on_fastapi():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()

    assert (
        "/api/playback/transition-plans"
        not in caddyfile.split("(readplane_listen)", maxsplit=1)[1].split(
            "(auth_api)", maxsplit=1
        )[0]
    )
    assert (
        "/api/admin/smart-mix"
        not in caddyfile.split("(readplane_listen)", maxsplit=1)[1].split(
            "(auth_api)", maxsplit=1
        )[0]
    )
    assert "method GET" in caddyfile


def test_production_traefik_routes_canonical_catalog_gets_to_readplane():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    readplane = compose["services"]["crate-readplane"]
    labels = readplane["labels"]

    assert labels["traefik.enable"] is True
    rule = labels["traefik.http.routers.crate-readplane-interactive.rule"]
    assert "Host(`api.${DOMAIN}`)" in rule
    assert "Method(`GET`" in rule
    assert "PathPrefix(`/api/catalog/`)" in rule
    assert labels["traefik.http.routers.crate-readplane-interactive.priority"] > 0
    assert (
        labels["traefik.http.services.crate-readplane.loadbalancer.server.port"] == 8686
    )
    assert (
        "READPLANE_ROUTE_MODE=${READPLANE_ROUTE_MODE:-active}"
        in readplane["environment"]
    )


def test_readplane_media_mounts_are_read_only_and_cutover_defaults_off():
    production = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())["services"][
        "crate-readplane"
    ]
    home = yaml.safe_load((ROOT / "docker-compose.home.yaml").read_text())["services"][
        "crate-readplane"
    ]
    development = yaml.safe_load(
        (ROOT / "docker-compose.readplane.dev.yaml").read_text()
    )["services"]["readplane"]

    for service in (production, home, development):
        environment = service["environment"]
        rendered = (
            "\n".join(environment)
            if isinstance(environment, list)
            else str(environment)
        )
        assert "READPLANE_LOCAL_MEDIA_ENABLED" in rendered
        assert any(str(volume).endswith(":/music:ro") for volume in service["volumes"])
        assert any(str(volume).endswith(":/cache:ro") for volume in service["volumes"])
        assert all(":/data" not in str(volume) for volume in service["volumes"])
