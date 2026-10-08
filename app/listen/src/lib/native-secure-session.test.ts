import { beforeEach, describe, expect, it, vi } from "vitest";

const { plugin, runtime } = vi.hoisted(() => ({
  plugin: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    listKeys: vi.fn(),
    clearPrefix: vi.fn(),
  },
  runtime: { isCapacitorRuntime: true, isTauriRuntime: false },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
  registerPlugin: () => plugin,
}));
vi.mock("@/lib/platform", () => runtime);

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
    runtime.isCapacitorRuntime = true;
    runtime.isTauriRuntime = false;
    delete window.__crateTauriInvoke;
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
    `crate.oauth.${"a".repeat(256)}`,
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

  it("preserves the original native error as `cause` for diagnostics", async () => {
    const nativeError = new Error("decrypt failed: bad tag");
    plugin.get.mockRejectedValue(nativeError);

    await expect(
      getSecureSessionValue("crate.session.server-1"),
    ).rejects.toMatchObject({ cause: nativeError });
  });

  it("uses Tauri secure-session commands instead of the Capacitor plugin", async () => {
    runtime.isCapacitorRuntime = false;
    runtime.isTauriRuntime = true;
    const invoke = vi.fn(async (command: string) =>
      command === "secure_session_get" ? '{"token":"desktop-secret"}' : null,
    );
    window.__crateTauriInvoke = invoke as unknown as NonNullable<
      Window["__crateTauriInvoke"]
    >;

    expect(await getSecureSessionValue("crate.session.server-1")).toBe(
      '{"token":"desktop-secret"}',
    );
    await setSecureSessionValue("crate.session.server-1", '{"token":"next"}');
    await removeSecureSessionValue("crate.session.server-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "secure_session_get", {
      key: "crate.session.server-1",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "secure_session_set", {
      key: "crate.session.server-1",
      value: '{"token":"next"}',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "secure_session_remove", {
      key: "crate.session.server-1",
    });
    expect(plugin.get).not.toHaveBeenCalled();
    expect(plugin.set).not.toHaveBeenCalled();
    expect(plugin.remove).not.toHaveBeenCalled();
  });

  it("fails closed when the Tauri secure-session bridge is unavailable", async () => {
    runtime.isCapacitorRuntime = false;
    runtime.isTauriRuntime = true;

    await expect(
      getSecureSessionValue("crate.session.server-1"),
    ).rejects.toBeInstanceOf(NativeSecureSessionUnavailableError);
    expect(localStorage.getItem("crate.session.server-1")).toBeNull();
  });

  it("rejects secure JSON values above 64 KiB in UTF-8", async () => {
    const value = JSON.stringify({ value: "é".repeat(32 * 1024) });

    await expect(
      setSecureSessionValue("crate.oauth.state-1", value),
    ).rejects.toThrow("Invalid secure session value");
    expect(plugin.set).not.toHaveBeenCalled();
  });
});
