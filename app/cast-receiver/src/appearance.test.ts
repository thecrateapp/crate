import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECEIVER_APPEARANCE,
  resolveReceiverAppearance,
} from "./appearance";

const CRATE_APPEARANCE = {
  skinId: "default",
  mode: "dark",
  accent: "#67e8f9",
  cssVariables: {
    "--receiver-accent": "#67e8f9",
    "--receiver-background": "#0a0a0f",
    "--receiver-foreground": "#f1f5f9",
    "--receiver-muted": "#999ca0",
    "--receiver-panel": "#0d0e14",
  },
};

describe("receiver Crate identity", () => {
  it.each([
    ["default", "dark"],
    ["default", "light"],
    ["crate-red", "dark"],
    ["crate-red", "light"],
    ["crateRed", "light"],
    ["untrusted-skin", "dark"],
  ] as const)("normalizes legacy %s in %s mode", (skinId, resolvedMode) => {
    expect(
      resolveReceiverAppearance({
        contractVersion: 1,
        skinId,
        preferredMode: resolvedMode,
        resolvedMode,
        reducedMotion: false,
      }),
    ).toEqual({ ...CRATE_APPEARANCE, reducedMotion: false });
  });

  it("keeps the v1 default shape with fixed dark values", () => {
    expect(DEFAULT_RECEIVER_APPEARANCE).toEqual({
      contractVersion: 1,
      skinId: "default",
      preferredMode: "dark",
      resolvedMode: "dark",
      reducedMotion: false,
    });
  });

  it("preserves reduced motion without using received colors as chrome", () => {
    expect(
      resolveReceiverAppearance({
        contractVersion: 1,
        skinId: "untrusted-skin",
        preferredMode: "system",
        resolvedMode: "light",
        reducedMotion: true,
        artworkPalette: ["url(javascript:alert(1))", "#ff0000"],
      }),
    ).toEqual({ ...CRATE_APPEARANCE, reducedMotion: true });
  });
});
