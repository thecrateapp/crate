import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  appAddListener,
  appGetLaunchUrl,
  appExit,
  keyboardAddListener,
  consumeOAuthCallbackUrl,
  networkAddListener,
  retryPendingNativeOAuthCallback,
  storePendingOAuthProviderError,
  statusBarSetStyle,
  pluginImports,
  runtime,
} = vi.hoisted(() => ({
  appAddListener: vi.fn(),
  appGetLaunchUrl: vi.fn(),
  appExit: vi.fn(),
  keyboardAddListener: vi.fn(),
  consumeOAuthCallbackUrl: vi.fn(),
  networkAddListener: vi.fn(),
  retryPendingNativeOAuthCallback: vi.fn(),
  storePendingOAuthProviderError: vi.fn(),
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
      exitApp: appExit,
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
      addListener: keyboardAddListener,
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
  storePendingOAuthProviderError,
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
    appExit.mockReset();
    keyboardAddListener.mockReset().mockResolvedValue({ remove: vi.fn() });
    appGetLaunchUrl.mockReset().mockResolvedValue(null);
    consumeOAuthCallbackUrl
      .mockReset()
      .mockResolvedValue({ handled: false, next: "/" });
    networkAddListener.mockReset();
    statusBarSetStyle.mockReset();
    retryPendingNativeOAuthCallback
      .mockReset()
      .mockResolvedValue({ handled: false, next: "/" });
    storePendingOAuthProviderError.mockReset();
    appAddListener.mockResolvedValue({ remove: vi.fn() });
    networkAddListener.mockResolvedValue({ remove: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--listen-viewport-height");
    document.documentElement.style.removeProperty("--listen-keyboard-height");
    document.documentElement.removeAttribute("data-keyboard-open");
  });

  it.each(["overlay", "history", "exit"])(
    "routes native back to %s in priority order",
    async (destination) => {
      const back = vi
        .spyOn(window.history, "back")
        .mockImplementation(() => {});
      const intercept = (event: Event) => event.preventDefault();
      if (destination === "overlay")
        window.addEventListener("crate:native-back", intercept);
      try {
        const { initCapacitor } = await import("./capacitor-init");
        await initCapacitor();
        const callback = appAddListener.mock.calls.find(
          ([name]) => name === "backButton",
        )![1];
        callback({ canGoBack: destination !== "exit" });
        expect(back).toHaveBeenCalledTimes(destination === "history" ? 1 : 0);
        expect(appExit).toHaveBeenCalledTimes(destination === "exit" ? 1 : 0);
      } finally {
        window.removeEventListener("crate:native-back", intercept);
      }
    },
  );

  it("keeps iOS viewport and keyboard clearances in sync and reveals the focused field", async () => {
    runtime.isIosRuntime = true;
    runtime.platform = "ios";
    vi.stubGlobal("innerHeight", 812);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const add = vi.spyOn(window, "addEventListener");
    const input = document.createElement("input");
    const scroll = vi.fn();
    input.scrollIntoView = scroll;
    document.body.append(input);
    input.focus();
    const changed = vi.fn();
    window.addEventListener("crate:keyboard-change", changed);
    try {
      const { initCapacitor } = await import("./capacitor-init");
      await initCapacitor();
      await initCapacitor();
      expect(keyboardAddListener).toHaveBeenCalledTimes(2);
      expect(
        document.documentElement.style.getPropertyValue(
          "--listen-viewport-height",
        ),
      ).toBe("812px");
      const show = keyboardAddListener.mock.calls.find(
        ([name]) => name === "keyboardWillShow",
      )![1];
      const hide = keyboardAddListener.mock.calls.find(
        ([name]) => name === "keyboardWillHide",
      )![1];
      show({ keyboardHeight: 300 });
      expect(document.documentElement).toHaveAttribute("data-keyboard-open");
      expect(
        document.documentElement.style.getPropertyValue(
          "--listen-keyboard-height",
        ),
      ).toBe("300px");
      expect(scroll).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
      expect(changed.mock.calls[0]![0].detail.height).toBe(300);
      vi.stubGlobal("innerHeight", 844);
      hide();
      expect(document.documentElement).not.toHaveAttribute(
        "data-keyboard-open",
      );
      expect(
        document.documentElement.style.getPropertyValue(
          "--listen-keyboard-height",
        ),
      ).toBe("0px");
      expect(
        document.documentElement.style.getPropertyValue(
          "--listen-viewport-height",
        ),
      ).toBe("844px");
      vi.stubGlobal("innerHeight", 390);
      window.dispatchEvent(new Event("orientationchange"));
      expect(
        document.documentElement.style.getPropertyValue(
          "--listen-viewport-height",
        ),
      ).toBe("390px");
    } finally {
      input.remove();
      window.removeEventListener("crate:keyboard-change", changed);
      for (const [name, callback] of add.mock.calls) {
        if (name === "resize" || name === "orientationchange")
          window.removeEventListener(name, callback);
      }
    }
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

  it("surfaces native OAuth provider failures without announcing login success", async () => {
    consumeOAuthCallbackUrl.mockResolvedValue({
      handled: true,
      next: "/",
      providerError: true,
    });
    const authReceived = vi.fn();
    const providerError = vi.fn();
    window.addEventListener("crate:auth-token-received", authReceived);
    window.addEventListener("crate:oauth-provider-error", providerError);
    const { initCapacitor } = await import("./capacitor-init");
    await initCapacitor();

    const urlOpen = appAddListener.mock.calls.find(
      ([eventName]) => eventName === "appUrlOpen",
    )?.[1];
    urlOpen?.({
      url: "cratemusic://oauth/callback?state=s&error=provider_error",
    });

    await vi.waitFor(() => expect(providerError).toHaveBeenCalledOnce());
    expect(storePendingOAuthProviderError).toHaveBeenCalledOnce();
    expect(authReceived).not.toHaveBeenCalled();
    window.removeEventListener("crate:auth-token-received", authReceived);
    window.removeEventListener("crate:oauth-provider-error", providerError);
  });

  it("uses the fixed Crate status-bar style", async () => {
    const { applyNativeStatusBarStyle } = await import("./capacitor-init");

    await applyNativeStatusBarStyle();

    expect(statusBarSetStyle).toHaveBeenCalledWith({ style: "dark" });
  });

  it("applies the same fixed status-bar style during native bootstrap", async () => {
    const { initCapacitor } = await import("./capacitor-init");

    await initCapacitor();

    expect(statusBarSetStyle).toHaveBeenCalledWith({ style: "dark" });
    expect(statusBarSetStyle).not.toHaveBeenCalledWith({ style: "light" });
  });

  it("does not load the status-bar plugin for a web runtime", async () => {
    runtime.isNative = false;
    runtime.platform = "web";
    const { applyNativeStatusBarStyle } = await import("./capacitor-init");

    await applyNativeStatusBarStyle();

    expect(pluginImports.statusBar).toBe(0);
    expect(statusBarSetStyle).not.toHaveBeenCalled();
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
