import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_SKIN,
  applyThemeSkin,
  readStoredThemeSkin,
  resolveThemeSkin,
} from "./theme-skin";

describe("theme and skin runtime", () => {
  it("falls back to the supported default for unknown persisted values", () => {
    const storage = {
      getItem: () => JSON.stringify({ theme: "light", skin: "neon" }),
    } as unknown as Storage;

    expect(readStoredThemeSkin(storage)).toEqual(DEFAULT_THEME_SKIN);
  });

  it("resolves only registered combinations", () => {
    expect(resolveThemeSkin("dark", "default")).toEqual(DEFAULT_THEME_SKIN);
    expect(resolveThemeSkin("light", "default")).toEqual(DEFAULT_THEME_SKIN);
  });

  it("applies Listen scope attributes and persists the resolved selection", () => {
    const root = document.documentElement;
    const values = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;

    const selection = applyThemeSkin("dark", "default", { root, storage });

    expect(selection).toEqual(DEFAULT_THEME_SKIN);
    expect(root.dataset.crateApp).toBe("listen");
    expect(root.dataset.crateTheme).toBe("dark");
    expect(root.dataset.crateSkin).toBe("default");
    expect(values.get("crate.listen.theme-skin")).toBe(
      JSON.stringify(DEFAULT_THEME_SKIN),
    );
  });
});
