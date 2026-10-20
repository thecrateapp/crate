import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("native upload file-drop transport", () => {
  it.each(["tauri.conf.json", "tauri.linux.conf.json"])(
    "%s allows HTML file drops to reach Listen's upload staging area",
    (filename) => {
      const config = JSON.parse(
        readFileSync(
          new URL(`../../src-tauri/${filename}`, import.meta.url),
          "utf8",
        ),
      );
      const window = config.app.windows.find(
        (entry: { label: string }) => entry.label === "main",
      );
      // Tauri's default native interception suppresses HTML5 drops on Windows.
      // Linux replaces the whole windows array, so its override retains the same contract.
      expect(window.dragDropEnabled).toBe(false);
    },
  );
});
