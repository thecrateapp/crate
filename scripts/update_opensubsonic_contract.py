#!/usr/bin/env python3
"""Update pinned OpenSubsonic and Subsonic contract fixtures explicitly."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_ROOT = ROOT / "app/tests/contracts/opensubsonic"
OPEN_SUBSONIC_REPOSITORY = "https://github.com/opensubsonic/open-subsonic-api"
XSD_URL = "https://subsonic.org/pages/inc/api/schema/subsonic-rest-api-1.16.1.xsd"
USER_AGENT = "Crate-OpenSubsonic-contract-updater"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_tree(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(file_path.relative_to(path).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(_sha256_file(file_path)))
    return digest.hexdigest()


def _download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=90) as response:
        return response.read()


def _extract_openapi(archive_bytes: bytes, destination: Path) -> None:
    destination.mkdir(parents=True)
    extracted_files = 0
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            parts = PurePosixPath(member.name).parts
            try:
                openapi_index = parts.index("openapi")
            except ValueError:
                continue
            relative_path = PurePosixPath(*parts[openapi_index + 1 :])
            if (
                not relative_path.parts
                or relative_path.is_absolute()
                or ".." in relative_path.parts
            ):
                raise ValueError(f"Unsafe path in upstream archive: {member.name}")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Could not read upstream file: {member.name}")
            output_path = destination.joinpath(*relative_path.parts)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(source.read())
            extracted_files += 1
    if extracted_files == 0 or not (destination / "openapi.json").is_file():
        raise ValueError("The upstream archive did not contain the OpenAPI tree")


def update(revision: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("revision must be a full 40-character lowercase Git SHA")

    CONTRACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="opensubsonic-contract-") as temp_dir:
        staging_root = Path(temp_dir)
        openapi_stage = staging_root / "openapi"
        archive = _download(
            f"https://codeload.github.com/opensubsonic/open-subsonic-api/tar.gz/{revision}"
        )
        _extract_openapi(archive, openapi_stage)
        xsd_bytes = _download(XSD_URL)
        xsd_stage = staging_root / "subsonic-rest-api-1.16.1.xsd"
        xsd_stage.write_bytes(xsd_bytes)

        metadata = {
            "open_subsonic": {
                "repository": OPEN_SUBSONIC_REPOSITORY,
                "revision": revision,
                "openapi_tree_sha256": _sha256_tree(openapi_stage),
            },
            "subsonic_xsd": {
                "version": "1.16.1",
                "source": XSD_URL,
                "path": "subsonic-rest-api-1.16.1.xsd",
                "sha256": _sha256_file(xsd_stage),
            },
        }
        metadata_stage = staging_root / "revision.json"
        metadata_stage.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")

        openapi_target = CONTRACT_ROOT / "openapi"
        if openapi_target.exists():
            shutil.rmtree(openapi_target)
        shutil.move(str(openapi_stage), str(openapi_target))
        shutil.move(str(xsd_stage), str(CONTRACT_ROOT / "subsonic-rest-api-1.16.1.xsd"))
        shutil.move(str(metadata_stage), str(CONTRACT_ROOT / "revision.json"))


def check() -> None:
    metadata_path = CONTRACT_ROOT / "revision.json"
    if not metadata_path.is_file():
        raise FileNotFoundError(metadata_path)
    metadata = json.loads(metadata_path.read_text())
    openapi_path = CONTRACT_ROOT / "openapi"
    xsd_path = CONTRACT_ROOT / metadata["subsonic_xsd"]["path"]
    if _sha256_tree(openapi_path) != metadata["open_subsonic"]["openapi_tree_sha256"]:
        raise ValueError("Pinned OpenSubsonic OpenAPI files do not match revision.json")
    if _sha256_file(xsd_path) != metadata["subsonic_xsd"]["sha256"]:
        raise ValueError("Pinned Subsonic XSD does not match revision.json")
    print(
        "Pinned OpenSubsonic contract verified at "
        f"{metadata['open_subsonic']['revision']}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    update_parser = commands.add_parser(
        "update", help="download a pinned upstream revision"
    )
    update_parser.add_argument("--revision", required=True)
    commands.add_parser("check", help="verify pinned fixture hashes without network")
    args = parser.parse_args()
    if args.command == "update":
        update(args.revision)
    else:
        check()


if __name__ == "__main__":
    main()
