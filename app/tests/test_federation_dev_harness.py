from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _compose() -> dict:
    return yaml.safe_load((ROOT / "docker-compose.federation-dev.yaml").read_text())


def test_federation_dev_harness_serves_node_a_admin():
    services = _compose()["services"]

    admin = services["node-a-admin"]

    assert admin["container_name"] == "fed-a-admin"
    assert admin["build"] == {"context": "./app", "dockerfile": "ui/Dockerfile"}
    assert "15173:80" in admin["ports"]
    assert "fed-net" in admin["networks"]
    assert admin["depends_on"]["node-a-api"]["condition"] == "service_started"


def test_federation_dev_harness_admin_shares_node_a_api_alias():
    services = _compose()["services"]

    node_a_api_aliases = services["node-a-api"]["networks"]["fed-net"]["aliases"]

    assert "crate-api" in node_a_api_aliases
    assert "fed-net" in services["node-a-admin"]["networks"]


def test_federation_dev_makefile_operates_node_a_admin():
    makefile = (ROOT / "Makefile").read_text()

    assert "fed-a-admin" in makefile
    assert "FED_ADMIN_A := http://localhost:15173" in makefile
    assert "15173" in makefile
    assert "Admin did not become ready: $(FED_ADMIN_A)" in makefile
    assert "Node A Admin: $(FED_ADMIN_A)" in makefile


def test_federation_dev_smoke_checks_node_a_admin():
    smoke = (ROOT / "scripts/federation-smoke.sh").read_text()

    assert 'ADMIN_A="http://localhost:15173"' in smoke
    assert 'echo "Admin A: $ADMIN_A"' in smoke
    assert "Node A Admin frontend..." in smoke
    assert "Node A Admin frontend is not reachable at $ADMIN_A" in smoke


def test_federation_dev_e2e_indexes_genres_after_fixture_sync():
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert 'client.post("/api/genres/index")' in script
    assert "index_genres(a)" in script
    assert "index_genres(b)" in script


def test_federation_dev_harness_inherits_enrichment_provider_credentials():
    services = _compose()["services"]
    expected = {
        "LASTFM_APIKEY=${LASTFM_APIKEY:-}",
        "LASTFM_API_SECRET=${LASTFM_API_SECRET:-}",
        "FANART_API_KEY=${FANART_API_KEY:-}",
        "SPOTIFY_ID=${SPOTIFY_ID:-}",
        "SPOTIFY_SECRET=${SPOTIFY_SECRET:-}",
        "SETLISTFM_API_KEY=${SETLISTFM_API_KEY:-}",
    }

    for service_name in ("node-a-api", "node-a-worker", "node-b-api", "node-b-worker"):
        assert expected <= set(services[service_name]["environment"])
