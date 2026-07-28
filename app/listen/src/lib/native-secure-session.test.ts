import { beforeEach, describe, expect, it, vi } from "vitest";

const { plugin } = vi.hoisted(() => ({
  plugin: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    listKeys: vi.fn(),
    clearPrefix: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
  registerPlugin: () => plugin,
}));

import {
  NativeSecureSessionUnavailableError,
  clearSecureSessionPrefix,
  getSecureSessionValue,
  listSecureSessionKeys,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "./native-secure-session";

describe("native secure session bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips namespaced JSON values through the native plugin", async () => {
    plugin.set.mockResolvedValue({});
    plugin.get.mockResolvedValue({ value: '{"token":"secret"}' });

    await setSecureSessionValue("crate.session.server-1", '{"token":"secret"}');

    expect(await getSecureSessionValue("crate.session.server-1")).toBe(
      '{"token":"secret"}',
    );
    expect(plugin.set).toHaveBeenCalledWith({
      key: "crate.session.server-1",
      value: '{"token":"secret"}',
    });
  });

  it.each([
    "",
    "server-1",
    "crate.session.",
    "crate.oauth.",
    "crate.session.secret/other",
  ])("rejects invalid key %s without exposing a value", async (key) => {
    await expect(setSecureSessionValue(key, "do-not-log")).rejects.toThrow(
      "Invalid secure session key",
    );
    expect(plugin.set).not.toHaveBeenCalled();
  });

  it("supports remove, list and bounded prefix cleanup", async () => {
    plugin.remove.mockResolvedValue({});
    plugin.listKeys.mockResolvedValue({
      keys: ["crate.session.one", "crate.session.two"],
    });
    plugin.clearPrefix.mockResolvedValue({ removed: 2 });

    await removeSecureSessionValue("crate.session.one");
    expect(await listSecureSessionKeys("crate.session.")).toEqual([
      "crate.session.one",
      "crate.session.two",
    ]);
    expect(await clearSecureSessionPrefix("crate.session.")).toBe(2);
  });

  it("never falls back to localStorage when the native bridge fails", async () => {
    plugin.get.mockRejectedValue(new Error("native failure: secret"));

    await expect(
      getSecureSessionValue("crate.session.server-1"),
    ).rejects.toBeInstanceOf(NativeSecureSessionUnavailableError);
    expect(localStorage.getItem("crate.session.server-1")).toBeNull();
  });
});
