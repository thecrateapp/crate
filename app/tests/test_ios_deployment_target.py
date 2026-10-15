from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IOS_APP = ROOT / "app/listen/ios/App"
DEPLOYMENT_TARGET = "16.4"


def test_podfile_and_xcode_project_share_the_ios_deployment_target() -> None:
    podfile = (IOS_APP / "Podfile").read_text()
    project = (IOS_APP / "App.xcodeproj/project.pbxproj").read_text()

    platform = re.search(r"^platform :ios, '([\d.]+)'", podfile, re.M)
    assert platform is not None
    assert platform.group(1) == DEPLOYMENT_TARGET
    targets = set(re.findall(r"IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);", project))
    assert targets == {DEPLOYMENT_TARGET}


def test_capacitor_swift_package_follows_the_major_target() -> None:
    package = (IOS_APP / "CapApp-SPM/Package.swift").read_text()

    assert "platforms: [.iOS(.v16)]" in package
