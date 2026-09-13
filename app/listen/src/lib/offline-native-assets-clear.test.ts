import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteFileMock,
  ensureOfflineNativeAssetIndexLoadedMock,
  saveOfflineNativeAssetIndexMock,
  updateOfflineNativeAssetIndexMock,
  getActiveOfflineProfileKeyMock,
  loadOfflineNativeAssetIndexMock,
} = vi.hoisted(() => ({
  deleteFileMock: vi.fn(),
  ensureOfflineNativeAssetIndexLoadedMock: vi.fn(),
  saveOfflineNativeAssetIndexMock: vi.fn(),
  updateOfflineNativeAssetIndexMock: vi.fn(),
  getActiveOfflineProfileKeyMock: vi.fn(() => "profile-1"),
  loadOfflineNativeAssetIndexMock: vi.fn(),
}));

vi.mock(import("@capacitor/core"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => true,
      getPlatform: () => "android",
    },
  };
});

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: { deleteFile: deleteFileMock },
}));

vi.mock("@/lib/offline-storage", () => ({
  ensureOfflineNativeAssetIndexLoaded: ensureOfflineNativeAssetIndexLoadedMock,
  getActiveOfflineProfileKey: getActiveOfflineProfileKeyMock,
  loadOfflineNativeAssetIndex: loadOfflineNativeAssetIndexMock,
  saveOfflineNativeAssetIndex: saveOfflineNativeAssetIndexMock,
  updateOfflineNativeAssetIndex: updateOfflineNativeAssetIndexMock,
}));

import {
  clearNativeOfflineAssets,
  deleteNativeCachedTrackAsset,
} from "@/lib/offline-native-assets";

describe("native offline asset deletion", () => {
  let persistedAssets: Record<
    string,
    { assetKey: string; path: string; state?: "ready" | "deleting" }
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    persistedAssets = {
      trackA: { assetKey: "trackA", path: "offline-media/track-a.flac" },
    };
    ensureOfflineNativeAssetIndexLoadedMock.mockImplementation(
      async () => persistedAssets,
    );
    loadOfflineNativeAssetIndexMock.mockImplementation(() => persistedAssets);
    deleteFileMock.mockResolvedValue(undefined);
    updateOfflineNativeAssetIndexMock.mockImplementation(
      async (_profileKey, mutate) => {
        persistedAssets = await mutate(persistedAssets);
      },
    );
  });

  it("marks every asset deleting before clear-all removes any file", async () => {
    deleteFileMock.mockImplementation(async () => {
      expect(persistedAssets.trackA?.state).toBe("deleting");
    });

    await clearNativeOfflineAssets("profile-1");

    expect(updateOfflineNativeAssetIndexMock).toHaveBeenCalledTimes(2);
    expect(deleteFileMock).toHaveBeenCalledWith({
      path: "offline-media/track-a.flac",
      directory: "DATA",
    });
    expect(saveOfflineNativeAssetIndexMock).not.toHaveBeenCalled();
    expect(persistedAssets).toEqual({});
  });

  it("persists a non-playable deletion marker before deleting a track file", async () => {
    deleteFileMock.mockRejectedValue(
      Object.assign(new Error("permission denied"), {
        code: "OS-PLUG-FILE-0007",
      }),
    );

    await expect(
      deleteNativeCachedTrackAsset("profile-1", "trackA"),
    ).rejects.toThrow("permission denied");

    expect(updateOfflineNativeAssetIndexMock).toHaveBeenCalledOnce();
    expect(persistedAssets.trackA).toEqual(
      expect.objectContaining({ state: "deleting" }),
    );
  });

  it("drops stale track metadata when the file is already missing", async () => {
    deleteFileMock.mockRejectedValue(
      Object.assign(new Error("file does not exist"), {
        code: "OS-PLUG-FILE-0008",
      }),
    );

    await expect(
      deleteNativeCachedTrackAsset("profile-1", "trackA"),
    ).resolves.toBeUndefined();

    expect(persistedAssets).toEqual({});
  });

  it("clears deleted entries but retains failures for a later retry", async () => {
    persistedAssets.trackB = {
      assetKey: "trackB",
      path: "offline-media/track-b.flac",
    };
    deleteFileMock.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("track-b.flac")) {
        throw Object.assign(new Error("file locked"), {
          code: "OS-PLUG-FILE-0013",
        });
      }
    });

    await expect(clearNativeOfflineAssets("profile-1")).rejects.toThrow(
      "file locked",
    );

    expect(persistedAssets).toEqual({
      trackB: {
        assetKey: "trackB",
        path: "offline-media/track-b.flac",
        state: "deleting",
      },
    });
  });

  it("never resolves a deleting asset as playable", async () => {
    persistedAssets.trackA!.state = "deleting";
    const { getNativeOfflinePlaybackUrl } = await import(
      "@/lib/offline-native-assets"
    );

    expect(getNativeOfflinePlaybackUrl("trackA")).toBeNull();
  });
});
