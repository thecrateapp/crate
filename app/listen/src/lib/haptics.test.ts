import { beforeEach, describe, expect, it, vi } from "vitest";

const { haptics, pluginImport, runtime } = vi.hoisted(() => ({
  haptics: {
    impact: vi.fn(async () => undefined),
    notification: vi.fn(async () => undefined),
    selectionChanged: vi.fn(async () => undefined),
    selectionEnd: vi.fn(async () => undefined),
    selectionStart: vi.fn(async () => undefined),
  },
  pluginImport: vi.fn(),
  runtime: { supportsHaptics: false },
}));

vi.mock("@capacitor/haptics", () => {
  pluginImport();
  return {
    Haptics: haptics,
    ImpactStyle: { Light: "light", Medium: "medium" },
    NotificationType: {
      Error: "error",
      Success: "success",
      Warning: "warning",
    },
  };
});

vi.mock("@/lib/platform", () => ({
  get supportsHaptics() {
    return runtime.supportsHaptics;
  },
}));

import { triggerHaptic } from "./haptics";

describe("haptic capability", () => {
  beforeEach(() => {
    runtime.supportsHaptics = false;
    pluginImport.mockClear();
    Object.values(haptics).forEach((call) => call.mockClear());
  });

  it("does not load the Capacitor haptics plugin outside mobile shells", () => {
    triggerHaptic("medium");

    expect(pluginImport).not.toHaveBeenCalled();
    expect(haptics.impact).not.toHaveBeenCalled();
  });

  it("loads the plugin when haptics are supported", async () => {
    runtime.supportsHaptics = true;

    triggerHaptic("medium");

    await vi.waitFor(() =>
      expect(haptics.impact).toHaveBeenCalledWith({ style: "medium" }),
    );
    expect(pluginImport).toHaveBeenCalledOnce();
  });
});
