import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLocalListenLocalePreference,
  getLocalListenLocalePreference,
  setLocalListenLocalePreference,
} from "@/i18n/language-preference";

describe("language preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores a supported locale", () => {
    setLocalListenLocalePreference("ca");

    expect(getLocalListenLocalePreference()).toBe("ca");
  });

  it("ignores unsupported stored values", () => {
    localStorage.setItem("crate-listen-locale", "pl");

    expect(getLocalListenLocalePreference()).toBeNull();
  });

  it("clears the stored preference for automatic mode", () => {
    setLocalListenLocalePreference("es");

    clearLocalListenLocalePreference();

    expect(getLocalListenLocalePreference()).toBeNull();
  });
});
