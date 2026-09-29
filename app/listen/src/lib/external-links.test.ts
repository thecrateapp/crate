import { afterEach, describe, expect, it, vi } from "vitest";

const { isNativePlatform, openBrowser } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  openBrowser: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "web",
    isNativePlatform,
  },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open: openBrowser },
}));

import { openExternalUrl } from "./external-links";

type ExternalLinkBridgeWindow = Window & {
  __crateOpenExternalUrl?: (url: string) => Promise<void>;
  __TAURI_INTERNALS__?: object;
};

function externalLinkBridgeWindow(): ExternalLinkBridgeWindow {
  return window as ExternalLinkBridgeWindow;
}

afterEach(() => {
  delete externalLinkBridgeWindow().__crateOpenExternalUrl;
  delete externalLinkBridgeWindow().__TAURI_INTERNALS__;
  isNativePlatform.mockReset();
  isNativePlatform.mockReturnValue(false);
  openBrowser.mockReset();
  openBrowser.mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe("openExternalUrl", () => {
  it("opens Tauri links through the explicit native bridge", async () => {
    const bridge = vi.fn(async () => undefined);
    externalLinkBridgeWindow().__TAURI_INTERNALS__ = {};
    externalLinkBridgeWindow().__crateOpenExternalUrl = bridge;

    await openExternalUrl("https://bandcamp.com/album/example");

    expect(bridge).toHaveBeenCalledWith("https://bandcamp.com/album/example");
  });

  it("reports a missing Tauri opener without navigating the main window", async () => {
    externalLinkBridgeWindow().__TAURI_INTERNALS__ = {};
    const currentUrl = window.location.href;

    await expect(
      openExternalUrl("https://bandcamp.com/album/example"),
    ).rejects.toThrow("Tauri external opener is unavailable");

    expect(window.location.href).toBe(currentUrl);
  });

  it("does not fall back to navigation when the native opener rejects", async () => {
    const currentUrl = window.location.href;
    const bridge = vi.fn(async () => {
      throw new Error("opener failed");
    });
    externalLinkBridgeWindow().__TAURI_INTERNALS__ = {};
    externalLinkBridgeWindow().__crateOpenExternalUrl = bridge;

    await expect(
      openExternalUrl("https://bandcamp.com/album/example"),
    ).rejects.toThrow("opener failed");

    expect(window.location.href).toBe(currentUrl);
  });

  it("uses Capacitor Browser for native mobile links", async () => {
    isNativePlatform.mockReturnValue(true);

    await openExternalUrl("https://bandcamp.com/album/example");

    expect(openBrowser).toHaveBeenCalledWith({
      url: "https://bandcamp.com/album/example",
    });
  });

  it("opens web links in a safe new tab", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await openExternalUrl("https://bandcamp.com/album/example");

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://bandcamp.com/album/example");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
  });

  it("resolves same-origin asset links before opening them", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await openExternalUrl("/api/me/contributions/123/export");

    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe(
      new URL("/api/me/contributions/123/export", window.location.origin).href,
    );
  });

  it("rejects non-web schemes before invoking any opener", async () => {
    externalLinkBridgeWindow().__TAURI_INTERNALS__ = {};
    const bridge = vi.fn(async () => undefined);
    externalLinkBridgeWindow().__crateOpenExternalUrl = bridge;

    await expect(openExternalUrl("javascript:alert(1)")).rejects.toThrow(
      "Only HTTP and HTTPS external links are supported",
    );

    expect(bridge).not.toHaveBeenCalled();
  });
});
