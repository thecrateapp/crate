import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAppImagePayload,
  assertArtifactVersion,
  verifyAppImage,
} from "./verify-desktop-artifact-version.mjs";
import {
  detectLocalDesktopVersion,
  parseDesktopVersion,
  readDesktopVersionSources,
  resolveDesktopVersion,
  windowsBuildRequiresMsi,
  withTauriVersionOverride,
  writeGitHubEnvironment,
} from "./desktop-version.mjs";

test("release tag overrides the package default and strips the v prefix", () => {
  const resolved = resolveDesktopVersion({
    refType: "tag",
    refName: "v2.7.4",
    defaultVersion: "0.1.0",
  });

  assert.equal(resolved.version, "2.7.4");
  assert.equal(resolved.msiCompatible, true);
});

test("CI branch builds use the synchronized package version", () => {
  const resolved = resolveDesktopVersion({
    refType: "branch",
    refName: "feat/tauri-desktop-app",
    defaultVersion: "0.1.0",
  });

  assert.equal(resolved.version, "0.1.0");
});

test("local builds use the Git describe version of their checkout", () => {
  const resolved = resolveDesktopVersion({
    localVersion: "v2.4.1-29-g00c988e9-dirty",
    defaultVersion: "0.1.0",
  });

  assert.equal(resolved.version, "2.4.1-29-g00c988e9-dirty");
  assert.equal(resolved.msiCompatible, false);
});

