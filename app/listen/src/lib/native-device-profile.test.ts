import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/web/api";

const { apiMock, plugin, runtime, servers, prefs, fetchMock } = vi.hoisted(
  () => ({
    apiMock: vi.fn(),
    plugin: {
      setProfile: vi.fn(),
      updateProfile: vi.fn(),
      clearProfile: vi.fn(),
      getStatus: vi.fn(),
      addListener: vi.fn(),
    },
    runtime: { capacitor: true, android: true },
    servers: {
      currentId: "server-1" as string | null,
      list: [] as Array<{
        id: string;
        url: string;
        token: string | null;
      }>,
    },
    prefs: { delivery: "auto", offlineKey: "profile-a" as string | null },
    fetchMock: vi.fn(),
  }),
);

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => plugin,
}));
vi.mock("@/lib/capacitor-runtime", () => ({
  get isAndroidNative() {
    return runtime.android;
  },
}));
vi.mock("@/lib/platform", () => ({
  get isCapacitorRuntime() {
    return runtime.capacitor;
  },
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/server-store", () => ({
  getCurrentServer: () =>
    servers.list.find((server) => server.id === servers.currentId) ?? null,
  getServerById: (id: string) =>
    servers.list.find((server) => server.id === id) ?? null,
}));
vi.mock("@/lib/offline-storage", () => ({
  getActiveOfflineProfileKey: () => prefs.offlineKey,
}));
vi.mock("@/lib/player-playback-prefs", () => ({
  getPlaybackDeliveryPolicyPreference: () => prefs.delivery,
}));

import {
  getActiveNativeDeviceProfile,
  nativeDeviceTokenAuthorizes,
} from "@/lib/native-device-authorization";
import {
  getOrCreateNativeDeviceId,
  handleNativeDeviceProfileChange,
  NATIVE_DEVICE_ID_KEY,
  NATIVE_DEVICE_REMINT_WINDOW_MS,
  nativeDeviceLabel,
  resetNativeDeviceProfileForTests,
  retireNativeDeviceProfile,
  subscribeNativeDeviceProfileChanges,
  syncNativeDeviceProfile,
  updateNativeDeviceProfilePreferences,
} from "@/lib/native-device-profile";

const NOW = Date.parse("2026-11-28T12:00:00Z");
const EXPIRES = "2026-12-28T12:00:00Z";
const EXPIRES_MS = Date.parse(EXPIRES);

function storedStatus(overrides: Record<string, unknown> = {}) {
  return {
    hasProfile: true,
    serverId: "server-1",
    serverUrl: "https://one.example",
    tokenId: 7,
    expiresAtMs: EXPIRES_MS,
    deliveryPolicy: "auto",
    offlineProfileKey: "profile-a",
    deviceId: "device-0123456789",
    ...overrides,
  };
}

function created(id = 8) {
  return {
    id,
    token: `crv_minted_${id}`,
    device_id: "device-0123456789",
    label: "Android: Pixel 8",
    created_at: "2026-11-28T12:00:00Z",
    expires_at: EXPIRES,
  };
}

