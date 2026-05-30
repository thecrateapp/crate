import { describe, expect, it } from "vitest";
import {
  getListenDeviceType,
  getListenAppPlatform,
  getListenDeviceLabel,
  getListenDeviceFingerprint,
  getListenDeviceId,
  getListenDeviceCapabilities,
} from "./listen-device";

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
  it("returns Web (Listen) for web", () => {
    expect(getListenDeviceLabel()).toBe("Web (Listen)");
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
