import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { downloads, VDJ_PLUGIN_VERSION, vdjPluginDownloads } from "./downloads";
import { repoFile } from "./source-drift";

const base = "https://github.com/thecrateapp/crate/releases/latest/download/";

describe("downloads", () => {
  it("links every desktop and Android build to the unversioned latest alias", () => {
    expect(downloads.map((d) => d.url)).toEqual([
      `${base}Crate-macos-arm64.app.zip`,
      `${base}Crate-macos-intel.app.zip`,
      `${base}crate-windows.exe`,
      `${base}crate-windows.msi`,
      `${base}crate-linux.AppImage`,
      `${base}crate-linux.deb`,
      `${base}crate-linux.rpm`,
      `${base}crate.apk`,
    ]);
  });

  it("groups builds by platform", () => {
    expect(new Set(downloads.map((d) => d.platform))).toEqual(
      new Set(["macOS", "Windows", "Linux", "Android"]),
    );
  });
});

const pluginCmake = repoFile("tools/vdj-plugin/CMakeLists.txt");
const pluginProject = existsSync(pluginCmake)
  ? readFileSync(pluginCmake, "utf8")
  : undefined;

describe("VirtualDJ plugin downloads", () => {
  it("links each package to the plugin release, which is never the latest Crate release", () => {
    const release = `https://github.com/thecrateapp/crate/releases/download/crate-vdj-v${VDJ_PLUGIN_VERSION}/`;
    expect(vdjPluginDownloads.map((d) => d.url)).toEqual([
      `${release}Crate-VirtualDJ-macos-arm64-${VDJ_PLUGIN_VERSION}.zip`,
      `${release}Crate-VirtualDJ-macos-x86_64-${VDJ_PLUGIN_VERSION}.zip`,
      `${release}Crate-VirtualDJ-windows-x64-${VDJ_PLUGIN_VERSION}.zip`,
    ]);
  });

  it("marks only the Apple silicon package as tested in VirtualDJ", () => {
    expect(
      vdjPluginDownloads.filter((d) => d.tested).map((d) => d.label),
    ).toEqual(["Apple silicon"]);
  });

  it.skipIf(!pluginProject)("offers the version the plugin builds", () => {
    const version = pluginProject!.match(
      /project\(CrateVirtualDJPlugin VERSION ([\d.]+)/,
    )?.[1];
    expect(version).toBe(VDJ_PLUGIN_VERSION);
  });
});
