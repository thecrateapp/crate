from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from jsonschema import Draft4Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT4
from xmlschema import XMLSchema


CONTRACT_ROOT = Path(__file__).parents[1] / "contracts" / "opensubsonic"
OPENAPI_ROOT = CONTRACT_ROOT / "openapi"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_tree(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        relative_path = file_path.relative_to(path).as_posix()
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(sha256_file(file_path)))
    return digest.hexdigest()


def validate_json_response(payload: dict) -> list[str]:
    response_schema_path = OPENAPI_ROOT / "schemas" / "SubsonicResponse.json"
    response_schema = json.loads(response_schema_path.read_text())
    response_schema["id"] = response_schema_path.as_uri()
    openapi_root = OPENAPI_ROOT.resolve()

    def retrieve(uri: str) -> Resource:
        parsed_uri = urlparse(uri)
        if parsed_uri.scheme != "file":
            raise ValueError(f"Unexpected remote OpenAPI reference: {uri}")
        document_path = Path(unquote(parsed_uri.path)).resolve()
        if not document_path.is_relative_to(openapi_root):
            raise ValueError(f"OpenAPI reference escapes pinned fixture: {uri}")
        return Resource.from_contents(
            json.loads(document_path.read_text()),
            default_specification=DRAFT4,
        )

    validator = Draft4Validator(
        response_schema,
        registry=Registry(retrieve=retrieve),
    )
    return [error.message for error in validator.iter_errors(payload)]


def validate_legacy_xml(payload: str) -> bool:
    schema_path = CONTRACT_ROOT / "subsonic-rest-api-1.16.1.xsd"
    return XMLSchema(str(schema_path), allow="local").is_valid(payload)
