import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  isTauriRuntime: true,
  isWebRuntime: false,
  usesConfigurableServer: true,
  usesNativeFilesystem: true,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isIosBrowser: false,
  isNative: false,
}));

import { isOfflineSupported, primeOfflineRuntimeProfile } from "./offline";

describe("Tauri offline runtime", () => {
  it("advertises offline support when the desktop filesystem backend is present", () => {
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
      expect(isOfflineSupported()).toBe(true);
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

  it("does not wait for a service worker that Tauri never registers", async () => {
    const originalServiceWorker = navigator.serviceWorker;
    const readyMock = vi.fn(() => Promise.resolve({ active: null }));
    const serviceWorker = Object.defineProperty({}, "ready", {
      configurable: true,
      get: readyMock,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    try {
      await primeOfflineRuntimeProfile();

      expect(readyMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: originalServiceWorker,
      });
    }
  });
});
