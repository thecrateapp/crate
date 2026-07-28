import { beforeEach, describe, expect, it, vi } from "vitest";

const { pluginMock, registerPluginMock } = vi.hoisted(() => {
  const plugin = {
    update: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    addListener: vi.fn(),
    getCurrentRoute: vi.fn(async () => ({ route: null })),
    getOutputCapabilities: vi.fn(async () => ({
      platform: "android",
      canShowSystemOutputSwitcher: true,
      canPresentRoutePicker: false,
      canReportCurrentRoute: true,
    })),
    presentRoutePicker: vi.fn(async () => ({ shown: true })),
    showSystemOutputSwitcher: vi.fn(async () => ({ shown: true })),
  };
  return {
    pluginMock: plugin,
    registerPluginMock: vi.fn(() => plugin),
  };
});

vi.mock("@capacitor/core", () => ({
  registerPlugin: registerPluginMock,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isNative: true,
  isAndroidNative: true,
  isIosNative: false,
}));

describe("native media session bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("uses one Capacitor proxy for controls and output routing", async () => {
    const mediaSession = await import("@/lib/native-media-session");
    const outputRouter = await import("@/lib/native-output-router");

    await mediaSession.syncNativeMediaSession({
      title: "Track",
      artist: "Artist",
      isPlaying: true,
      position: 0,
      duration: 180,
    });
    await outputRouter.getNativeOutputCapabilities();

    expect(registerPluginMock).toHaveBeenCalledTimes(1);
    expect(registerPluginMock).toHaveBeenCalledWith("CrateMediaSession");
    expect(pluginMock.update).toHaveBeenCalledTimes(1);
    expect(pluginMock.getOutputCapabilities).toHaveBeenCalledTimes(1);
  });
});
