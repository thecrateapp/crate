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
        "TICKETMASTER_API_KEY=${TICKETMASTER_API_KEY:-}",
        "OPENAI_API_KEY=${OPENAI_API_KEY:-}",
        "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}",
        "GEMINI_API_KEY=${GEMINI_API_KEY:-}",
        "AUDIOMUSE_GEMINI_API_KEY=${AUDIOMUSE_GEMINI_API_KEY:-}",
        "LLM_PROVIDER=${LLM_PROVIDER:-gemini/gemini-2.5-flash}",
    }

    for service_name in ("node-a-api", "node-a-worker", "node-b-api", "node-b-worker"):
        assert expected <= set(services[service_name]["environment"])


def test_federation_dev_harness_uses_strong_consistent_jwt_secrets_per_node():
    services = _compose()["services"]

    for node in ("a", "b"):
        secrets = set()
        for service_name in (f"node-{node}-api", f"node-{node}-worker"):
            environment = services[service_name]["environment"]
            secret = next(
                value.removeprefix("JWT_SECRET=")
                for value in environment
                if value.startswith("JWT_SECRET=")
            )
            assert len(secret.encode()) >= 32
            secrets.add(secret)
        assert len(secrets) == 1


def test_federation_dev_harness_has_a_real_singleton_acceptance_mode():
    makefile = (ROOT / "Makefile").read_text()
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert "federation-dev-up-singleton:" in makefile
    assert "federation-dev-singleton-e2e:" in makefile
    assert "run_singleton_e2e" in script
    assert 'mode in {"singleton", "singleton-parity"}' in script
    assert "wait_for_catalog_ready" in script
    assert "expected zero peers" in script


def test_federation_dev_harness_verifies_catalog_zero_downtime():
    makefile = (ROOT / "Makefile").read_text()
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert "federation-dev-zero-downtime-e2e:" in makefile
    assert "run_zero_downtime_e2e" in script
    assert "probe_catalog_while_task_runs" in script
    assert '"X-Crate-Catalog-Mode"' in script
    for path in (
        "/api/catalog/search",
        "/api/catalog/me/follows",
        "/api/catalog/me/albums/saved",
        "/api/catalog/genres",
        "/api/catalog/tracks/",
    ):
        assert path in script


def test_federation_dev_harness_routes_remote_streams_through_go_readplane():
    services = _compose()["services"]
    makefile = (ROOT / "Makefile").read_text()
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    for node, port in (("a", 18686), ("b", 28686)):
        readplane = services[f"node-{node}-readplane"]
        assert readplane["build"] == {"context": "./app/readplane"}
        assert f"{port}:8686" in readplane["ports"]
        assert not readplane.get("volumes"), "readplane must never mount signing keys"
        environment = set(readplane["environment"])
        assert "READPLANE_FEDERATION_PROXY_ENABLED=true" in environment
        assert "CRATE_FEDERATION_DEV_ALLOW_PRIVATE_NETWORKS=true" in environment

    assert "FED_READPLANE_A := http://localhost:18686" in makefile
    assert "FED_READPLANE_B := http://localhost:28686" in makefile
    assert 'NODE_A_READPLANE = "http://localhost:18686"' in script
    assert "_stream_data_plane_url(stream_url)" in script


def test_federation_chaos_harness_checks_reusable_range_sessions():
    script = (ROOT / "scripts/federation-chaos-e2e.py").read_text()

    assert '"range-resume"' in script
    assert "scenario_range_resume" in script
    assert '"bytes=1024-2047"' in script
    assert "reusable playback session" in script


def test_federation_dev_global_e2e_checks_human_catalog_routes():
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert "probe_human_catalog_routes(a, album)" in script
    assert 'f"/api/artist-slugs/{artist_slug}/page"' in script
    assert 'f"/api/artist-slugs/{artist_slug}/albums/{album_slug}"' in script


def test_federation_dev_e2e_accepts_the_documented_all_switch():
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert 'mode in {"all", "--all"}' in script
    assert "run_e2e()" in script
    assert "run_global_catalog_e2e()" in script
    assert "run_import_e2e()" in script


def test_federation_dev_e2e_has_a_playback_prepare_canary_mode():
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert "run_playback_prepare_e2e()" in script
    assert 'mode == "playback-prepare"' in script


def test_federation_dev_harness_has_no_obsolete_mode_flags():
    compose_text = (ROOT / "docker-compose.federation-dev.yaml").read_text()

    for prohibited in (
        "CRATE_FEDERATION_ENABLED",
        "CRATE_GLOBAL_CATALOG_ENABLED",
        "CRATE_GLOBAL_CATALOG_LISTEN_SURFACES",
        "CRATE_GLOBAL_CATALOG_ALLOW_REMOTE_PLAYLIST_REFS",
    ):
        assert prohibited not in compose_text


def test_api_image_dependency_install_is_resumable():
    dockerfile = (ROOT / "app/Dockerfile").read_text()
    api_stage = dockerfile.split("FROM base AS api", 1)[1].split(
        "FROM base AS worker-core-deps", 1
    )[0]

    assert "--mount=type=cache,target=/root/.cache/pip" in api_stage
    assert "--retries 10" in api_stage
    assert "--timeout 60" in api_stage
    assert "--no-cache-dir" not in api_stage


def test_federation_dev_e2e_approves_pairing_on_the_receiving_node():
    script = (ROOT / "scripts/federation-dev-e2e.py").read_text()

    assert "remote: NodeClient" in script
    assert (
        'remote.post(f"/api/admin/federation/pairing/{request_uid}/approve")' in script
    )
    assert (
        'local.post(f"/api/admin/federation/pairing/{request_uid}/approve")'
        not in script
    )
    assert 'ensure_pair(a, b, "Node B"' in script
    assert 'ensure_pair(b, a, "Node A"' in script


def test_federation_dev_nodes_advertise_peer_reachable_api_urls():
    services = _compose()["services"]

    for node in ("a", "b"):
        environment = set(services[f"node-{node}-api"]["environment"])
        assert f"CRATE_PUBLIC_API_BASE_URL=http://node-{node}-api:8585" in environment
