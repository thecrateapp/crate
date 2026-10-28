import { describe, expect, it } from "vitest";
import { downloads } from "./downloads";

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
