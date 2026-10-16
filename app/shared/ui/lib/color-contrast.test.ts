import { describe, expect, it } from "vitest";

import {
  chooseAccessibleForeground,
  contrastRatio,
  contrastRatioComposited,
  meetsWcagAa,
  parseCssColor,
  parseHexColor,
} from "./color-contrast";

describe("color contrast", () => {
  it("chooses the deterministic foreground with the strongest contrast", () => {
    expect(chooseAccessibleForeground("#06b6d4")).toBe("#0a0a0f");
    expect(chooseAccessibleForeground("#0e7490")).toBe("#ffffff");
    expect(chooseAccessibleForeground("not-a-color")).toBeNull();
  });

  it("calculates WCAG contrast ratios for hex colors", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("rejects unsupported colors instead of reporting false confidence", () => {
    expect(parseHexColor("rgba(0, 0, 0, 0.5)")).toBeNull();
    expect(parseCssColor("color-mix(in srgb, white 50%, black)")).toBeNull();
    expect(contrastRatio("not-a-color", "#000000")).toBeNull();
  });

  it("composites alpha colors over an explicit surface", () => {
    expect(parseCssColor("rgba(255, 255, 255, 78%)")).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: 0.78,
    });
    expect(parseCssColor("#ffffffcc")).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: expect.closeTo(0.8, 2),
    });
    expect(meetsWcagAa("#ffffff", "#0a0a0f")).toBe(true);
    expect(
      contrastRatioComposited("rgba(255, 255, 255, 0.78)", "#0a0a0f"),
    ).toBeGreaterThan(4.5);
  });

  it("requires an artwork backdrop instead of guessing through transparency", () => {
    expect(
      contrastRatioComposited("#ffffff", "rgba(10, 10, 15, 0.68)"),
    ).toBeNull();
    expect(
      contrastRatioComposited("#ffffff", "rgba(10, 10, 15, 0.68)", "#202020"),
    ).toBeGreaterThan(4.5);
  });
});
