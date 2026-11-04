from __future__ import annotations

import json
import plistlib
import zipfile
from pathlib import Path

import pytest

from package_macos import (
    PackagingError,
    build_manifest,
    package,
    supported_contracts,
    validate_bundle,
)


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


def _exports(symbols: str):
    return lambda _binary: symbols


def test_a_valid_bundle_has_no_problems(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)

    assert validate_bundle(bundle, exports=_exports("T _DllGetClassObject")) == []


def test_bundle_problems_are_reported(tmp_path: Path) -> None:
    bundle = _bundle(
        tmp_path,
        name="CrateProbe",
        extra={
            "Contents/Resources/vdjOnlineSource.h": b"sdk",
            "Contents/Resources/token.txt": b"crv_" + b"x" * 43,
        },
    )

    problems = validate_bundle(bundle, exports=_exports(""))

    assert any("named Crate" in problem for problem in problems)
    assert any("DllGetClassObject" in problem for problem in problems)
    assert any("vdjOnlineSource.h" in problem for problem in problems)
    assert any("access token" in problem for problem in problems)


def test_supported_contracts_come_from_the_plugin_source(tmp_path: Path) -> None:
    header = tmp_path / "contract_negotiator.hpp"
    header.write_text(
        'std::vector<std::string> supported_contract_versions = {"2026-08", "2026-09"};\n'
    )

    assert supported_contracts(header) == ["2026-08", "2026-09"]


def test_the_manifest_states_requirements() -> None:
    manifest = build_manifest(
        version="1.2.3",
        contracts=["2026-08"],
        tested_virtualdj=["8.5.9307"],
        archive="Crate-VirtualDJ-macos-arm64.zip",
        sha256="abc",
    )

    assert manifest["plugin"] == "Crate"
    assert manifest["version"] == "1.2.3"
    assert manifest["platform"] == "macos-arm64"
    assert manifest["crate_contracts"] == ["2026-08"]
    assert manifest["virtualdj_tested"] == ["8.5.9307"]
    assert manifest["requires"] == "VirtualDJ Pro"
    assert manifest["install_path"].endswith("PluginsMacArm/OnlineSources")
    assert manifest["signing"] == "ad-hoc"
    assert manifest["sha256"] == "abc"


def test_package_writes_the_archive_checksum_and_manifest(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path / "build")
    header = tmp_path / "contract_negotiator.hpp"
    header.write_text('supported_contract_versions = {"2026-08"};\n')
    signed: list[Path] = []

    result = package(
        bundle,
        tmp_path / "dist",
        contract_header=header,
        tested_virtualdj=["8.5.9307"],
        exports=_exports("T _DllGetClassObject"),
        sign=signed.append,
    )

    assert result.name == "Crate-VirtualDJ-macos-arm64-1.2.3.zip"
    assert len(signed) == 1 and signed[0].name == "Crate.bundle"
    with zipfile.ZipFile(result) as archive:
        assert "Crate.bundle/Contents/MacOS/Crate" in archive.namelist()
    checksum = (tmp_path / "dist" / (result.name + ".sha256")).read_text().split()[0]
    manifest = json.loads((tmp_path / "dist" / "manifest-macos-arm64.json").read_text())
    assert manifest["sha256"] == checksum
    assert manifest["archive"] == result.name


def test_an_invalid_bundle_is_never_packaged(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path / "build", name="CrateProbe")

    with pytest.raises(PackagingError):
        package(
            bundle,
            tmp_path / "dist",
            contract_header=tmp_path / "missing.hpp",
            tested_virtualdj=["8.5.9307"],
            exports=_exports("T _DllGetClassObject"),
            sign=lambda _bundle: None,
        )
    assert not (tmp_path / "dist").exists()
