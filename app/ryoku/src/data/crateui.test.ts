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
});
