import { describe, expect, it } from "vitest";
import { locales, t } from "./index";

describe("t", () => {
  it("returns the English string for a known key", () => {
    expect(t("hero.title")).toBe("Crate is not a streaming service.");
  });

  it("falls back to English for an unknown locale", () => {
    expect(t("hero.subline", "xx")).toBe("It's a tool for revolution.");
  });

  it("interpolates named values", () => {
    expect(t("paths.steps", "en", { steps: "12" })).toBe("12 steps");
  });

  it("exposes English as the only shipped locale", () => {
    expect(locales).toEqual(["en"]);
  });
});
