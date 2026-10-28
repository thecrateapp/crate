import { beforeEach, describe, expect, it, vi } from "vitest";

import { readThemeColor, syncThemeColor } from "./theme-color";

describe("Crate theme-color metadata", () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  });

  it("reads the Crate surface token without a mode preference", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--crate-token-surface-app" ? "#0a0a0f" : "",
    } as unknown as CSSStyleDeclaration);

    expect(readThemeColor(document.documentElement)).toBe("#0a0a0f");
  });

  it("updates browser chrome from the surface token", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "#0a0a0f",
    } as unknown as CSSStyleDeclaration);

    expect(syncThemeColor(document.documentElement)).toBe("#0a0a0f");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe("#0a0a0f");
  });

  it("falls back to the Crate canvas when runtime CSS is unavailable", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);

    expect(readThemeColor(document.documentElement)).toBe("#0a0a0f");
  });

  it("keeps bootstrap safe when there is no metadata element", () => {
    document.head.innerHTML = "";
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);

    expect(syncThemeColor(document.documentElement)).toBe("#0a0a0f");
  });
});
