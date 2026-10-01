import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseDesktopVersion } from "./desktop-version.mjs";

export function assertArtifactVersion(actual, expected, label) {
  const expectedVersion = parseDesktopVersion(expected).version;
  const normalized = actual.trim().replace(/^v/, "");
  if (normalized !== expectedVersion && normalized !== `${expectedVersion}.0`) {
    throw new Error(`${label} reports ${actual}, expected ${expectedVersion}`);
  }
}

export function findArtifacts(root, extension) {
  if (!fs.existsSync(root)) return [];
  const artifacts = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...findArtifacts(entryPath, extension));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      artifacts.push(entryPath);
    }
  }
  return artifacts;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function readMacBundleVersion(bundlePath, key) {
  return run("plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    path.join(bundlePath, "Contents", "Info.plist"),
  ]);
}

function verifyMacBundles(bundleRoot, expected) {
  const apps = [];
  for (const entry of fs.readdirSync(bundleRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      apps.push(path.join(bundleRoot, entry.name));
    }
  }
  if (apps.length === 0)
    throw new Error(`No .app bundle found in ${bundleRoot}`);
  for (const app of apps) {
    for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
      assertArtifactVersion(readMacBundleVersion(app, key), expected, key);
    }
  }
  return apps.length;
}

function powershell(script, artifactPath) {
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, CRATE_VERIFY_ARTIFACT: artifactPath },
    },
  );
}

function readMsiVersion(artifactPath) {
  return powershell(
    [
      "$ErrorActionPreference = 'Stop'",
      "$installer = New-Object -ComObject WindowsInstaller.Installer",
      "$database = $installer.OpenDatabase($env:CRATE_VERIFY_ARTIFACT, 0)",
      "$view = $database.OpenView(\"SELECT Value FROM Property WHERE Property='ProductVersion'\")",
      "$view.Execute()",
      "$record = $view.Fetch()",
      "if ($null -eq $record) { throw 'MSI ProductVersion is missing' }",
      "Write-Output $record.StringData(1)",
    ].join("; "),
    artifactPath,
  );
}

function readNsisVersion(artifactPath) {
  return powershell(
    [
      "$ErrorActionPreference = 'Stop'",
      "$version = (Get-Item -LiteralPath $env:CRATE_VERIFY_ARTIFACT).VersionInfo.ProductVersion",
      "if ([string]::IsNullOrWhiteSpace($version)) { throw 'NSIS ProductVersion is missing' }",
      "Write-Output $version",
    ].join("; "),
    artifactPath,
  );
}

function verifyWindowsBundles(bundleRoot, expected, msiCompatible) {
  const nsisInstallers = findArtifacts(path.join(bundleRoot, "nsis"), ".exe");
  if (nsisInstallers.length === 0) {
    throw new Error(`No NSIS installer found under ${bundleRoot}`);
  }
  for (const installer of nsisInstallers) {
    assertArtifactVersion(readNsisVersion(installer), expected, installer);
  }

  const msiInstallers = findArtifacts(path.join(bundleRoot, "msi"), ".msi");
  if (msiCompatible && msiInstallers.length === 0) {
    throw new Error(`No MSI installer found under ${bundleRoot}`);
  }
  if (!msiCompatible && msiInstallers.length > 0) {
    throw new Error("An MSI was produced for an incompatible SemVer version");
  }
  for (const installer of msiInstallers) {
    assertArtifactVersion(readMsiVersion(installer), expected, installer);
  }
  return nsisInstallers.length + msiInstallers.length;
}

function verifyLinuxBundles(bundleRoot, expected) {
  const debs = findArtifacts(path.join(bundleRoot, "deb"), ".deb");
  const rpms = findArtifacts(path.join(bundleRoot, "rpm"), ".rpm");
  const appImages = findArtifacts(
    path.join(bundleRoot, "appimage"),
    ".appimage",
  );
  if (!debs.length || !rpms.length || !appImages.length) {
    throw new Error("Expected AppImage, DEB, and RPM artifacts");
  }
  for (const artifact of debs) {
    assertArtifactVersion(
      run("dpkg-deb", ["--field", artifact, "Version"]),
      expected,
      artifact,
    );
  }
  for (const artifact of rpms) {
    assertArtifactVersion(
      run("rpm", ["-qp", "--queryformat", "%{VERSION}", artifact]),
      expected,
      artifact,
    );
  }
  for (const artifact of appImages) verifyAppImage(artifact, expected);
  return debs.length + rpms.length + appImages.length;
}

