import { afterEach, describe, expect, it, vi } from "vitest";

import { openExternalOAuthUrl } from "./OAuthButtons";

function defineWindowValue(key: string, value: unknown): void {
  Object.defineProperty(window, key, {
    value,
    configurable: true,
    writable: true,
  });
}

describe("openExternalOAuthUrl", () => {
  const originalOpen = window.open;

  afterEach(() => {
    defineWindowValue("open", originalOpen);
    Reflect.deleteProperty(window, "__TAURI__");
    vi.restoreAllMocks();
  });

  it("uses the Tauri opener global when present", async () => {
    const openUrl = vi
      .fn<(url: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const windowOpen = vi.fn();
    defineWindowValue("__TAURI__", { opener: { openUrl } });
    defineWindowValue("open", windowOpen);

    await openExternalOAuthUrl("https://example.test/oauth");

    expect(openUrl).toHaveBeenCalledWith("https://example.test/oauth");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("falls back to a browser popup when no Tauri opener is exposed", async () => {
    const windowOpen = vi.fn(() => ({ closed: false }));
    defineWindowValue("open", windowOpen);

    await openExternalOAuthUrl("https://example.test/oauth");

    expect(windowOpen).toHaveBeenCalledWith(
      "https://example.test/oauth",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
