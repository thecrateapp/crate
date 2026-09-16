import json
import xml.etree.ElementTree as ET
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from crate.api.subsonic import create_subsonic_router
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.protocol import render_response
from tests.subsonic.contract_helpers import CONTRACT_ROOT, validate_json_response


XML_NAMESPACE = "http://subsonic.org/restapi"


def test_json_success_envelope_matches_open_subsonic_golden() -> None:
    response = render_response({}, response_format="json")
    payload = json.loads(response.body)

    expected = json.loads((CONTRACT_ROOT / "golden" / "ping-success.json").read_text())
    assert payload == expected
    assert validate_json_response(payload) == []


def test_json_error_envelope_matches_open_subsonic_golden() -> None:
    response = render_response(
        error=OpenSubsonicError(
            ErrorCode.INVALID_CREDENTIALS, "Wrong username or password"
        ),
        response_format="json",
    )
    payload = json.loads(response.body)

    expected = json.loads((CONTRACT_ROOT / "golden" / "auth-error.json").read_text())
    assert payload == expected
    assert validate_json_response(payload) == []


def test_xml_success_envelope_serializes_payload_attributes() -> None:
    response = render_response(
        {"license": {"valid": True, "email": "crate@local"}},
        response_format="xml",
    )
    root = ET.fromstring(response.body)

    assert root.tag == f"{{{XML_NAMESPACE}}}subsonic-response"
    assert root.attrib == {
        "status": "ok",
        "version": "1.16.1",
        "type": "Crate",
        "serverVersion": "0.1.0",
        "openSubsonic": "true",
    }
    license_node = root.find(f"{{{XML_NAMESPACE}}}license")
    assert license_node is not None
    assert license_node.attrib == {"valid": "true", "email": "crate@local"}


def test_xml_serializes_repeated_media_elements_with_contract_names() -> None:
    response = render_response(
        {
            "artists": {
                "ignoredArticles": "The",
                "index": [
                    {
                        "name": "C",
                        "artist": [
                            {"id": "ga-artist", "name": "Converge", "albumCount": 1}
                        ],
                    }
                ],
            }
        },
        response_format="xml",
    )
    root = ET.fromstring(response.body)
    artists = root.find(f"{{{XML_NAMESPACE}}}artists")

    assert artists is not None
    indexes = artists.findall(f"{{{XML_NAMESPACE}}}index")
    assert len(indexes) == 1
    assert indexes[0].attrib == {"name": "C"}
    artists_in_index = indexes[0].findall(f"{{{XML_NAMESPACE}}}artist")
    assert len(artists_in_index) == 1
    assert artists_in_index[0].attrib == {
        "id": "ga-artist",
        "name": "Converge",
        "albumCount": "1",
    }


def test_xml_error_envelope_uses_protocol_error_attributes() -> None:
    response = render_response(
        error=OpenSubsonicError(
            ErrorCode.INVALID_CREDENTIALS, "Wrong username or password"
        ),
        response_format="xml",
    )
    root = ET.fromstring(response.body)
    error = root.find(f"{{{XML_NAMESPACE}}}error")

    assert response.status_code == 200
    assert root.attrib["status"] == "failed"
    assert root.attrib["openSubsonic"] == "true"
    assert error is not None
    assert error.attrib == {"code": "40", "message": "Wrong username or password"}


def test_v1_system_routes_support_view_aliases_and_public_extensions() -> None:
    app = FastAPI()
    router = create_subsonic_router("v1")
    app.include_router(router)
    client = TestClient(app)
    query = {"u": "diego", "v": "1.16.1", "c": "contract-test", "f": "json"}

    with patch("crate.subsonic.auth.authenticate", return_value={"id": 1}):
        ping = client.get("/rest/ping", params=query)
        ping_view = client.get("/rest/ping.view", params=query)
        license_response = client.get("/rest/getLicense", params=query)
        extensions = client.get(
            "/rest/getOpenSubsonicExtensions",
            params={"v": "1.16.1", "c": "contract-test", "f": "json"},
        )

    assert ping.status_code == ping_view.status_code == 200
    assert ping.json() == ping_view.json()
    assert license_response.json()["subsonic-response"]["license"]["valid"] is True
    assert extensions.json()["subsonic-response"]["openSubsonicExtensions"] == [
        {"name": "indexBasedQueue", "versions": [1]}
    ]
    assert extensions.json()["subsonic-response"]["openSubsonic"] is True
    assert "/rest/getMusicFolders" in {route.path for route in router.routes}
    assert {
        "/rest/getPlayQueue",
        "/rest/getPlayQueueByIndex",
        "/rest/savePlayQueue",
        "/rest/savePlayQueueByIndex",
    }.issubset({route.path for route in router.routes})
    assert sum(route.path == "/rest/ping" for route in router.routes) == 1


def test_engine_flag_selects_the_requested_router(monkeypatch) -> None:
    monkeypatch.setenv("CRATE_OPEN_SUBSONIC_ENGINE", "v1")

    paths = {route.path for route in create_subsonic_router().routes}

    assert "/rest/getOpenSubsonicExtensions" in paths
    assert "/rest/getMusicFolders" in paths
    assert sum(path == "/rest/ping" for path in paths) == 1


def test_invalid_engine_flag_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("CRATE_OPEN_SUBSONIC_ENGINE", "future")

    with pytest.raises(ValueError, match="CRATE_OPEN_SUBSONIC_ENGINE"):
        create_subsonic_router()


def test_v1_missing_common_parameter_returns_protocol_error_not_fastapi_422() -> None:
    app = FastAPI()
    app.include_router(create_subsonic_router("v1"))

    response = TestClient(app).get(
        "/rest/ping", params={"c": "contract-test", "f": "json"}
    )

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["status"] == "failed"
    assert response.json()["subsonic-response"]["error"]["code"] == 10


def test_v1_missing_authentication_returns_auth_mechanism_error() -> None:
    app = FastAPI()
    app.include_router(create_subsonic_router("v1"))

    response = TestClient(app).get(
        "/rest/ping", params={"v": "1.16.1", "c": "contract-test", "f": "json"}
    )

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["error"]["code"] == 42


def test_v1_ping_accepts_posted_form_credentials() -> None:
    app = FastAPI()
    app.include_router(create_subsonic_router("v1"))
    form = {
        "v": "1.16.1",
        "c": "contract-test",
        "u": "listener",
        "p": "dedicated-secret",
        "f": "json",
    }

    with patch("crate.subsonic.auth.authenticate") as authenticate:
        authenticate.return_value = {"id": 1}
        response = TestClient(app).post("/rest/ping", data=form)

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["status"] == "ok"
    params = authenticate.call_args.args[0]
    assert params.first("u") == "listener"
    assert params.first("p") == "dedicated-secret"


def test_legacy_engine_retains_existing_system_routes() -> None:
    router = create_subsonic_router("legacy")

    paths = {route.path for route in router.routes}
    assert "/rest/ping" in paths
    assert "/rest/ping.view" in paths
    assert "/rest/getMusicFolders" in paths
