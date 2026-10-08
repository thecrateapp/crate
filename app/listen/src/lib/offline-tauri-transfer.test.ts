import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getApiBaseMock,
  getStoredAuthUserIdMock,
  getOfflineIdentityForServerMock,
  getCurrentServerMock,
  getCurrentServerIdMock,
  invokeMock,
} = vi.hoisted(() => ({
  getApiBaseMock: vi.fn(() => "https://crate.example.test"),
  getStoredAuthUserIdMock: vi.fn(() => "42"),
  getOfflineIdentityForServerMock: vi.fn(() => ({
    schemaVersion: 1,
    serverId: "server-a",
    serverUrl: "https://crate.example.test",
    userId: 42,
    profileKey: "profile-a",
    generation: 7,
  })),
  getCurrentServerMock: vi.fn(() => ({
    id: "server-a",
    url: "https://crate.example.test",
  })),
  getCurrentServerIdMock: vi.fn(() => "server-a"),
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ getApiBase: getApiBaseMock }));
vi.mock("@/lib/auth-user-storage", () => ({
  getStoredAuthUserId: getStoredAuthUserIdMock,
}));
vi.mock("@/lib/offline-identity", () => ({
  getOfflineIdentityForServer: getOfflineIdentityForServerMock,
}));
vi.mock("@/lib/server-store", () => ({
  getCurrentServer: getCurrentServerMock,
  getCurrentServerId: getCurrentServerIdMock,
}));

import { downloadTauriOfflineAsset } from "@/lib/offline-tauri-transfer";

describe("downloadTauriOfflineAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__crateTauriInvoke = invokeMock;
    invokeMock.mockResolvedValue(undefined);
  });

  it("registers a transfer to the verified server identity before downloading", async () => {
    await downloadTauriOfflineAsset({
      profileKey: "profile-a",
      assetKey: "entity:track-1",
      url: "https://crate.example.test/api/tracks/track-1/stream",
      path: "offline-media/profile-a/track-1.part.mp3",
      headers: { Authorization: "Bearer test" },
    });

    const [registerCall, downloadCall, unregisterCall] = invokeMock.mock.calls;
    expect(registerCall?.[0]).toBe("register_offline_transfer");
    expect(downloadCall?.[0]).toBe("download_offline_media");
    expect(unregisterCall?.[0]).toBe("unregister_offline_transfer");
    expect(registerCall?.[1]?.scope).toMatchObject({
      serverId: "server-a",
      userId: 42,
      profileKey: "profile-a",
      generation: 7,
      assetKey: "entity:track-1",
    });
    expect(downloadCall?.[1]?.scope).toEqual(registerCall?.[1]?.scope);
  });

  it("waits for native cancellation before resolving an aborted transfer", async () => {
    let rejectDownload: ((error: Error) => void) | undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "download_offline_media") {
        return new Promise((_resolve, reject) => {
          rejectDownload = reject;
        });
      }
      return Promise.resolve(undefined);
    });
    const controller = new AbortController();
    const pending = downloadTauriOfflineAsset({
      profileKey: "profile-a",
      assetKey: "entity:track-1",
      url: "https://crate.example.test/api/tracks/track-1/stream",
      path: "offline-media/profile-a/track-1.part.mp3",
      headers: {},
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "download_offline_media",
        expect.any(Object),
      );
    });
    controller.abort();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "cancel_offline_transfer",
        expect.any(Object),
      );
    });
    rejectDownload?.(new Error("Offline download cancelled"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeMock).toHaveBeenCalledWith(
      "unregister_offline_transfer",
      expect.any(Object),
    );
  });

  it("rejects transfers for a stale or mismatched local identity", async () => {
    getOfflineIdentityForServerMock.mockReturnValueOnce({
      schemaVersion: 1,
      serverId: "server-a",
      serverUrl: "https://crate.example.test",
      userId: 42,
      profileKey: "profile-other",
      generation: 7,
    });

    await expect(
      downloadTauriOfflineAsset({
        profileKey: "profile-a",
        assetKey: "entity:track-1",
        url: "https://crate.example.test/api/tracks/track-1/stream",
        path: "offline-media/profile-a/track-1.part.mp3",
        headers: {},
      }),
    ).rejects.toThrow("verified active identity");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
