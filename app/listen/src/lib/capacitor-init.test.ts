import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appAddListener,
  appGetLaunchUrl,
  consumeOAuthCallbackUrl,
  networkAddListener,
  retryPendingNativeOAuthCallback,
  statusBarSetStyle,
  pluginImports,
  runtime,
} = vi.hoisted(() => ({
  appAddListener: vi.fn(),
  appGetLaunchUrl: vi.fn(),
  consumeOAuthCallbackUrl: vi.fn(),
  networkAddListener: vi.fn(),
  retryPendingNativeOAuthCallback: vi.fn(),
  statusBarSetStyle: vi.fn(),
  pluginImports: { app: 0, keyboard: 0, network: 0, statusBar: 0 },
  runtime: { isIosRuntime: false, isNative: true, platform: "android" },
}));

vi.mock("@capacitor/app", () => {
  pluginImports.app += 1;
  return {
    App: {
      addListener: appAddListener,
      getLaunchUrl: appGetLaunchUrl,
      exitApp: vi.fn(),
    },
  };
});

vi.mock("@capacitor/keyboard", () => {
  pluginImports.keyboard += 1;
  return {
    Keyboard: {
      setStyle: vi.fn(),
      setResizeMode: vi.fn(),
      setAccessoryBarVisible: vi.fn(),
      setScroll: vi.fn(),
      addListener: vi.fn(),
    },
    KeyboardResize: { Body: "body" },
    KeyboardStyle: { Dark: "dark" },
  };
});

vi.mock("@capacitor/network", () => {
  pluginImports.network += 1;
  return {
    Network: {
      addListener: networkAddListener,
    },
  };
});

vi.mock("@capacitor/status-bar", () => {
  pluginImports.statusBar += 1;
  return {
    StatusBar: {
      setStyle: statusBarSetStyle,
      setOverlaysWebView: vi.fn(),
      setBackgroundColor: vi.fn(),
    },
    Style: { Dark: "dark", Light: "light" },
  };
});

vi.mock("@/lib/capacitor-oauth", () => ({
  consumeOAuthCallbackUrl,
  retryPendingNativeOAuthCallback,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  get isIosRuntime() {
    return runtime.isIosRuntime;
  },
  get isNative() {
    return runtime.isNative;
  },
  get platform() {
    return runtime.platform;
  },
}));

describe("Capacitor initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    runtime.isIosRuntime = false;
    runtime.isNative = true;
    runtime.platform = "android";
    pluginImports.app = 0;
    pluginImports.keyboard = 0;
    pluginImports.network = 0;
    pluginImports.statusBar = 0;
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

  it("does not announce an auth token after native OAuth cancellation", async () => {
    consumeOAuthCallbackUrl.mockResolvedValue({
      handled: true,
      next: "/",
      cancelled: true,
    });
    const authReceived = vi.fn();
    window.addEventListener("crate:auth-token-received", authReceived);
    const { initCapacitor } = await import("./capacitor-init");
    await initCapacitor();

    const urlOpen = appAddListener.mock.calls.find(
      ([eventName]) => eventName === "appUrlOpen",
    )?.[1];
    urlOpen?.({ url: "cratemusic://oauth/callback?state=s&error=cancelled" });

    await vi.waitFor(() =>
      expect(consumeOAuthCallbackUrl).toHaveBeenCalledOnce(),
    );
    await Promise.resolve();
    expect(authReceived).not.toHaveBeenCalled();
    window.removeEventListener("crate:auth-token-received", authReceived);
  });

  it("maps the resolved appearance mode to the native status bar", async () => {
    const { applyNativeColorMode } = await import("./capacitor-init");

    await applyNativeColorMode("light");

    expect(statusBarSetStyle).toHaveBeenCalledWith({ style: "light" });
  });

  it("does not load Capacitor plugins in Tauri", async () => {
    runtime.isNative = false;
    runtime.platform = "web";
    const { initCapacitor } = await import("./capacitor-init");

    await initCapacitor();

    expect(pluginImports).toEqual({
      app: 0,
      keyboard: 0,
      network: 0,
      statusBar: 0,
    });
    expect(appAddListener).not.toHaveBeenCalled();
    expect(networkAddListener).not.toHaveBeenCalled();
  });
});