describe("native device profile", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    resetNativeDeviceProfileForTests();
    localStorage.clear();
    runtime.capacitor = true;
    runtime.android = true;
    servers.currentId = "server-1";
    servers.list = [
      { id: "server-1", url: "https://one.example/", token: "session-1" },
      { id: "server-2", url: "https://two.example", token: "session-2" },
    ];
    prefs.delivery = "auto";
    prefs.offlineKey = "profile-a";
    apiMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const method of Object.values(plugin)) method.mockReset();
    plugin.getStatus.mockResolvedValue({ hasProfile: false });
    plugin.clearProfile.mockResolvedValue({ hasProfile: false });
    plugin.setProfile.mockImplementation(async (input) =>
      storedStatus({
        serverId: input.serverId,
        serverUrl: input.serverUrl,
        tokenId: input.tokenId,
        expiresAtMs: input.expiresAtMs,
        deliveryPolicy: input.deliveryPolicy,
        offlineProfileKey: input.offlineProfileKey ?? undefined,
      }),
    );
    plugin.updateProfile.mockImplementation(async (input) =>
      storedStatus({
        deliveryPolicy: input.deliveryPolicy,
        offlineProfileKey: input.offlineProfileKey ?? undefined,
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mints a device token after sign-in and hands it to native code", async () => {
    apiMock.mockResolvedValue(created());
    prefs.delivery = "data_saver";

    await expect(syncNativeDeviceProfile()).resolves.toBe("minted");

    const deviceId = localStorage.getItem(NATIVE_DEVICE_ID_KEY);
    expect(deviceId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(apiMock).toHaveBeenCalledWith("/api/auth/device-tokens", "POST", {
      device_id: deviceId,
      label: expect.stringMatching(/^Android/),
    });
    expect(plugin.setProfile).toHaveBeenCalledWith({
      serverUrl: "https://one.example",
      serverId: "server-1",
      deviceToken: "crv_minted_8",
      tokenId: 8,
      expiresAtMs: EXPIRES_MS,
      deviceId,
      deliveryPolicy: "data_saver",
      offlineProfileKey: "profile-a",
    });
    expect(getActiveNativeDeviceProfile()).toEqual({
      serverId: "server-1",
      origin: "https://one.example",
      tokenId: 8,
      expiresAtMs: EXPIRES_MS,
    });
  });

  it("reuses the per-install device id across sign-ins", async () => {
    const first = getOrCreateNativeDeviceId();
    expect(getOrCreateNativeDeviceId()).toBe(first);
    localStorage.setItem(NATIVE_DEVICE_ID_KEY, "bad id");
    expect(getOrCreateNativeDeviceId()).not.toBe("bad id");
  });

  it("labels the device with the model the user agent names", () => {
    expect(
      nativeDeviceLabel(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36",
      ),
    ).toBe("Android: Pixel 8");
    expect(
      nativeDeviceLabel("Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit"),
    ).toBe("Android");
    expect(nativeDeviceLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe(
      "Android",
    );
  });

  it("keeps a valid profile and only pushes changed preferences", async () => {
    plugin.getStatus.mockResolvedValue(storedStatus());

    await expect(syncNativeDeviceProfile()).resolves.toBe("active");
    expect(apiMock).not.toHaveBeenCalled();
    expect(plugin.updateProfile).not.toHaveBeenCalled();

    prefs.delivery = "original";
    await expect(syncNativeDeviceProfile()).resolves.toBe("active");
    expect(plugin.updateProfile).toHaveBeenCalledWith({
      deliveryPolicy: "original",
      offlineProfileKey: "profile-a",
    });
    expect(getActiveNativeDeviceProfile()?.tokenId).toBe(7);
  });

  it("re-mints within 24 hours of expiry", async () => {
    plugin.getStatus.mockResolvedValue(
      storedStatus({ expiresAtMs: NOW + NATIVE_DEVICE_REMINT_WINDOW_MS - 1 }),
    );
    apiMock.mockResolvedValue(created(9));

    await expect(syncNativeDeviceProfile()).resolves.toBe("minted");
    expect(plugin.setProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: 9 }),
    );
  });

  it("does not re-mint a token with more than 24 hours left", async () => {
    plugin.getStatus.mockResolvedValue(
      storedStatus({ expiresAtMs: NOW + NATIVE_DEVICE_REMINT_WINDOW_MS + 1 }),
    );

    await expect(syncNativeDeviceProfile()).resolves.toBe("active");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("re-mints when the server no longer lists the token", async () => {
    plugin.getStatus.mockResolvedValue(storedStatus());
    apiMock.mockImplementation(async (_path: string, method?: string) =>
      method === "POST" ? created(10) : [{ id: 3, current_session: true }],
    );

    await expect(syncNativeDeviceProfile({ verify: true })).resolves.toBe(
      "minted",
    );
    expect(apiMock).toHaveBeenNthCalledWith(1, "/api/auth/device-tokens");
  });

  it("keeps a token the server still lists", async () => {
    plugin.getStatus.mockResolvedValue(storedStatus());
    apiMock.mockResolvedValue([{ id: 7, current_session: true }]);

    await expect(syncNativeDeviceProfile({ verify: true })).resolves.toBe(
      "active",
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("re-mints after a 401 or 403 from the device endpoints", async () => {
    plugin.getStatus.mockResolvedValue(storedStatus());
    apiMock.mockImplementation(async (_path: string, method?: string) => {
      if (method === "POST") return created(11);
      throw new ApiError(403, "Forbidden");
    });

    await expect(syncNativeDeviceProfile({ verify: true })).resolves.toBe(
      "minted",
    );
  });

  it("re-mints once when the service reports the token rejected", async () => {
    apiMock.mockResolvedValue(created(12));

    await expect(
      handleNativeDeviceProfileChange({
        hasProfile: false,
        reason: "unauthorized",
      }),
    ).resolves.toBe("minted");
    await expect(
      handleNativeDeviceProfileChange({
        hasProfile: false,
        reason: "unauthorized",
      }),
    ).resolves.toBe("inactive");
    expect(apiMock).toHaveBeenCalledTimes(1);
    await expect(
      handleNativeDeviceProfileChange({ hasProfile: false, reason: "cleared" }),
    ).resolves.toBe("inactive");
  });

  it("falls back to the session bearer at once when a revoked token is refused", async () => {
    // A stored, valid profile that the server still lists...
    plugin.getStatus.mockResolvedValue(storedStatus());
    apiMock.mockResolvedValueOnce([{ id: 7, current_session: true }]);
    await expect(syncNativeDeviceProfile({ verify: true })).resolves.toBe(
      "active",
    );
    const stream = "https://one.example/api/tracks/1/stream";
    expect(nativeDeviceTokenAuthorizes(stream, "stream")).toBe(true);

    // ...is revoked elsewhere; the service sees a stream refused and clears it.
    plugin.getStatus.mockResolvedValue({ hasProfile: false });
    let resolveMint: (value: unknown) => void = () => {};
    apiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMint = resolve;
      }),
    );
    const remint = handleNativeDeviceProfileChange({
      hasProfile: false,
      reason: "unauthorized",
    });

    // The mirror is gone before the server answers, so new engine tracks
    // carry the session bearer again.
    expect(getActiveNativeDeviceProfile()).toBeNull();
    expect(nativeDeviceTokenAuthorizes(stream, "stream")).toBe(false);
    await vi.waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        "/api/auth/device-tokens",
        "POST",
        expect.objectContaining({ device_id: expect.any(String) }),
      ),
    );

    resolveMint(created(15));
    await expect(remint).resolves.toBe("minted");
    expect(plugin.setProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: 15, deviceToken: "crv_minted_15" }),
    );
    expect(getActiveNativeDeviceProfile()?.tokenId).toBe(15);
    expect(nativeDeviceTokenAuthorizes(stream, "stream")).toBe(true);
  });

  it.each([404, 405])(
    "treats a %s from an older server as unsupported",
    async (status) => {
      apiMock.mockRejectedValue(new ApiError(status, "Not Found"));

      await expect(syncNativeDeviceProfile()).resolves.toBe("unsupported");
      await expect(syncNativeDeviceProfile()).resolves.toBe("unsupported");

      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(plugin.setProfile).not.toHaveBeenCalled();
      expect(getActiveNativeDeviceProfile()).toBeNull();
    },
  );

  it("clears the profile when the session cannot mint", async () => {
    apiMock.mockRejectedValue(new ApiError(401, "Not authenticated"));

    await expect(syncNativeDeviceProfile()).resolves.toBe("unauthorized");
    expect(plugin.clearProfile).toHaveBeenCalled();
  });

  it("keeps a still valid profile when minting fails for other reasons", async () => {
    const status = storedStatus({ expiresAtMs: NOW + 60 * 60 * 1000 });
    plugin.getStatus.mockResolvedValue(status);
    apiMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(syncNativeDeviceProfile()).resolves.toBe("failed");
    expect(getActiveNativeDeviceProfile()?.tokenId).toBe(7);
  });

  it("revokes and replaces the profile of the previous server", async () => {
    servers.currentId = "server-2";
    plugin.getStatus.mockResolvedValue(storedStatus());
    apiMock.mockResolvedValue(created(13));

    await expect(syncNativeDeviceProfile()).resolves.toBe("minted");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://one.example/api/auth/device-tokens/7",
      expect.objectContaining({
        method: "DELETE",
        credentials: "omit",
        headers: { Authorization: "Bearer session-1" },
      }),
    );
    expect(plugin.clearProfile).toHaveBeenCalled();
    expect(plugin.setProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "server-2",
        serverUrl: "https://two.example",
      }),
    );
  });

  it("revokes the token on logout before the session goes away", async () => {
    plugin.getStatus.mockResolvedValue(storedStatus());
    await syncNativeDeviceProfile();

    const retirement = retireNativeDeviceProfile();
    // The DELETE is already on its way, before AuthProvider revokes the session.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://one.example/api/auth/device-tokens/7",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(getActiveNativeDeviceProfile()).toBeNull();
    await retirement;
    expect(plugin.clearProfile).toHaveBeenCalled();
  });

  it("retires a profile it has not read yet", async () => {
    plugin.getStatus.mockResolvedValue(storedStatus());

    await retireNativeDeviceProfile();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plugin.clearProfile).toHaveBeenCalled();
  });

  it("drops a mint that finishes after logout", async () => {
    let resolveMint: (value: unknown) => void = () => {};
    apiMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMint = resolve;
      }),
    );
    const sync = syncNativeDeviceProfile();
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalled());

    const retirement = retireNativeDeviceProfile();
    resolveMint(created(14));

    await expect(sync).resolves.toBe("inactive");
    await retirement;
    expect(plugin.setProfile).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://one.example/api/auth/device-tokens/14",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(getActiveNativeDeviceProfile()).toBeNull();
  });

  it("pushes preference changes to an existing profile only", async () => {
    await updateNativeDeviceProfilePreferences();
    expect(plugin.updateProfile).not.toHaveBeenCalled();

    plugin.getStatus.mockResolvedValue(storedStatus());
    await syncNativeDeviceProfile();
    prefs.offlineKey = "profile-b";
    await updateNativeDeviceProfilePreferences();

    expect(plugin.updateProfile).toHaveBeenCalledWith({
      deliveryPolicy: "auto",
      offlineProfileKey: "profile-b",
    });
  });

  it.each([
    { capacitor: false, android: false, name: "web" },
    { capacitor: true, android: false, name: "iOS" },
    { capacitor: false, android: true, name: "Tauri or Android browser" },
  ])("does nothing on $name", async ({ capacitor, android }) => {
    runtime.capacitor = capacitor;
    runtime.android = android;

    await expect(syncNativeDeviceProfile()).resolves.toBe("inactive");
    await retireNativeDeviceProfile();
    await updateNativeDeviceProfilePreferences();
    subscribeNativeDeviceProfileChanges(() => {})();

    expect(apiMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    for (const method of Object.values(plugin)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("does nothing without a signed-in server", async () => {
    servers.list = [
      { id: "server-1", url: "https://one.example", token: null },
    ];

    await expect(syncNativeDeviceProfile()).resolves.toBe("inactive");
    expect(plugin.getStatus).not.toHaveBeenCalled();
  });
});

describe("native device authorization (D7)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    resetNativeDeviceProfileForTests();
    runtime.capacitor = true;
    runtime.android = true;
    servers.currentId = "server-1";
    servers.list = [
      { id: "server-1", url: "https://one.example", token: "session-1" },
    ];
    plugin.getStatus.mockResolvedValue(storedStatus());
  });

  it("covers device stream and artwork routes on the profile origin", async () => {
    expect(
      nativeDeviceTokenAuthorizes(
        "https://one.example/api/tracks/1/stream",
        "stream",
      ),
    ).toBe(false);

    await syncNativeDeviceProfile();
    const now = NOW;

    expect(
      nativeDeviceTokenAuthorizes(
        "https://one.example/api/tracks/by-entity/0b7c5a2e-1f53-4f06-9c55-3f1e6c3b8a10/stream?delivery=balanced",
        "stream",
        now,
      ),
    ).toBe(true);
    expect(
      nativeDeviceTokenAuthorizes(
        "https://one.example/api/albums/3/cover?size=512",
        "artwork",
        now,
      ),
    ).toBe(true);
    expect(
      nativeDeviceTokenAuthorizes(
        "https://one.example/api/federation/remote/streams/t1",
        "stream",
        now,
      ),
    ).toBe(false);
    expect(
      nativeDeviceTokenAuthorizes(
        "https://two.example/api/tracks/1/stream",
        "stream",
        now,
      ),
    ).toBe(false);
    expect(
      nativeDeviceTokenAuthorizes(
        "https://one.example/api/tracks/1/stream",
        "stream",
        EXPIRES_MS - 60_000,
      ),
    ).toBe(false);
  });
});
