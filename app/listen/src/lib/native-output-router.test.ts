import { beforeEach, describe, expect, it, vi } from "vitest";

const { pluginMock } = vi.hoisted(() => ({
  pluginMock: {
    addListener: vi.fn(),
    getCurrentRoute: vi.fn(),
    getOutputCapabilities: vi.fn(),
    presentRoutePicker: vi.fn(),
    showSystemOutputSwitcher: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => pluginMock),
}));

async function loadRouter(runtime: {
  isNative: boolean;
  isAndroidNative: boolean;
  isIosNative: boolean;
}) {
  vi.doMock("@/lib/capacitor-runtime", () => runtime);
  return import("@/lib/native-output-router");
}

describe("native-output-router", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    pluginMock.getOutputCapabilities.mockResolvedValue({
      platform: "android",
      canShowSystemOutputSwitcher: true,
      canPresentRoutePicker: false,
      canReportCurrentRoute: true,
    });
    pluginMock.getCurrentRoute.mockResolvedValue({
      route: {
        id: "route-1",
        name: "Headphones",
        type: "bluetooth",
        platform: "android",
      },
    });
    pluginMock.showSystemOutputSwitcher.mockResolvedValue({ shown: true });
    pluginMock.presentRoutePicker.mockResolvedValue({ shown: true });
  });

  it("no-ops outside native Android/iOS shells", async () => {
    const router = await loadRouter({
      isNative: false,
      isAndroidNative: false,
      isIosNative: false,
    });

    expect(router.isNativeOutputRoutingAvailable()).toBe(false);
    expect(await router.getNativeCurrentOutputRoute()).toBeNull();
    expect(await router.showNativeOutputPicker()).toEqual({
      shown: false,
      reason: "Native output routing is unavailable.",
    });
  });

  it("uses Android output switcher when running in Android native", async () => {
    const router = await loadRouter({
      isNative: true,
      isAndroidNative: true,
      isIosNative: false,
    });

    expect(await router.getNativeOutputCapabilities()).toMatchObject({
      platform: "android",
      canShowSystemOutputSwitcher: true,
    });
    expect(await router.getNativeCurrentOutputRoute()).toMatchObject({
      id: "route-1",
      name: "Headphones",
    });
    expect(await router.showNativeOutputPicker()).toEqual({ shown: true });
    expect(pluginMock.showSystemOutputSwitcher).toHaveBeenCalledTimes(1);
  });

  it("uses iOS route picker when running in iOS native", async () => {
    const router = await loadRouter({
      isNative: true,
      isAndroidNative: false,
      isIosNative: true,
    });

    expect(await router.showNativeOutputPicker()).toEqual({ shown: true });
    expect(pluginMock.presentRoutePicker).toHaveBeenCalledTimes(1);
  });
});
