import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteFileMock,
  ensureOfflineNativeAssetIndexLoadedMock,
  saveOfflineNativeAssetIndexMock,
  updateOfflineNativeAssetIndexMock,
} = vi.hoisted(() => ({
  deleteFileMock: vi.fn(),
  ensureOfflineNativeAssetIndexLoadedMock: vi.fn(),
  saveOfflineNativeAssetIndexMock: vi.fn(),
  updateOfflineNativeAssetIndexMock: vi.fn(),
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
  getActiveOfflineProfileKey: vi.fn(),
  loadOfflineNativeAssetIndex: vi.fn(() => ({})),
  saveOfflineNativeAssetIndex: saveOfflineNativeAssetIndexMock,
  updateOfflineNativeAssetIndex: updateOfflineNativeAssetIndexMock,
}));

import {
  clearNativeOfflineAssets,
  deleteNativeCachedTrackAsset,
} from "@/lib/offline-native-assets";

describe("native offline asset deletion", () => {
  let persistedAssets: Record<string, { assetKey: string; path: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    persistedAssets = {
      trackA: { assetKey: "trackA", path: "offline-media/track-a.flac" },
    };
    ensureOfflineNativeAssetIndexLoadedMock.mockImplementation(
      async () => persistedAssets,
    );
    deleteFileMock.mockResolvedValue(undefined);
    updateOfflineNativeAssetIndexMock.mockImplementation(
      async (_profileKey, mutate) => {
        persistedAssets = await mutate(persistedAssets);
      },
    );
  });

  it("deletes files and clears metadata inside one serialized index mutation", async () => {
    await clearNativeOfflineAssets("profile-1");

    expect(updateOfflineNativeAssetIndexMock).toHaveBeenCalledOnce();
    expect(deleteFileMock).toHaveBeenCalledWith({
      path: "offline-media/track-a.flac",
      directory: "DATA",
    });
    expect(saveOfflineNativeAssetIndexMock).not.toHaveBeenCalled();
    expect(persistedAssets).toEqual({});
  });

  it("retains track metadata and rejects when its file cannot be deleted", async () => {
    deleteFileMock.mockRejectedValue(
      Object.assign(new Error("permission denied"), {
        code: "OS-PLUG-FILE-0007",
      }),
    );

    await expect(
      deleteNativeCachedTrackAsset("profile-1", "trackA"),
    ).rejects.toThrow("permission denied");

    expect(updateOfflineNativeAssetIndexMock).not.toHaveBeenCalled();
    expect(persistedAssets).toHaveProperty("trackA");
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
      },
    });
  });
});
