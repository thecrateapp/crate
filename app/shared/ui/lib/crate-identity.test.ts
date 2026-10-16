import { describe, expect, it } from "vitest";

import { applyCrateIdentity } from "./crate-identity";

describe("fixed Crate identity", () => {
  it("clears inventoried visual runtime overrides without touching functional preferences or artwork", () => {
    const root = document.createElement("div");
    for (const [name, value] of Object.entries({
      crateMode: "light",
      crateModePreference: "system",
      crateSkin: "crateRed",
      crateSurfaceTone: "warm",
      surface: "glass",
      crateDensity: "compact",
      crateMotion: "reduced",
      crateEffects: "off",
      crateApp: "listen",
    }))
      root.dataset[name] = value;
    root.style.setProperty("--accent-action", "red", "important");
    root.style.setProperty("--font-brand", "system-ui");
    root.style.setProperty("--crate-token-surface-card-glass", "pink");
    root.style.setProperty("--artwork-palette-primary", "#123456");
    root.style.setProperty("--session-progress", "0.5");
    applyCrateIdentity(root);
    expect({ ...root.dataset }).toEqual({
      crateIdentity: "v3",
      crateDensity: "compact",
      crateMotion: "reduced",
      crateEffects: "off",
      crateApp: "listen",
    });
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--accent-action")).toBe("");
    expect(root.style.getPropertyValue("--font-brand")).toBe("");
    expect(
      root.style.getPropertyValue("--crate-token-surface-card-glass"),
    ).toBe("");
    expect(root.style.getPropertyValue("--artwork-palette-primary")).toBe(
      "#123456",
    );
    expect(root.style.getPropertyValue("--session-progress")).toBe("0.5");
    const applied = root.outerHTML;
    applyCrateIdentity(root);
    expect(root.outerHTML).toBe(applied);
  });

  it("uses the document root when no element is passed", () => {
    applyCrateIdentity();
    expect(document.documentElement.dataset.crateIdentity).toBe("v3");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
