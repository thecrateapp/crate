import { describe, expect, it } from "vitest";

import { contrastRatio, meetsWcagAa, parseHexColor } from "./color-contrast";
import { SKIN_REGISTRY } from "./theme-skin";

describe("color contrast", () => {
  it("calculates WCAG contrast ratios for hex colors", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("rejects unsupported colors instead of reporting false confidence", () => {
    expect(parseHexColor("rgba(0, 0, 0, 0.5)")).toBeNull();
    expect(contrastRatio("not-a-color", "#000000")).toBeNull();
  });

  it("keeps every explicit skin text pairing AA-compliant", () => {
    Object.values(SKIN_REGISTRY).forEach(({ variables }) => {
      const foreground = variables["--color-foreground"];
      const muted = variables["--color-muted-foreground"];
      const panel = variables["--surface-panel"];
      const app = variables["--surface-app"];
      const primary = variables["--color-primary"];
      const primaryForeground = variables["--color-primary-foreground"];

      if (foreground && panel) {
        expect(meetsWcagAa(foreground, panel)).toBe(true);
      }
      if (muted && app) {
        expect(meetsWcagAa(muted, app)).toBe(true);
      }
      if (primary && primaryForeground) {
        expect(meetsWcagAa(primaryForeground, primary)).toBe(true);
      }
    });
  });

  it("keeps the high-contrast Listen theme on the AA-safe base pairing", () => {
    expect(meetsWcagAa("#ffffff", "#000000")).toBe(true);
    expect(meetsWcagAa("#67e8f9", "#000000")).toBe(true);
  });
});