export function assertAppImagePayload(root) {
  const executable = path.join(root, "usr/bin/crate-desktop");
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error(`AppImage payload is missing executable: ${executable}`);
  }
  if (process.platform !== "win32" && !(fs.statSync(executable).mode & 0o111)) {
    throw new Error(
      `AppImage payload executable is not runnable: ${executable}`,
    );
  }

  for (const library of [
    "libwebkit2gtk-4.1.so.0",
    "libjavascriptcoregtk-4.1.so.0",
  ]) {
    const bundledLibrary = path.join(root, "usr/lib", library);
    if (!fs.existsSync(bundledLibrary)) {
      throw new Error(
        `AppImage payload is missing bundled library: ${library}`,
      );
    }
  }

  const bundledProcesses = findArtifacts(path.join(root, "usr/lib"), "");
  for (const processName of ["WebKitWebProcess", "WebKitNetworkProcess"]) {
    if (!bundledProcesses.some((file) => path.basename(file) === processName)) {
      throw new Error(
        `AppImage payload is missing bundled process: ${processName}`,
      );
    }
  }

  const desktopEntries = findArtifacts(
    path.join(root, "usr/share/applications"),
    ".desktop",
  );
  const hasLaunchableEntry = desktopEntries.some((desktopEntry) =>
    /^Exec=crate-desktop(?:\s|$)/m.test(fs.readFileSync(desktopEntry, "utf8")),
  );
  if (!hasLaunchableEntry) {
    throw new Error("AppImage payload has no launchable desktop entry");
  }
}

export function verifyAppImage(artifact, expected) {
  if (!path.basename(artifact).includes(expected)) {
    throw new Error(
      `AppImage filename does not include ${expected}: ${artifact}`,
    );
  }

  const extractionDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "crate-appimage-verify-"),
  );
  try {
    execFileSync(path.resolve(artifact), ["--appimage-extract"], {
      cwd: extractionDirectory,
      stdio: "ignore",
      timeout: 120_000,
    });
    assertAppImagePayload(path.join(extractionDirectory, "squashfs-root"));
  } finally {
    fs.rmSync(extractionDirectory, { recursive: true, force: true });
  }
}

export function verifyDesktopArtifacts({
  platform,
  bundleRoot,
  version,
  msiCompatible,
}) {
  if (platform === "darwin") {
    return verifyMacBundles(bundleRoot, version);
  }
  if (platform === "win32") {
    return verifyWindowsBundles(bundleRoot, version, msiCompatible);
  }
  if (platform === "linux") {
    return verifyLinuxBundles(bundleRoot, version);
  }
  throw new Error(`Unsupported desktop artifact platform: ${platform}`);
}

function runCli() {
  const scriptPath = fileURLToPath(import.meta.url);
  if (
    pathToFileURL(path.resolve(process.argv[1] ?? "")).href !==
    pathToFileURL(scriptPath).href
  ) {
    return;
  }

  const [
    bundleRoot,
    version = process.env.CRATE_DESKTOP_VERSION,
    msiCompatible,
  ] = process.argv.slice(2);
  if (!bundleRoot || !version) {
    throw new Error(
      "Usage: verify-desktop-artifact-version.mjs <bundle-root> [version] [msi-compatible]",
    );
  }
  const count = verifyDesktopArtifacts({
    platform: process.platform,
    bundleRoot,
    version,
    msiCompatible:
      msiCompatible === undefined
        ? process.env.CRATE_DESKTOP_MSI_COMPATIBLE === "true"
        : msiCompatible === "true",
  });
  process.stdout.write(`Verified ${count} desktop artifacts for ${version}\n`);
}

runCli();
