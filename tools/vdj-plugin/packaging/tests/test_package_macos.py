from __future__ import annotations

import json
import plistlib
import zipfile
from pathlib import Path

import pytest

from common import PackagingError, supported_contracts
from package_macos import (
    MachOInspection,
    build_manifest,
    package,
    parse_minimum_macos,
    validate_bundle,
)

SYSTEM_LIBRARIES = [
    "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit",
    "/usr/lib/libcurl.4.dylib",
    "/usr/lib/libsqlite3.dylib",
]


def _bundle(
    root: Path, *, name: str = "Crate", extra: dict[str, bytes] | None = None
) -> Path:
    bundle = root / "Crate.bundle"
    (bundle / "Contents" / "MacOS").mkdir(parents=True)
    (bundle / "Contents" / "MacOS" / name).write_bytes(b"binary")
    with (bundle / "Contents" / "Info.plist").open("wb") as output:
        plistlib.dump(
            {
                "CFBundleName": name,
                "CFBundleExecutable": name,
                "CFBundleShortVersionString": "1.2.3",
            },
            output,
        )
    for relative, content in (extra or {}).items():
        path = bundle / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return bundle


def _inspect(
    *,
    exports: str = "T _DllGetClassObject",
    archs: tuple[str, ...] = ("arm64",),
    libraries: list[str] | None = None,
    minimum_macos: str = "12.0",
):
    inspection = MachOInspection(
        exports=exports,
        archs=set(archs),
        libraries=SYSTEM_LIBRARIES if libraries is None else libraries,
        minimum_macos=minimum_macos,
    )
    return lambda _binary: inspection


def test_a_valid_bundle_has_no_problems(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)

    assert validate_bundle(bundle, arch="arm64", inspect=_inspect()) == []


def test_bundle_problems_are_reported(tmp_path: Path) -> None:
    bundle = _bundle(
        tmp_path,
        name="CrateProbe",
        extra={
            "Contents/Resources/vdjOnlineSource.h": b"sdk",
            "Contents/Resources/token.txt": b"crv_" + b"x" * 43,
        },
    )

    problems = validate_bundle(bundle, arch="arm64", inspect=_inspect(exports=""))

    assert any("named Crate" in problem for problem in problems)
    assert any("DllGetClassObject" in problem for problem in problems)
    assert any("vdjOnlineSource.h" in problem for problem in problems)
    assert any("access token" in problem for problem in problems)


def test_a_binary_for_another_architecture_is_rejected(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)

    problems = validate_bundle(bundle, arch="x86_64", inspect=_inspect())

    assert problems == ["the executable is built for arm64, expected x86_64"]


def test_libraries_outside_the_system_are_rejected(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)
    homebrew = "/opt/homebrew/opt/curl/lib/libcurl.4.dylib"

    problems = validate_bundle(
        bundle,
        arch="arm64",
        inspect=_inspect(libraries=[*SYSTEM_LIBRARIES, homebrew]),
    )

    assert problems == [f"the executable links {homebrew}, which users do not have"]


def test_the_minimum_macos_comes_from_the_build_version() -> None:
    load_commands = """
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 12.0
      sdk 26.0
"""

    assert parse_minimum_macos(load_commands) == "12.0"


def test_supported_contracts_come_from_the_plugin_source(tmp_path: Path) -> None:
    header = tmp_path / "contract_negotiator.hpp"
    header.write_text(
        'std::vector<std::string> supported_contract_versions = {"2026-08", "2026-09"};\n'
    )

    assert supported_contracts(header) == ["2026-08", "2026-09"]


@pytest.mark.parametrize(
    ("arch", "platform", "install_folder"),
    [
        ("arm64", "macos-arm64", "PluginsMacArm/OnlineSources"),
        ("x86_64", "macos-x86_64", "Plugins64/OnlineSources"),
    ],
)
def test_the_manifest_states_requirements(
    arch: str, platform: str, install_folder: str
) -> None:
    manifest = build_manifest(
        arch=arch,
        version="1.2.3",
        contracts=["2026-08"],
        tested_virtualdj=["8.5.9307"],
        minimum_macos="12.0",
        archive=f"Crate-VirtualDJ-{platform}.zip",
        sha256="abc",
    )

    assert manifest["plugin"] == "Crate"
    assert manifest["version"] == "1.2.3"
    assert manifest["platform"] == platform
    assert manifest["crate_contracts"] == ["2026-08"]
    assert manifest["virtualdj_tested"] == ["8.5.9307"]
    assert manifest["requires"] == "VirtualDJ Pro"
    assert manifest["minimum_macos"] == "12.0"
    assert manifest["install_path"].endswith(install_folder)
    assert manifest["signing"] == "ad-hoc"
    assert manifest["sha256"] == "abc"


@pytest.mark.parametrize("arch", ["arm64", "x86_64"])
def test_package_writes_the_archive_checksum_and_manifest(
    tmp_path: Path, arch: str
) -> None:
    bundle = _bundle(tmp_path / "build")
    header = tmp_path / "contract_negotiator.hpp"
    header.write_text('supported_contract_versions = {"2026-08"};\n')
    signed: list[Path] = []

    result = package(
        bundle,
        tmp_path / "dist",
        arch=arch,
        contract_header=header,
        tested_virtualdj=["8.5.9307"],
        inspect=_inspect(archs=(arch,)),
        sign=signed.append,
    )

    assert result.name == f"Crate-VirtualDJ-macos-{arch}-1.2.3.zip"
    assert len(signed) == 1 and signed[0].name == "Crate.bundle"
    with zipfile.ZipFile(result) as archive:
        assert "Crate.bundle/Contents/MacOS/Crate" in archive.namelist()
    checksum = (tmp_path / "dist" / (result.name + ".sha256")).read_text().split()[0]
    manifest = json.loads(
        (tmp_path / "dist" / f"manifest-macos-{arch}.json").read_text()
    )
    assert manifest["sha256"] == checksum
    assert manifest["archive"] == result.name
    assert manifest["minimum_macos"] == "12.0"


def test_an_invalid_bundle_is_never_packaged(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path / "build", name="CrateProbe")

    with pytest.raises(PackagingError):
        package(
            bundle,
            tmp_path / "dist",
            arch="arm64",
            contract_header=tmp_path / "missing.hpp",
            tested_virtualdj=["8.5.9307"],
            inspect=_inspect(),
            sign=lambda _bundle: None,
        )
    assert not (tmp_path / "dist").exists()
