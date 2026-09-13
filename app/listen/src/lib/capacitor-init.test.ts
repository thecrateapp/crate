import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appAddListener,
  appGetLaunchUrl,
  consumeOAuthCallbackUrl,
  networkAddListener,
  retryPendingNativeOAuthCallback,
  statusBarSetStyle,
} = vi.hoisted(() => ({
  appAddListener: vi.fn(),
  appGetLaunchUrl: vi.fn(),
  consumeOAuthCallbackUrl: vi.fn(),
  networkAddListener: vi.fn(),
  retryPendingNativeOAuthCallback: vi.fn(),
  statusBarSetStyle: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appAddListener,
    getLaunchUrl: appGetLaunchUrl,
    exitApp: vi.fn(),
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    setStyle: vi.fn(),
    setResizeMode: vi.fn(),
    setAccessoryBarVisible: vi.fn(),
    setScroll: vi.fn(),
    addListener: vi.fn(),
  },
  KeyboardResize: { Body: "body" },
  KeyboardStyle: { Dark: "dark" },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: networkAddListener,
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: statusBarSetStyle,
    setOverlaysWebView: vi.fn(),
    setBackgroundColor: vi.fn(),
  },
  Style: { Dark: "dark", Light: "light" },
}));

vi.mock("@/lib/capacitor-oauth", () => ({
  consumeOAuthCallbackUrl,
  retryPendingNativeOAuthCallback,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isIosRuntime: false,
  isNative: true,
  platform: "android",
}));

describe("Capacitor initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    appAddListener.mockReset();
    appGetLaunchUrl.mockReset().mockResolvedValue(null);
    consumeOAuthCallbackUrl
      .mockReset()
      .mockResolvedValue({ handled: false, next: "/" });
    networkAddListener.mockReset();
    statusBarSetStyle.mockReset();
    retryPendingNativeOAuthCallback
      .mockReset()
      .mockResolvedValue({ handled: false, next: "/" });
    appAddListener.mockResolvedValue({ remove: vi.fn() });
    networkAddListener.mockResolvedValue({ remove: vi.fn() });
  });

  it("registers native lifecycle listeners only once", async () => {
    const { initCapacitor } = await import("./capacitor-init");

    await Promise.all([initCapacitor(), initCapacitor()]);

    expect(appAddListener).toHaveBeenCalledTimes(4);
    expect(networkAddListener).toHaveBeenCalledTimes(1);
  });

  it("does not block native initialization on a pending OAuth retry", async () => {
    retryPendingNativeOAuthCallback.mockReturnValue(new Promise(() => {}));
    const { initCapacitor } = await import("./capacitor-init");

    const initialized = initCapacitor();

    await vi.waitFor(() => expect(networkAddListener).toHaveBeenCalledOnce());
    await expect(initialized).resolves.toBeNull();
  });

  it("does not block native initialization on a launch URL exchange", async () => {
    appGetLaunchUrl.mockResolvedValue({
      url: "cratemusic://oauth/callback?code=code&state=state",
    });
    consumeOAuthCallbackUrl.mockReturnValue(new Promise(() => {}));
    const { initCapacitor } = await import("./capacitor-init");

    const initialized = initCapacitor();

    await vi.waitFor(() => expect(networkAddListener).toHaveBeenCalledOnce());
    await expect(initialized).resolves.toBeNull();
  });

  it("maps the resolved appearance mode to the native status bar", async () => {
    const { applyNativeColorMode } = await import("./capacitor-init");

    await applyNativeColorMode("light");

    expect(statusBarSetStyle).toHaveBeenCalledWith({ style: "light" });
  });
});