test("local version detection includes the nearest tag, distance, and dirty state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crate-version-git-"));
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  git("init", "--quiet");
  git("config", "user.name", "Crate Version Test");
  git("config", "user.email", "version-test@example.invalid");
  fs.writeFileSync(path.join(root, "README.md"), "base\n");
  git("add", "README.md");
  git("commit", "--quiet", "-m", "base");
  git("tag", "v2.4.1");
  fs.appendFileSync(path.join(root, "README.md"), "next commit\n");
  git("add", "README.md");
  git("commit", "--quiet", "-m", "next");
  fs.appendFileSync(path.join(root, "README.md"), "uncommitted\n");

  assert.match(
    detectLocalDesktopVersion(root),
    /^v2\.4\.1-1-g[0-9a-f]+-dirty$/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("explicit release version takes precedence over the GitHub ref", () => {
  const resolved = resolveDesktopVersion({
    override: "v3.1.0-rc.2",
    refType: "tag",
    refName: "v3.1.0",
    defaultVersion: "0.1.0",
  });

  assert.equal(resolved.version, "3.1.0-rc.2");
  assert.equal(resolved.msiCompatible, false);
});

test("prereleases and values outside MSI numeric limits are marked incompatible", () => {
  assert.equal(parseDesktopVersion("2.4.0-beta.3").msiCompatible, false);
  assert.equal(parseDesktopVersion("256.0.0").msiCompatible, false);
  assert.equal(parseDesktopVersion("1.256.0").msiCompatible, false);
  assert.equal(parseDesktopVersion("1.2.65536").msiCompatible, false);
});

test("invalid SemVer tags and leading zero prerelease numbers are rejected", () => {
  assert.throws(
    () =>
      resolveDesktopVersion({
        refType: "tag",
        refName: "v2.7",
        defaultVersion: "0.1.0",
      }),
    /Invalid desktop SemVer/,
  );
  assert.throws(
    () => parseDesktopVersion("1.2.3-rc.01"),
    /Invalid desktop SemVer/,
  );
});

test("frontend, Cargo, and Tauri default versions must agree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crate-version-test-"));
  fs.mkdirSync(path.join(root, "app/listen-desktop/src-tauri"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "app/listen-desktop/package.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  fs.writeFileSync(
    path.join(root, "app/listen-desktop/src-tauri/tauri.conf.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  fs.writeFileSync(
    path.join(root, "app/listen-desktop/src-tauri/Cargo.toml"),
    '[package]\nname = "crate-desktop"\nversion = "0.1.0"\n\n[dependencies]\n',
  );

  assert.deepEqual(readDesktopVersionSources(root), {
    frontend: "0.1.0",
    tauri: "0.1.0",
    cargo: "0.1.0",
  });
  fs.writeFileSync(
    path.join(root, "app/listen-desktop/package.json"),
    JSON.stringify({ version: "0.2.0" }),
  );
  assert.throws(() => readDesktopVersionSources(root), /versions differ/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Tauri bundle metadata matches supported desktop runtime minimums", () => {
  const configPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(config.bundle.macOS.minimumSystemVersion, "11.0");
  assert.equal(config.bundle.windows.minimumWebview2Version, "111.0.1661.34");
  assert.deepEqual(config.bundle.linux.deb.depends, [
    "libwebkit2gtk-4.1-0 (>= 2.40.0)",
  ]);
  assert.deepEqual(config.bundle.linux.rpm.depends, [
    "webkit2gtk4.1 >= 2.40.0",
  ]);
});

test("GitHub environment records normalized app and MSI compatibility metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crate-version-env-"));
  const envFile = path.join(root, "github-env");
  writeGitHubEnvironment("v2.4.0-rc.1", envFile);

  assert.equal(
    fs.readFileSync(envFile, "utf8"),
    "CRATE_DESKTOP_VERSION=2.4.0-rc.1\nCRATE_DESKTOP_MSI_COMPATIBLE=false\n",
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("Tauri build and dev commands receive the resolved version", () => {
  assert.deepEqual(
    withTauriVersionOverride(["build", "--bundles", "app"], "2.7.4"),
    ["build", "--bundles", "app", "--config", '{"version":"2.7.4"}'],
  );
  assert.deepEqual(withTauriVersionOverride(["dev"], "2.7.4"), [
    "dev",
    "--config",
    '{"version":"2.7.4"}',
  ]);
  assert.deepEqual(withTauriVersionOverride(["info"], "2.7.4"), ["info"]);
});

test("Windows MSI selection works for spaced and inline Tauri flags", () => {
  assert.equal(
    windowsBuildRequiresMsi(
      ["build", "--target", "x86_64-pc-windows-msvc", "--bundles", "msi"],
      "darwin",
    ),
    true,
  );
  assert.equal(
    windowsBuildRequiresMsi(
      ["build", "--target=x86_64-pc-windows-msvc", "--bundles=nsis"],
      "darwin",
    ),
    false,
  );
  assert.equal(
    windowsBuildRequiresMsi(["build", "--bundles", "msi"], "win32"),
    true,
  );
});

test("artifact version checks accept canonical SemVer and Windows build suffix", () => {
  assert.doesNotThrow(() => assertArtifactVersion("2.7.4", "v2.7.4", "app"));
  assert.doesNotThrow(() =>
    assertArtifactVersion("2.7.4.0", "2.7.4", "NSIS installer"),
  );
  assert.throws(
    () => assertArtifactVersion("2.7.3", "2.7.4", "DEB package"),
    /expected 2\.7\.4/,
  );
});

test("AppImage payload contains its executable and a launchable desktop entry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crate-appimage-test-"));
  const binary = path.join(root, "usr/bin/crate-desktop");
  const desktop = path.join(root, "usr/share/applications/Crate.desktop");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  fs.writeFileSync(binary, "test binary");
  fs.chmodSync(binary, 0o755);
  fs.writeFileSync(
    desktop,
    "[Desktop Entry]\nType=Application\nName=Crate\nExec=crate-desktop %u\n",
  );

  try {
    assert.doesNotThrow(() => assertAppImagePayload(root));
    fs.rmSync(binary);
    assert.throws(() => assertAppImagePayload(root), /missing executable/);

    fs.writeFileSync(binary, "test binary");
    fs.chmodSync(binary, 0o755);
    fs.writeFileSync(desktop, "[Desktop Entry]\nName=Crate\n");
    assert.throws(
      () => assertAppImagePayload(root),
      /launchable desktop entry/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "AppImage extraction resolves relative bundle paths before changing directories",
  { skip: process.platform === "win32" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "crate-appimage-cli-"));
    const artifact = path.join(root, "Crate_0.1.0_amd64.AppImage");
    fs.writeFileSync(
      artifact,
      [
        "#!/bin/sh",
        'mkdir -p "$PWD/squashfs-root/usr/bin" "$PWD/squashfs-root/usr/share/applications"',
        'printf payload > "$PWD/squashfs-root/usr/bin/crate-desktop"',
        'chmod +x "$PWD/squashfs-root/usr/bin/crate-desktop"',
        'printf "[Desktop Entry]\\nExec=crate-desktop %%u\\n" > "$PWD/squashfs-root/usr/share/applications/Crate.desktop"',
      ].join("\n"),
    );
    fs.chmodSync(artifact, 0o755);

    const originalDirectory = process.cwd();
    const filesystemRoot = path.parse(originalDirectory).root;
    try {
      process.chdir(filesystemRoot);
      assert.doesNotThrow(() =>
        verifyAppImage(path.relative(filesystemRoot, artifact), "0.1.0"),
      );
    } finally {
      process.chdir(originalDirectory);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
