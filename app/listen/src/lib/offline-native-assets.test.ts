import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  statMock,
  deleteFileMock,
  downloadFileMock,
  ensureAssetIndexMock,
  updateAssetIndexMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  statMock: vi.fn(),
  deleteFileMock: vi.fn().mockResolvedValue(undefined),
  downloadFileMock: vi.fn(),
  ensureAssetIndexMock: vi.fn(),
  updateAssetIndexMock: vi.fn(),
}));

vi.mock(import("@capacitor/core"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      convertFileSrc: (uri: string) => `capacitor://${uri}`,
      isNativePlatform: () => true,
      getPlatform: () => "android",
    },
  };
});

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    stat: statMock,
    deleteFile: deleteFileMock,
    downloadFile: downloadFileMock,
    mkdir: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiUrl: (path: string) => `https://api.example.test${path}`,
  getApiAuthHeaders: () => ({ Authorization: "Bearer test" }),
}));

vi.mock("@/lib/offline-storage", () => ({
  ensureOfflineNativeAssetIndexLoaded: ensureAssetIndexMock,
  getActiveOfflineProfileKey: vi.fn(),
  loadOfflineNativeAssetIndex: vi.fn(() => ({})),
  updateOfflineNativeAssetIndex: updateAssetIndexMock,
}));

import {
  assertNativeTrackIntegrity,
  cacheNativeTrackAsset,
} from "@/lib/offline-native-assets";

describe("assertNativeTrackIntegrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteFileMock.mockResolvedValue(undefined);
    ensureAssetIndexMock.mockResolvedValue({});
    apiMock.mockRejectedValue(new Error("playback resolution unavailable"));
  });
  it("rejects and deletes a 0-byte file even with no expected size on record", async () => {
    statMock.mockResolvedValue({ uri: "file:///track.flac", size: 0 });

    await expect(
      assertNativeTrackIntegrity("track.flac", null),
    ).rejects.toThrow("Offline copy failed integrity check");
    expect(deleteFileMock).toHaveBeenCalledWith({
      path: "track.flac",
      directory: "DATA",
    });
  });

  it("rejects and deletes a 0-byte file when an expected size is known", async () => {
    statMock.mockResolvedValue({ uri: "file:///track.flac", size: 0 });

    await expect(
      assertNativeTrackIntegrity("track.flac", 4096),
    ).rejects.toThrow("Offline copy failed integrity check");
  });

  it("rejects a size mismatch against a known expected size", async () => {
    statMock.mockResolvedValue({ uri: "file:///track.flac", size: 100 });

    await expect(
      assertNativeTrackIntegrity("track.flac", 4096),
    ).rejects.toThrow("Offline copy failed integrity check");
  });

  it("accepts a fully-written file matching the expected size", async () => {
    statMock.mockResolvedValue({ uri: "file:///track.flac", size: 4096 });

    await expect(
      assertNativeTrackIntegrity("track.flac", 4096),
    ).resolves.toEqual({ uri: "file:///track.flac", size: 4096 });
  });

  it("accepts a non-empty file when no expected size is on record", async () => {
    statMock.mockResolvedValue({ uri: "file:///track.flac", size: 4096 });

    await expect(
      assertNativeTrackIntegrity("track.flac", null),
    ).resolves.toEqual({ uri: "file:///track.flac", size: 4096 });
  });

  it("removes a completed native download when its profile was cancelled", async () => {
    let finishDownload: (() => void) | undefined;
    let reportStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    downloadFileMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDownload = resolve;
          reportStarted!();
        }),
    );
    statMock.mockResolvedValue({
      uri: "file:///offline-media/profile/track.m4a",
      size: 4096,
    });
    const controller = new AbortController();
    const pending = cacheNativeTrackAsset(
      "profile",
      {
        entity_uid: "track-1",
        title: "Track",
        artist: "Artist",
        format: "mp3",
        bitrate: 128,
        stream_url: "/stream/track-1",
        download_url: "/download/track-1",
      },
      controller.signal,
    );
    await started;

    controller.abort();
    finishDownload!();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(deleteFileMock).toHaveBeenCalledWith({
      path: "offline-media/profile/track-1.mp3",
      directory: "DATA",
    });
    expect(updateAssetIndexMock).not.toHaveBeenCalled();
  });
});
