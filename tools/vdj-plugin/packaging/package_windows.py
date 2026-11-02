"""Package the VirtualDJ Online Source as a Windows x64 archive."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from common import (
    PackagingError,
    base_manifest,
    plugin_version,
    shipped_file_problems,
    supported_contracts,
    write_checksum,
    write_manifest,
)

PLATFORM = "windows-x64"
INSTALL_PATH = "%LOCALAPPDATA%\\VirtualDJ\\Plugins64\\OnlineSources"
SYSTEM_DLLS = {
    "advapi32.dll",
    "bcrypt.dll",
    "comctl32.dll",
    "crypt32.dll",
    "gdi32.dll",
    "iphlpapi.dll",
    "kernel32.dll",
    "normaliz.dll",
    "ole32.dll",
    "oleaut32.dll",
    "rpcrt4.dll",
    "secur32.dll",
    "shell32.dll",
    "shlwapi.dll",
    "user32.dll",
    "userenv.dll",
    "wldap32.dll",
    "ws2_32.dll",
}
SYSTEM_DLL_PREFIXES = ("api-ms-win-", "ext-ms-win-")


@dataclass(frozen=True)
class PeInspection:
    machine: str
    exports: str
    dependencies: list[str]


def _dumpbin(option: str, dll: Path) -> str:
    return subprocess.run(
        ["dumpbin", "/nologo", option, str(dll)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def parse_machine(headers: str) -> str:
    match = re.search(r"\bmachine \(([^)]+)\)", headers)
    if match is None:
        raise PackagingError("dumpbin did not report the machine type")
    return match.group(1)


def parse_dependencies(dependents: str) -> list[str]:
    _, _, listing = dependents.partition("Image has the following dependencies:")
    listing, _, _ = listing.partition("Summary")
    return [line.strip() for line in listing.splitlines() if line.strip()]


def inspect_pe(dll: Path) -> PeInspection:
    return PeInspection(
        machine=parse_machine(_dumpbin("/headers", dll)),
        exports=_dumpbin("/exports", dll),
        dependencies=parse_dependencies(_dumpbin("/dependents", dll)),
    )


def _is_system_dll(name: str) -> bool:
    lowered = name.lower()
    return lowered in SYSTEM_DLLS or lowered.startswith(SYSTEM_DLL_PREFIXES)


def validate_dll(
    dll: Path, *, inspect: Callable[[Path], PeInspection] = inspect_pe
) -> list[str]:
    if not dll.is_file():
        return [f"{dll} does not exist"]
    problems = []
    if dll.name != "Crate.dll":
        problems.append(
            "the plugin must be named Crate.dll: VirtualDJ keys tracks by it"
        )
    inspection = inspect(dll)
    if inspection.machine != "x64":
        problems.append(f"the plugin is built for {inspection.machine}, expected x64")
    if "DllGetClassObject" not in inspection.exports:
        problems.append("the plugin does not export DllGetClassObject")
    problems.extend(
        f"Crate.dll depends on {dependency}; link it statically into the plugin"
        for dependency in inspection.dependencies
        if not _is_system_dll(dependency)
    )
    problems.extend(shipped_file_problems(dll))
    return problems


def build_manifest(
    *,
    version: str,
    contracts: list[str],
    tested_virtualdj: list[str],
    archive: str,
    sha256: str,
) -> dict:
    return base_manifest(
        platform=PLATFORM,
        version=version,
        contracts=contracts,
        tested_virtualdj=tested_virtualdj,
        archive=archive,
        sha256=sha256,
        install_path=INSTALL_PATH,
        signing="unsigned",
    )


def package(
    dll: Path,
    output: Path,
    *,
    version_header: Path,
    contract_header: Path,
    tested_virtualdj: list[str],
    inspect: Callable[[Path], PeInspection] = inspect_pe,
) -> Path:
    problems = validate_dll(dll, inspect=inspect)
    if problems:
        raise PackagingError("; ".join(problems))
    version = plugin_version(version_header)
    contracts = supported_contracts(contract_header)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"Crate-VirtualDJ-{PLATFORM}-{version}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(dll, "Crate.dll")
    digest = write_checksum(archive)
    write_manifest(
        output,
        PLATFORM,
        build_manifest(
            version=version,
            contracts=contracts,
            tested_virtualdj=tested_virtualdj,
            archive=archive.name,
            sha256=digest,
        ),
    )
    return archive


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dll", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--version-header", type=Path, required=True)
    parser.add_argument("--contract-header", type=Path, required=True)
    parser.add_argument("--tested-virtualdj", action="append", default=[])
    args = parser.parse_args()
    try:
        archive = package(
            args.dll,
            args.output,
            version_header=args.version_header,
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
