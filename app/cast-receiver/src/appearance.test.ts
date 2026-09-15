import { describe, expect, it } from "vitest";

import { resolveReceiverAppearance } from "./appearance";

describe("receiver appearance", () => {
  it.each([
    ["default", "dark", "#16b8d4"],
    ["default", "light", "#087f95"],
    ["crate-red", "dark", "#ff4059"],
    ["crate-red", "light", "#d71936"],
  ] as const)("maps %s in %s mode", (skinId, resolvedMode, accent) => {
    expect(
      resolveReceiverAppearance({
        contractVersion: 1,
        skinId,
        preferredMode: resolvedMode,
        resolvedMode,
        reducedMotion: false,
      }),
    ).toMatchObject({ skinId, mode: resolvedMode, accent });
  });

  it("falls back to the default skin and preserves reduced motion", () => {
    expect(
      resolveReceiverAppearance({
        contractVersion: 1,
        skinId: "untrusted-skin",
        preferredMode: "system",
        resolvedMode: "dark",
        reducedMotion: true,
        artworkPalette: ["url(javascript:alert(1))"],
      }),
    ).toMatchObject({
      skinId: "default",
      mode: "dark",
      reducedMotion: true,
    });
  });
});
