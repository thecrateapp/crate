from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from common import PackagingError, plugin_version
from package_windows import (
    PeInspection,
    build_manifest,
    package,
    parse_dependencies,
    parse_machine,
    validate_dll,
)

HEADERS = """
FILE HEADER VALUES
            8664 machine (x64)
               7 number of sections
"""

DEPENDENTS = """
Dump of file Crate.dll

File Type: DLL

  Image has the following dependencies:

    KERNEL32.dll
    USER32.dll
    SHELL32.dll
    ADVAPI32.dll
    WS2_32.dll
    CRYPT32.dll
    bcrypt.dll

  Summary

        1000 .data
"""


def _dll(root: Path, *, name: str = "Crate.dll", content: bytes = b"MZ") -> Path:
    root.mkdir(parents=True, exist_ok=True)
    dll = root / name
    dll.write_bytes(content)
    return dll


def _inspect(
    *,
    machine: str = "x64",
    exports: str = "1    0 00012340 DllGetClassObject",
    dependencies: list[str] | None = None,
):
    inspection = PeInspection(
        machine=machine,
        exports=exports,
        dependencies=parse_dependencies(DEPENDENTS)
        if dependencies is None
        else dependencies,
    )
    return lambda _dll: inspection


def _version_header(root: Path, version: str = "1.2.3") -> Path:
    header = root / "version.hpp"
    header.write_text(
        f'inline constexpr std::string_view kPluginVersion = "{version}";\n'
    )
    return header


def test_dumpbin_output_is_parsed() -> None:
    assert parse_machine(HEADERS) == "x64"
    assert parse_dependencies(DEPENDENTS) == [
        "KERNEL32.dll",
        "USER32.dll",
        "SHELL32.dll",
        "ADVAPI32.dll",
        "WS2_32.dll",
        "CRYPT32.dll",
        "bcrypt.dll",
    ]


def test_a_valid_dll_has_no_problems(tmp_path: Path) -> None:
    assert validate_dll(_dll(tmp_path), inspect=_inspect()) == []


def test_dll_problems_are_reported(tmp_path: Path) -> None:
    dll = _dll(tmp_path, name="Plugin.dll", content=b"MZ crv_" + b"x" * 43)

    problems = validate_dll(dll, inspect=_inspect(machine="x86", exports=""))

    assert any("named Crate.dll" in problem for problem in problems)
    assert any("x64" in problem for problem in problems)
    assert any("DllGetClassObject" in problem for problem in problems)
    assert any("access token" in problem for problem in problems)


@pytest.mark.parametrize(
    "dependency", ["libcurl.dll", "sqlite3.dll", "zlib1.dll", "VCRUNTIME140.dll"]
)
def test_dlls_that_virtualdj_cannot_find_are_rejected(
    tmp_path: Path, dependency: str
) -> None:
    dependencies = [*parse_dependencies(DEPENDENTS), dependency]

    problems = validate_dll(_dll(tmp_path), inspect=_inspect(dependencies=dependencies))

    assert problems == [
        f"Crate.dll depends on {dependency}; link it statically into the plugin"
    ]


def test_system_api_sets_are_allowed(tmp_path: Path) -> None:
    dependencies = ["api-ms-win-crt-runtime-l1-1-0.dll", "KERNEL32.dll"]

    assert (
        validate_dll(_dll(tmp_path), inspect=_inspect(dependencies=dependencies)) == []
    )


def test_the_plugin_version_comes_from_the_generated_header(tmp_path: Path) -> None:
    assert plugin_version(_version_header(tmp_path, "2.0.1")) == "2.0.1"


def test_the_manifest_states_requirements() -> None:
    manifest = build_manifest(
        version="1.2.3",
        contracts=["2026-08"],
        tested_virtualdj=[],
        archive="Crate-VirtualDJ-windows-x64-1.2.3.zip",
        sha256="abc",
    )

    assert manifest["plugin"] == "Crate"
    assert manifest["platform"] == "windows-x64"
    assert manifest["requires"] == "VirtualDJ Pro"
    assert manifest["virtualdj_tested"] == []
    assert manifest["install_path"].endswith("Plugins64\\OnlineSources")
    assert manifest["signing"] == "unsigned"


def test_package_writes_the_archive_checksum_and_manifest(tmp_path: Path) -> None:
    dll = _dll(tmp_path / "build")
    contract_header = tmp_path / "contract_negotiator.hpp"
    contract_header.write_text('supported_contract_versions = {"2026-08"};\n')

    result = package(
        dll,
        tmp_path / "dist",
        version_header=_version_header(tmp_path),
        contract_header=contract_header,
        tested_virtualdj=[],
        inspect=_inspect(),
    )

    assert result.name == "Crate-VirtualDJ-windows-x64-1.2.3.zip"
    with zipfile.ZipFile(result) as archive:
        assert archive.namelist() == ["Crate.dll"]
    checksum = (tmp_path / "dist" / (result.name + ".sha256")).read_text().split()[0]
    manifest = json.loads((tmp_path / "dist" / "manifest-windows-x64.json").read_text())
    assert manifest["sha256"] == checksum
    assert manifest["archive"] == result.name
    assert manifest["crate_contracts"] == ["2026-08"]


def test_an_invalid_dll_is_never_packaged(tmp_path: Path) -> None:
    dll = _dll(tmp_path / "build")

    with pytest.raises(PackagingError):
        package(
            dll,
            tmp_path / "dist",
            version_header=_version_header(tmp_path),
            contract_header=tmp_path / "missing.hpp",
            tested_virtualdj=[],
            inspect=_inspect(dependencies=["libcurl.dll"]),
        )
    assert not (tmp_path / "dist").exists()
