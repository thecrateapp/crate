import { describe, expect, it, vi } from "vitest";

import {
  parseCssColor,
  readCssColorRgb,
  readCssColorToken,
} from "./read-css-color";

describe("readCssColorToken", () => {
  it("resolves a token and restores the element's inline color", () => {
    const element = document.createElement("span");
    element.style.setProperty("color", "red", "important");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "rgb(6, 182, 212)",
    } as CSSStyleDeclaration);

    expect(readCssColorToken(element, "--accent-action")).toBe(
      "rgb(6, 182, 212)",
    );
    expect(element.style.getPropertyValue("color")).toBe("red");
    expect(element.style.getPropertyPriority("color")).toBe("important");
  });

  it("returns null when the browser cannot resolve the token", () => {
    const element = document.createElement("span");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "",
    } as CSSStyleDeclaration);

    expect(readCssColorToken(element, "--missing-token")).toBeNull();
  });
});

describe("parseCssColor", () => {
  it("reads rgb, rgba, space syntax, hex and color(srgb) channels", () => {
    expect(parseCssColor("rgb(255, 0, 51)")).toEqual({
      r: 1,
      g: 0,
      b: 0.2,
    });
    expect(parseCssColor("rgba(0, 255, 0, 0.5)")).toEqual({ r: 0, g: 1, b: 0 });
    expect(parseCssColor("rgb(0 0 255 / 40%)")).toEqual({ r: 0, g: 0, b: 1 });
    expect(parseCssColor("#0f0")).toEqual({ r: 0, g: 1, b: 0 });
    expect(parseCssColor("color(srgb 0.938667 0.391608 0.394431)")).toEqual({
      r: 0.938667,
      g: 0.391608,
      b: 0.394431,
    });
    expect(parseCssColor("color(srgb 1.2 -0 0.5 / 0.4)")).toEqual({
      r: 1,
      g: 0,
      b: 0.5,
    });
  });

  it("returns null for colour models it cannot convert", () => {
    expect(parseCssColor("oklch(0.7 0.1 200)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("readCssColorRgb", () => {
  it("resolves a token straight to sRGB channels", () => {
    const element = document.createElement("span");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "color(srgb 0.5 0.25 1)",
    } as CSSStyleDeclaration);

    expect(readCssColorRgb(element, "--state-danger-text")).toEqual({
      r: 0.5,
      g: 0.25,
      b: 1,
    });
  });
});
