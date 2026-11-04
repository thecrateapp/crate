"""Package the VirtualDJ Online Source as a macOS archive."""

from __future__ import annotations

import argparse
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from common import (
    PackagingError,
    base_manifest,
    shipped_file_problems,
    supported_contracts,
    write_checksum,
    write_manifest,
)

INSTALL_FOLDERS = {
    "arm64": "PluginsMacArm",
    "x86_64": "Plugins64",
}
SYSTEM_LIBRARY_PREFIXES = ("/System/Library/", "/usr/lib/")


@dataclass(frozen=True)
class MachOInspection:
    exports: str
    archs: set[str]
    libraries: list[str]
    minimum_macos: str


def _run(*command: str) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def parse_minimum_macos(load_commands: str) -> str:
    match = re.search(r"\bminos\s+(\S+)", load_commands)
    if match is None:
        raise PackagingError("the executable has no LC_BUILD_VERSION")
    return match.group(1)


def inspect_macho(binary: Path) -> MachOInspection:
    libraries = [
        line.split(" (compatibility")[0].strip()
        for line in _run("otool", "-L", str(binary)).splitlines()[1:]
        if line.strip()
    ]
    return MachOInspection(
        exports=_run("nm", "-gU", str(binary)),
        archs=set(_run("lipo", "-archs", str(binary)).split()),
        libraries=libraries,
        minimum_macos=parse_minimum_macos(_run("otool", "-l", str(binary))),
    )


def adhoc_sign(bundle: Path) -> None:
    subprocess.run(
        ["codesign", "--force", "--sign", "-", "--timestamp=none", str(bundle)],
        check=True,
    )


def platform_name(arch: str) -> str:
    return f"macos-{arch}"


def _info(bundle: Path) -> dict:
    with (bundle / "Contents" / "Info.plist").open("rb") as source:
        return plistlib.load(source)


def _binary(bundle: Path) -> Path:
    return (
        bundle / "Contents" / "MacOS" / str(_info(bundle).get("CFBundleExecutable", ""))
    )


def validate_bundle(
    bundle: Path,
    *,
    arch: str,
    inspect: Callable[[Path], MachOInspection] = inspect_macho,
) -> list[str]:
    if not (bundle / "Contents" / "Info.plist").is_file():
        return [f"{bundle} has no Info.plist"]
    problems = []
    info = _info(bundle)
    if info.get("CFBundleName") != "Crate" or info.get("CFBundleExecutable") != "Crate":
        problems.append("the bundle must be named Crate: VirtualDJ keys tracks by it")
    binary = _binary(bundle)
    if not binary.is_file():
        problems.append(f"missing executable {binary.name}")
    else:
        inspection = inspect(binary)
        if "_DllGetClassObject" not in inspection.exports:
            problems.append("the executable does not export DllGetClassObject")
        if inspection.archs != {arch}:
            built = ", ".join(sorted(inspection.archs))
            problems.append(f"the executable is built for {built}, expected {arch}")
        problems.extend(
            f"the executable links {library}, which users do not have"
            for library in inspection.libraries
            if not library.startswith(SYSTEM_LIBRARY_PREFIXES)
        )
    for path in bundle.rglob("*"):
        if path.is_file():
            problems.extend(shipped_file_problems(path))
    return problems


def build_manifest(
    *,
    arch: str,
    version: str,
    contracts: list[str],
    tested_virtualdj: list[str],
    minimum_macos: str,
    archive: str,
    sha256: str,
) -> dict:
    manifest = base_manifest(
        platform=platform_name(arch),
        version=version,
        contracts=contracts,
        tested_virtualdj=tested_virtualdj,
        archive=archive,
        sha256=sha256,
        install_path=(
            "~/Library/Application Support/VirtualDJ/"
            f"{INSTALL_FOLDERS[arch]}/OnlineSources"
        ),
        signing="ad-hoc",
    )
    manifest["minimum_macos"] = minimum_macos
    return manifest


def package(
    bundle: Path,
    output: Path,
    *,
    arch: str,
    contract_header: Path,
    tested_virtualdj: list[str],
    inspect: Callable[[Path], MachOInspection] = inspect_macho,
    sign: Callable[[Path], None] = adhoc_sign,
) -> Path:
    problems = validate_bundle(bundle, arch=arch, inspect=inspect)
    if problems:
        raise PackagingError("; ".join(problems))
    version = str(_info(bundle)["CFBundleShortVersionString"])
    contracts = supported_contracts(contract_header)
    minimum_macos = inspect(_binary(bundle)).minimum_macos
    platform = platform_name(arch)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"Crate-VirtualDJ-{platform}-{version}.zip"
    with tempfile.TemporaryDirectory() as staging:
        staged = Path(staging) / "Crate.bundle"
        shutil.copytree(bundle, staged, symlinks=True)
        sign(staged)
        archive.unlink(missing_ok=True)
        shutil.make_archive(
            str(archive.with_suffix("")), "zip", staging, "Crate.bundle"
        )
    digest = write_checksum(archive)
    write_manifest(
        output,
        platform,
        build_manifest(
            arch=arch,
            version=version,
            contracts=contracts,
            tested_virtualdj=tested_virtualdj,
            minimum_macos=minimum_macos,
            archive=archive.name,
            sha256=digest,
        ),
    )
    return archive


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--arch", choices=sorted(INSTALL_FOLDERS), default="arm64")
    parser.add_argument("--contract-header", type=Path, required=True)
    parser.add_argument("--tested-virtualdj", action="append", default=[])
    args = parser.parse_args()
    try:
        archive = package(
            args.bundle,
            args.output,
            arch=args.arch,
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
