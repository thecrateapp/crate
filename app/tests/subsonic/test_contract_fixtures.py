from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET

from tests.subsonic.contract_helpers import (
    CONTRACT_ROOT,
    sha256_file,
    sha256_tree,
    validate_json_response,
    validate_legacy_xml,
)


def test_contract_metadata_pins_immutable_official_sources() -> None:
    metadata = json.loads((CONTRACT_ROOT / "revision.json").read_text())

    assert metadata["open_subsonic"]["repository"] == (
        "https://github.com/opensubsonic/open-subsonic-api"
    )
    assert re.fullmatch(r"[0-9a-f]{40}", metadata["open_subsonic"]["revision"])
    assert (
        sha256_tree(CONTRACT_ROOT / "openapi")
        == metadata["open_subsonic"]["openapi_tree_sha256"]
    )
    assert metadata["subsonic_xsd"]["version"] == "1.16.1"
    assert (
        sha256_file(CONTRACT_ROOT / metadata["subsonic_xsd"]["path"])
        == metadata["subsonic_xsd"]["sha256"]
    )


def test_enhanced_json_success_envelope_matches_openapi() -> None:
    payload = json.loads((CONTRACT_ROOT / "golden" / "ping-success.json").read_text())

    assert validate_json_response(payload) == []


def test_enhanced_json_error_envelope_matches_openapi() -> None:
    payload = json.loads((CONTRACT_ROOT / "golden" / "auth-error.json").read_text())

    assert validate_json_response(payload) == []


def test_openapi_validation_rejects_missing_required_opensubsonic_flag() -> None:
    payload = json.loads((CONTRACT_ROOT / "golden" / "ping-success.json").read_text())
    del payload["subsonic-response"]["openSubsonic"]

    errors = validate_json_response(payload)

    assert errors


def test_legacy_xml_projection_validates_against_subsonic_xsd() -> None:
    payload = (CONTRACT_ROOT / "golden" / "ping-legacy.xml").read_text()

    assert validate_legacy_xml(payload)


def test_enhanced_xml_is_not_misrepresented_as_legacy_xsd_valid() -> None:
    payload = (CONTRACT_ROOT / "golden" / "ping-opensubsonic.xml").read_text()

    assert not validate_legacy_xml(payload)


def test_enhanced_xml_golden_preserves_opensubsonic_attributes() -> None:
    payload = (CONTRACT_ROOT / "golden" / "ping-opensubsonic.xml").read_text()
    root = ET.fromstring(payload)

    assert root.tag == "{http://subsonic.org/restapi}subsonic-response"
    assert root.attrib == {
        "status": "ok",
        "version": "1.16.1",
        "type": "Crate",
        "serverVersion": "0.1.0",
        "openSubsonic": "true",
    }
