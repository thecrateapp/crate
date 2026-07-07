import { describe, expect, it } from "vitest";

import { hashSourceMessage } from "@/i18n/quality/source-hash";

describe("hashSourceMessage", () => {
  it("changes when source copy changes", () => {
    expect(hashSourceMessage("player.play", "Play")).not.toBe(
      hashSourceMessage("player.play", "Play now"),
    );
  });

  it("changes when the translation key changes", () => {
    expect(hashSourceMessage("player.play", "Play")).not.toBe(
      hashSourceMessage("actions.play", "Play"),
    );
  });

  it("returns a stable sha256-prefixed digest", () => {
    expect(hashSourceMessage("player.play", "Play")).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });
});
