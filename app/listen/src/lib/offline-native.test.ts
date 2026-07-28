import { afterEach, describe, expect, it, vi } from "vitest";

const filesystemMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(),
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
}));
const verifyAssetsMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    convertFileSrc: (uri: string) => `capacitor://localhost/${uri}`,
    getPlatform: () => "android",
    isNativePlatform: () => true,
  },
  registerPlugin: () => ({
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
      "capacitor://localhost/_capacitor_file_/offline-media/profile/song.m4a",
    );
    expect(
      getOfflineNativePlaybackUrl({ entityUid: "track-entity-1" }, undefined, {
        target: "android-native",
      }),
    ).toBe("file:///offline-media/profile/song.m4a");
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
});
