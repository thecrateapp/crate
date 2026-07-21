from pathlib import Path


INSTALLER = Path(__file__).resolve().parents[2] / "install.sh"


def _generated_env_template() -> str:
    script = INSTALLER.read_text(encoding="utf-8")
    start = script.index('cat > "${env_path}" <<EOF')
    end = script.index("\nEOF", start)
    return script[start:end]


def test_home_installer_generates_the_required_readplane_secrets():
    template = _generated_env_template()

    assert 'REDIS_PASSWORD=$(quote_env_value "${redis_password}")' in template
    assert (
        'CRATE_READPLANE_SERVICE_TOKEN=$(quote_env_value "${readplane_service_token}")'
        in template
    )


def test_home_installer_downloads_the_readplane_proxy_configuration():
    script = INSTALLER.read_text(encoding="utf-8")

    assert (
        'download "${CRATE_RAW_BASE}/deploy/traefik/federation-readplane.yml"' in script
    )
