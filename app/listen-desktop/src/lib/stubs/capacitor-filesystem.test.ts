import { describe, expect, it } from "vitest";

import { Directory, Filesystem } from "./capacitor-filesystem";

describe("Tauri Capacitor Filesystem stub", () => {
  it("exposes the rename contract used by shared offline storage", () => {
    expect(() =>
      Filesystem.rename({
        from: "offline-meta/index.json.next",
        to: "offline-meta/index.json",
        directory: Directory.Data,
        toDirectory: Directory.Data,
      }),
    ).toThrow("not available in the Tauri shell");
  });
});
