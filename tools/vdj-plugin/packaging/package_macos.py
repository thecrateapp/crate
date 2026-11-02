"""Package the VirtualDJ Online Source as a macOS arm64 archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

PLATFORM = "macos-arm64"
INSTALL_PATH = "~/Library/Application Support/VirtualDJ/PluginsMacArm/OnlineSources"
FORBIDDEN_NAMES = {"vdjPlugin8.h", "vdjOnlineSource.h", "vdjDsp8.h", "vdjVideo8.h"}
TOKEN_PATTERN = re.compile(rb"crv_[A-Za-z0-9_-]{40,}")


class PackagingError(RuntimeError):
    pass


def nm_exports(binary: Path) -> str:
    return subprocess.run(
        ["nm", "-gU", str(binary)], check=True, capture_output=True, text=True
    ).stdout


def adhoc_sign(bundle: Path) -> None:
    subprocess.run(
        ["codesign", "--force", "--sign", "-", "--timestamp=none", str(bundle)],
        check=True,
    )


def _info(bundle: Path) -> dict:
    with (bundle / "Contents" / "Info.plist").open("rb") as source:
        return plistlib.load(source)


def validate_bundle(
    bundle: Path, *, exports: Callable[[Path], str] = nm_exports
) -> list[str]:
    if not (bundle / "Contents" / "Info.plist").is_file():
        return [f"{bundle} has no Info.plist"]
    problems = []
    info = _info(bundle)
    if info.get("CFBundleName") != "Crate" or info.get("CFBundleExecutable") != "Crate":
        problems.append("the bundle must be named Crate: VirtualDJ keys tracks by it")
    binary = bundle / "Contents" / "MacOS" / str(info.get("CFBundleExecutable", ""))
    if not binary.is_file():
        problems.append(f"missing executable {binary.name}")
    elif "_DllGetClassObject" not in exports(binary):
        problems.append("the executable does not export DllGetClassObject")
    for path in bundle.rglob("*"):
        if not path.is_file():
            continue
        if path.name in FORBIDDEN_NAMES or "probe" in path.name.lower():
            problems.append(f"{path.name} must not ship")
        elif TOKEN_PATTERN.search(path.read_bytes()):
            problems.append(f"{path.name} contains an access token")
    return problems


def supported_contracts(header: Path) -> list[str]:
    match = re.search(
        r"supported_contract_versions\s*=\s*\{([^}]*)\}", header.read_text()
    )
    if match is None:
        raise PackagingError(f"no supported contract versions in {header}")
    return re.findall(r'"([^"]+)"', match.group(1))


def build_manifest(
    *,
    version: str,
    contracts: list[str],
    tested_virtualdj: list[str],
    archive: str,
    sha256: str,
) -> dict:
    return {
        "plugin": "Crate",
        "version": version,
        "platform": PLATFORM,
        "archive": archive,
        "sha256": sha256,
        "crate_contracts": contracts,
        "virtualdj_tested": tested_virtualdj,
        "requires": "VirtualDJ Pro",
        "install_path": INSTALL_PATH,
        "signing": "ad-hoc",
    }


def package(
    bundle: Path,
    output: Path,
    *,
    contract_header: Path,
    tested_virtualdj: list[str],
    exports: Callable[[Path], str] = nm_exports,
    sign: Callable[[Path], None] = adhoc_sign,
) -> Path:
    problems = validate_bundle(bundle, exports=exports)
    if problems:
        raise PackagingError("; ".join(problems))
    version = str(_info(bundle)["CFBundleShortVersionString"])
    contracts = supported_contracts(contract_header)
    archive_name = f"Crate-VirtualDJ-{PLATFORM}-{version}.zip"
    output.mkdir(parents=True, exist_ok=True)
    archive = output / archive_name
    with tempfile.TemporaryDirectory() as staging:
        staged = Path(staging) / "Crate.bundle"
        shutil.copytree(bundle, staged, symlinks=True)
        sign(staged)
        archive.unlink(missing_ok=True)
        shutil.make_archive(
            str(archive.with_suffix("")), "zip", staging, "Crate.bundle"
        )
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / f"{archive_name}.sha256").write_text(f"{digest}  {archive_name}\n")
    manifest = build_manifest(
        version=version,
        contracts=contracts,
        tested_virtualdj=tested_virtualdj,
        archive=archive_name,
        sha256=digest,
    )
    (output / f"manifest-{PLATFORM}.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return archive


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--contract-header", type=Path, required=True)
    parser.add_argument("--tested-virtualdj", action="append", required=True)
    args = parser.parse_args()
    try:
        archive = package(
            args.bundle,
            args.output,
            contract_header=args.contract_header,
            tested_virtualdj=args.tested_virtualdj,
        )
    except PackagingError as error:
        print(f"packaging failed: {error}", file=sys.stderr)
        return 1
    print(archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
