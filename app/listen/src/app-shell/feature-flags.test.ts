import { describe, expect, it } from "vitest";

import { isListenAppearanceSettingsEnabled } from "./feature-flags";

describe("Listen appearance feature flag", () => {
  it("is opt-in and only accepts the exact true value", () => {
    expect(isListenAppearanceSettingsEnabled(undefined)).toBe(false);
    expect(isListenAppearanceSettingsEnabled("false")).toBe(false);
    expect(isListenAppearanceSettingsEnabled("TRUE")).toBe(false);
    expect(isListenAppearanceSettingsEnabled("true")).toBe(true);
  });
});
