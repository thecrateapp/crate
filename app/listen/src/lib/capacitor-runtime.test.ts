import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appAddListener,
  appRemoveListener,
  networkGetStatus,
  pluginImports,
  runtime,
} = vi.hoisted(() => ({
  appAddListener: vi.fn(),
  appRemoveListener: vi.fn(),
  networkGetStatus: vi.fn(),
  pluginImports: { app: 0, network: 0 },
  runtime: { native: false, platform: "web" },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => runtime.platform,
    isNativePlatform: () => runtime.native,
  },
}));

vi.mock("@capacitor/app", () => {
  pluginImports.app += 1;
  return {
    App: {
      addListener: appAddListener,
    },
  };
});

vi.mock("@capacitor/network", () => {
  pluginImports.network += 1;
  return {
    Network: { getStatus: networkGetStatus },
  };
});

describe("Capacitor runtime adapters", () => {
  beforeEach(() => {
    vi.resetModules();
    runtime.native = false;
    runtime.platform = "web";
    pluginImports.app = 0;
    pluginImports.network = 0;
    appAddListener.mockReset().mockResolvedValue({ remove: appRemoveListener });
    appRemoveListener.mockReset();
    networkGetStatus.mockReset().mockResolvedValue({ connected: false });
  });

  it("leaves Capacitor lifecycle and network plugins unloaded in Tauri", async () => {
    const { isOnline, onAppPause, onAppResume } = await import(
      "./capacitor-runtime"
    );

    onAppPause(vi.fn())();
    onAppResume(vi.fn())();
    await expect(isOnline()).resolves.toBe(navigator.onLine);

    expect(pluginImports).toEqual({ app: 0, network: 0 });
    expect(appAddListener).not.toHaveBeenCalled();
    expect(networkGetStatus).not.toHaveBeenCalled();
  });

  it("loads the lifecycle plugin for a Capacitor device", async () => {
    runtime.native = true;
    runtime.platform = "android";
    const { onAppPause } = await import("./capacitor-runtime");
    const dispose = onAppPause(vi.fn());

    await vi.waitFor(() =>
      expect(appAddListener).toHaveBeenCalledWith(
        "pause",
        expect.any(Function),
      ),
    );
    dispose();
    await vi.waitFor(() => expect(appRemoveListener).toHaveBeenCalledOnce());

    expect(pluginImports.app).toBe(1);
  });

  it("loads the network plugin for a Capacitor device", async () => {
    runtime.native = true;
    runtime.platform = "android";
    const { isOnline, onAppResume } = await import("./capacitor-runtime");
    const dispose = onAppResume(vi.fn());

    await vi.waitFor(() =>
      expect(appAddListener).toHaveBeenCalledWith(
        "resume",
        expect.any(Function),
      ),
    );
    await expect(isOnline()).resolves.toBe(false);
    dispose();
    await vi.waitFor(() => expect(appRemoveListener).toHaveBeenCalledOnce());

    expect(networkGetStatus).toHaveBeenCalledOnce();
  });
});
