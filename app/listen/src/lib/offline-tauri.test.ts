import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  isTauriRuntime: true,
  usesConfigurableServer: true,
  usesNativeFilesystem: true,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isIosBrowser: false,
  isNative: false,
}));

import { isOfflineSupported } from "./offline";

describe("Tauri offline runtime", () => {
  it("does not advertise offline support without a desktop filesystem backend", () => {
    const originalCaches = globalThis.caches;
    const originalServiceWorker = navigator.serviceWorker;

    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });

    try {
      expect(isOfflineSupported()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: originalCaches,
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: originalServiceWorker,
      });
    }
  });
});
