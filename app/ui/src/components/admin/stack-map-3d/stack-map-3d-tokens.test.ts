import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDuration, readStackMap3DTokens } from "./stack-map-3d-tokens";

function style(values: Record<string, string>) {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => values[name] ?? "",
  } as CSSStyleDeclaration);
}

afterEach(() => vi.restoreAllMocks());

describe("readStackMap3DTokens", () => {
  it("derives camera timings from the shared motion duration", () => {
    style({ "--motion-duration-normal": "200ms" });
    const tokens = readStackMap3DTokens(
      document.createElement("div"),
      document.createElement("div"),
    );
    expect(tokens.durations).toEqual({ intro: 1040, fly: 720, reset: 720 });
  });

  it("reads component tokens and falls back to defaults", () => {
    style({
      "--stack-map-3d-line-active": "3.2",
      "--stack-map-3d-bloom-strength": "0.6",
    });
    const tokens = readStackMap3DTokens(
      document.createElement("div"),
      document.createElement("div"),
    );
    expect(tokens.lines.active).toBe(3.2);
    expect(tokens.lines.rest).toBe(1.6);
    expect(tokens.bloom?.strength).toBeCloseTo(0.6, 6);
    expect(tokens.durations.fly).toBe(900);
  });

  it("drops bloom when effects are off and boosts it when expressive", () => {
    style({});
    const root = document.createElement("div");
    root.dataset.crateEffects = "off";
    expect(
      readStackMap3DTokens(document.createElement("div"), root).bloom,
    ).toBe(null);
    root.dataset.crateEffects = "expressive";
    expect(
      readStackMap3DTokens(document.createElement("div"), root).bloom?.strength,
    ).toBeCloseTo(0.65, 6);
  });
});

describe("parseDuration", () => {
  it("accepts milliseconds and seconds", () => {
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration(" 0.4s ")).toBe(400);
    expect(parseDuration("fast")).toBeNull();
  });
});
