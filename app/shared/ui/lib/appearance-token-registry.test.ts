import { describe, expect, it } from "vitest";

import type {
  AppearanceEffectiveValues,
  PresetId,
  ResolvedColorMode,
} from "./appearance-types";
import {
  APPEARANCE_OPTION_VALUES,
  APPEARANCE_PRESET_REGISTRY,
  APPEARANCE_TOKEN_REGISTRY,
  APPEARANCE_VARIABLE_ALLOWLIST,
  resolveAppearanceVariables,
} from "./appearance-token-registry";

const MODES: ResolvedColorMode[] = ["dark", "light"];
const PRESETS: PresetId[] = ["default", "crateRed"];

describe("appearance token registry", () => {
  it("is the typed authority for presets and override options", () => {
    expect(Object.keys(APPEARANCE_PRESET_REGISTRY)).toEqual(PRESETS);
    expect(APPEARANCE_OPTION_VALUES).toEqual({
      accent: ["cyan", "red", "violet"],
      surfaceTone: ["neutral", "warm", "tinted"],
      material: ["solid", "glass"],
      radius: ["subtle", "rounded"],
      typography: ["brand", "system"],
      effects: ["off", "subtle", "expressive"],
      mode: ["dark", "light", "system"],
      density: ["comfortable", "compact"],
      motion: ["system", "reduced"],
    });
  });

  it("describes every runtime variable with ownership and defaults", () => {
    expect(APPEARANCE_VARIABLE_ALLOWLIST).toEqual(
      Object.keys(APPEARANCE_TOKEN_REGISTRY),
    );

    Object.values(APPEARANCE_TOKEN_REGISTRY).forEach((token) => {
      expect(token.name).toMatch(/^--/);
      expect(["color", "length", "font", "shadow", "gradient"]).toContain(
        token.type,
      );
      expect(typeof token.overrideable).toBe("boolean");
      expect(token.owner).toBe("design-system");
      expect(token.consumers.length).toBeGreaterThan(0);
      PRESETS.forEach((preset) => {
        MODES.forEach((mode) => {
          expect(token.defaults[preset][mode]).toBeTruthy();
        });
      });
    });
  });

  it("resolves every declared variable for every preset and mode", () => {
    PRESETS.forEach((preset) => {
      MODES.forEach((mode) => {
        const effective: AppearanceEffectiveValues = {
          ...APPEARANCE_PRESET_REGISTRY[preset].defaults,
        };
        const variables = resolveAppearanceVariables({
          mode,
          preset,
          preferences: {
            version: 2,
            mode,
            preset,
            overrides: {},
            presentation: { density: "comfortable" },
            accessibility: { motion: "system" },
          },
          effective,
          density: "comfortable",
          motion: "system",
          reducedMotion: false,
        });

        expect(Object.keys(variables)).toEqual(APPEARANCE_VARIABLE_ALLOWLIST);
      });
    });
  });
});
