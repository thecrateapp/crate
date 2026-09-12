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

import { clearNativeOfflineAssets } from "@/lib/offline-native-assets";

describe("clearNativeOfflineAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const assets = {
      trackA: { assetKey: "trackA", path: "offline-media/track-a.flac" },
    };
    ensureOfflineNativeAssetIndexLoadedMock.mockResolvedValue(assets);
    deleteFileMock.mockResolvedValue(undefined);
    updateOfflineNativeAssetIndexMock.mockImplementation(
      async (_profileKey, mutate) => {
        await mutate(assets);
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
  });
});
