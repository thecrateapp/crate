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
    expect(t("hero.caption", "en", { tracks: "48,213" })).toBe(
      "48,213 tracks · one library",
    );
  });

  it("exposes English as the only shipped locale", () => {
    expect(locales).toEqual(["en"]);
  });
});
