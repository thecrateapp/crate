import { describe, expect, it } from "vitest";

import {
  extractTranslationMarker,
  stripTranslationMarker,
  withTranslationMarker,
} from "@/i18n/translation-mode/markers";

describe("translation markers", () => {
  it("embeds and extracts a key without visible characters", () => {
    const value = withTranslationMarker("Reproducir", "player.play");

    expect(value).toContain("Reproducir");
    expect(extractTranslationMarker(value)?.key).toBe("player.play");
    expect(stripTranslationMarker(value)).toBe("Reproducir");
  });

  it("embeds the active locale when provided", () => {
    const value = withTranslationMarker("Reproducir", "player.play", "es");

    expect(extractTranslationMarker(value)).toEqual({
      key: "player.play",
      locale: "es",
    });
  });

  it("returns null when a value has no marker", () => {
    expect(extractTranslationMarker("Reproducir")).toBeNull();
  });
});
