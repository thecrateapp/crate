import { afterEach, describe, expect, it } from "vitest";
import {
  getListenDeviceType,
  getListenAppPlatform,
  getListenDeviceLabel,
  getListenDeviceFingerprint,
  getListenDeviceId,
  getListenDeviceCapabilities,
  formatCrateDeviceName,
} from "./listen-device";

const originalUserAgent = navigator.userAgent;

function setUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe("getListenDeviceType", () => {
  it("returns web by default", () => {
    expect(getListenDeviceType()).toBe("web");
  });
});

describe("getListenAppPlatform", () => {
  it("returns listen-web by default", () => {
    expect(getListenAppPlatform()).toBe("listen-web");
  });
});

describe("getListenDeviceLabel", () => {
  it("returns a Crate browser label for web", () => {
    expect(getListenDeviceLabel()).toBe("Crate on Browser");
  });

  it("includes the browser name on desktop web", () => {
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    );

    expect(getListenDeviceLabel()).toBe("Crate on Chrome");
  });

  it("includes browser and OS for mobile web", () => {
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
    );

    expect(getListenDeviceLabel()).toBe("Crate on Mobile Chrome (Android)");
  });
});

describe("formatCrateDeviceName", () => {
  it("normalizes persisted legacy Listen labels", () => {
    expect(formatCrateDeviceName({ device_label: "Web (Listen)" })).toBe(
      "Crate on Browser",
    );
  });

  it("falls back to product-facing platform names", () => {
    expect(formatCrateDeviceName({ app_platform: "listen-tauri" })).toBe(
      "Crate Desktop",
    );
  });
});

describe("getListenDeviceFingerprint", () => {
  it("returns existing fingerprint from localStorage", () => {
    localStorage.setItem("listen-device-fingerprint", "existing");
    expect(getListenDeviceFingerprint()).toBe("existing");
    localStorage.removeItem("listen-device-fingerprint");
  });

  it("generates and stores new fingerprint when none exists", () => {
    localStorage.removeItem("listen-device-fingerprint");
    const result = getListenDeviceFingerprint();
    expect(result).toContain("listen:");
    expect(localStorage.getItem("listen-device-fingerprint")).toBe(result);
  });
});

describe("getListenDeviceId", () => {
  it("uses the stable Listen device fingerprint", () => {
    localStorage.setItem("listen-device-fingerprint", "device-id");
    expect(getListenDeviceId()).toBe("device-id");
    localStorage.removeItem("listen-device-fingerprint");
  });
});

describe("getListenDeviceCapabilities", () => {
  it("reports the web client as a foreground Connect command receiver", () => {
    expect(getListenDeviceCapabilities()).toMatchObject({
      can_play: true,
      can_receive_commands: true,
      can_set_volume: true,
      supports_cast_sender: false,
    });
  });
});
