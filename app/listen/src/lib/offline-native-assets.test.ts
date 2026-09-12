import { describe, expect, it, vi } from "vitest";

const { statMock, deleteFileMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  deleteFileMock: vi.fn().mockResolvedValue(undefined),
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
  Filesystem: {
    stat: statMock,
    deleteFile: deleteFileMock,
  },
}));

import { assertNativeTrackIntegrity } from "@/lib/offline-native-assets";

describe("assertNativeTrackIntegrity", () => {
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
});
