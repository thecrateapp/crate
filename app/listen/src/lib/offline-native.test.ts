import { afterEach, describe, expect, it, vi } from "vitest";

const filesystemMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  getUri: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
}));
const { excludeFromBackupMock, verifyAssetsMock } = vi.hoisted(() => ({
  excludeFromBackupMock: vi.fn(),
  verifyAssetsMock: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    convertFileSrc: (uri: string) => `capacitor://localhost/${uri}`,
    getPlatform: () => "android",
    isNativePlatform: () => true,
  },
  registerPlugin: () => ({
    excludeFromBackup: excludeFromBackupMock,
    verifyAssets: verifyAssetsMock,
  }),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: filesystemMock,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isAndroidNative: true,
  isIosBrowser: false,
  isNative: true,
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiFetch: vi.fn(),
  apiUrl: (path: string) => `https://api.example.test${path}`,
  getApiAuthHeaders: () => ({}),
  getApiBase: () => "https://api.example.test",
}));

describe("native offline playback bootstrap", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("loads persisted native media assets before resolving playback URLs", async () => {
    localStorage.setItem("listen-auth-user-id", "42");
    filesystemMock.getUri.mockResolvedValue({
      uri: "file:///current-container/offline-media/profile/song.m4a",
    });
    filesystemMock.readFile.mockImplementation(async ({ path }) => {
      if (String(path).includes("offline-index-")) {
        return { data: JSON.stringify({ items: {} }) };
      }
      if (String(path).includes("offline-assets-")) {
        return {
          data: JSON.stringify({
            "track-entity-1": {
              assetKey: "track-entity-1",
              entityUid: "track-entity-1",
              storageId: "storage-1",
              path: "offline-media/profile/song.m4a",
              uri: "file:///offline-media/profile/song.m4a",
              playbackUrl:
                "capacitor://localhost/_capacitor_file_/offline-media/profile/song.m4a",
              byteLength: 1234,
            },
          }),
        };
      }
      return { data: "{}" };
    });

    const { getOfflineNativePlaybackUrl, primeOfflineRuntimeProfile } =
      await import("@/lib/offline");

    expect(
      getOfflineNativePlaybackUrl({ entityUid: "track-entity-1" }),
    ).toBeNull();

    await primeOfflineRuntimeProfile("https://api.example.test");

    expect(getOfflineNativePlaybackUrl({ entityUid: "track-entity-1" })).toBe(
      "capacitor://localhost/file:///current-container/offline-media/profile/song.m4a",
    );
    expect(
      getOfflineNativePlaybackUrl({ entityUid: "track-entity-1" }, undefined, {
        target: "android-native",
      }),
    ).toBe("file:///current-container/offline-media/profile/song.m4a");
  });

  it("verifies a bounded asset batch in one native bridge call", async () => {
    verifyAssetsMock.mockResolvedValueOnce({
      assets: [
        {
          path: "offline-media/profile/one.m4a",
          exists: true,
          size: 1234,
          valid: true,
        },
        {
          path: "offline-media/profile/two.m4a",
          exists: false,
          size: 0,
          valid: false,
        },
      ],
    });
    const { verifyNativeOfflineAssets } = await import("@/lib/offline-native");

    const results = await verifyNativeOfflineAssets([
      {
        path: "offline-media/profile/one.m4a",
        expectedBytes: 1234,
      },
      {
        path: "offline-media/profile/two.m4a",
        expectedBytes: 4567,
      },
    ]);

    expect(verifyAssetsMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.valid)).toEqual([true, false]);
  });

  it("chunks integrity checks at the native bridge batch limit", async () => {
    verifyAssetsMock.mockImplementation(async ({ assets }) => ({
      assets: assets.map(({ path }: { path: string }) => ({
        path,
        exists: true,
        size: 128,
        valid: true,
      })),
    }));
    const { verifyNativeOfflineAssets } = await import("@/lib/offline-native");
    const assets = Array.from({ length: 501 }, (_, index) => ({
      path: `offline-media/track-${index}.m4a`,
      expectedBytes: 128,
    }));

    const results = await verifyNativeOfflineAssets(assets);

    expect(results).toHaveLength(501);
    expect(verifyAssetsMock).toHaveBeenCalledTimes(2);
    expect(verifyAssetsMock.mock.calls[0]?.[0].assets).toHaveLength(500);
    expect(verifyAssetsMock.mock.calls[1]?.[0].assets).toHaveLength(1);
    expect(filesystemMock.stat).not.toHaveBeenCalled();
  });

  it("protects iOS offline media from device backups", async () => {
    excludeFromBackupMock.mockResolvedValue({ excluded: true });
    const { excludeNativeOfflineAssetFromBackup } = await import(
      "@/lib/offline-native"
    );

    await expect(
      excludeNativeOfflineAssetFromBackup("offline-media/profile/song.m4a"),
    ).resolves.toBeUndefined();
    expect(excludeFromBackupMock).toHaveBeenCalledWith({
      path: "offline-media/profile/song.m4a",
    });
  });
});
