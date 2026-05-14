import { describe, expect, it, vi } from "vitest";

async function loadPlatform({
  native,
  platform,
  tauri,
}: {
  native: boolean;
  platform: "android" | "ios" | "web";
  tauri?: boolean;
}) {
  vi.resetModules();
  if (tauri) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  } else {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  }
  vi.doMock("@capacitor/core", () => ({
    Capacitor: {
      getPlatform: () => platform,
      isNativePlatform: () => native,
    },
  }));

  const module = await import("@/lib/platform");
  vi.doUnmock("@capacitor/core");
  return module;
}

describe("listen platform flags", () => {
  it("treats regular browsers as web runtime", async () => {
    const platform = await loadPlatform({ native: false, platform: "web" });

    expect(platform.listenRuntime).toBe("web");
    expect(platform.usesConfigurableServer).toBe(false);
    expect(platform.shouldRegisterServiceWorker).toBe(true);
    expect(platform.getListenAppId()).toBe("listen-web");
  });

  it("treats Capacitor shells as configurable-server runtimes", async () => {
    const platform = await loadPlatform({ native: true, platform: "android" });

    expect(platform.listenRuntime).toBe("capacitor");
    expect(platform.usesConfigurableServer).toBe(true);
    expect(platform.usesMobileShell).toBe(true);
    expect(platform.getListenAppId()).toBe("listen-android");
  });

  it("detects Tauri before Capacitor and keeps desktop semantics", async () => {
    const platform = await loadPlatform({
      native: false,
      platform: "web",
      tauri: true,
    });

    expect(platform.listenRuntime).toBe("tauri");
    expect(platform.usesConfigurableServer).toBe(true);
    expect(platform.usesMobileShell).toBe(false);
    expect(platform.shouldRegisterServiceWorker).toBe(false);
    expect(platform.getListenAppId()).toBe("listen-tauri");
  });
});
