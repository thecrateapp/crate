import { describe, expect, it } from "vitest";
import { CRATE_UI_BLOCKS } from "./crateui";

describe("CRATE_UI_BLOCKS", () => {
  it("shows the five rules in order", () => {
    expect(CRATE_UI_BLOCKS.map((block) => [block.id, block.label])).toEqual([
      ["accent", "One accent"],
      ["hairlines", "Hairlines, not boxes"],
      ["type", "Display and mono"],
      ["glass", "One glass"],
      ["icons", "Icons"],
    ]);
  });

  it("says each rule in one sentence", () => {
    for (const block of CRATE_UI_BLOCKS) {
      expect(block.text).toMatch(/^[^.]+\.$/);
    }
  });

  it("explains the icons' graded fallback and watcher in a second line", () => {
    const icons = CRATE_UI_BLOCKS.find((block) => block.id === "icons");
    expect(icons?.note).toMatch(/^[^.]+\.$/);
    expect(icons?.note).toContain("own icon in Crate's colours");
    expect(icons?.note).toContain("watcher");
    expect(icons?.note).toContain("Papirus");
    expect(
      CRATE_UI_BLOCKS.filter((block) => block.note).map((block) => block.id),
    ).toEqual(["icons"]);
  });
});
