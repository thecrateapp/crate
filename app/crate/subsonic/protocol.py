"""OpenSubsonic response envelope and JSON/XML renderers."""

import xml.etree.ElementTree as ET
from typing import Any

from fastapi.responses import JSONResponse, Response

from crate.subsonic.errors import OpenSubsonicError

API_VERSION = "1.16.1"
SERVER_NAME = "Crate"
SERVER_VERSION = "0.1.0"
XML_NAMESPACE = "http://subsonic.org/restapi"


def response_envelope(
    data: dict[str, Any] | None = None,
    error: OpenSubsonicError | None = None,
) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "status": "failed" if error else "ok",
        "version": API_VERSION,
        "type": SERVER_NAME,
        "serverVersion": SERVER_VERSION,
        "openSubsonic": True,
    }
    if error:
        envelope["error"] = {"code": error.code, "message": error.message}
    elif data:
        envelope.update(data)
    return {"subsonic-response": envelope}


def render_response(
    data: dict[str, Any] | None = None,
    *,
    error: OpenSubsonicError | None = None,
    response_format: str = "xml",
) -> Response:
    envelope = response_envelope(data, error)
    if response_format == "json":
        return JSONResponse(content=envelope)
    if response_format != "xml":
        raise ValueError("response_format must be 'json' or 'xml'")
    return Response(
        content=_render_xml(envelope["subsonic-response"]),
        media_type="application/xml",
    )


def _render_xml(envelope: dict[str, Any]) -> bytes:
    ET.register_namespace("", XML_NAMESPACE)
    root = ET.Element(
        _qualified("subsonic-response"),
        {
            name: _xml_value(envelope[name])
            for name in ("status", "version", "type", "serverVersion", "openSubsonic")
        },
    )
    for name, value in envelope.items():
        if name not in {"status", "version", "type", "serverVersion", "openSubsonic"}:
            _append_element(root, name, value)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _append_element(parent: ET.Element, name: str, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, list):
        if name.endswith("s"):
            container = ET.SubElement(parent, _qualified(name))
            for item in value:
                _append_element(container, name[:-1], item)
            return
        for item in value:
            _append_element(parent, name, item)
        return

    element = ET.SubElement(parent, _qualified(name))
    if isinstance(value, dict):
        for key, item in value.items():
            if item is None:
                continue
            if isinstance(item, (str, int, float, bool)):
                element.set(key, _xml_value(item))
            else:
                _append_element(element, key, item)
        return
    element.text = _xml_value(value)


def _qualified(name: str) -> str:
    return f"{{{XML_NAMESPACE}}}{name}"


def _xml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)
