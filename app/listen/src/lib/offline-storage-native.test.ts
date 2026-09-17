import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteFileMock, getUriMock, renameMock, writeFileMock, readFileMock } =
  vi.hoisted(() => ({
    deleteFileMock: vi.fn(),
    getUriMock: vi.fn(),
    renameMock: vi.fn(),
    writeFileMock: vi.fn(),
    readFileMock: vi.fn(),
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
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    deleteFile: deleteFileMock,
    getUri: getUriMock,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: readFileMock,
    rename: renameMock,
    writeFile: writeFileMock,
  },
}));

import {
  ensureOfflineNativeAssetIndexLoaded,
  loadOfflineNativeAssetIndex,
  saveOfflineNativeAssetIndex,
  updateOfflineNativeAssetIndex,
} from "@/lib/offline-storage";

describe("updateOfflineNativeAssetIndex (native)", () => {
  let writtenFiles: Map<string, string>;
  let writeDelays: number[];

  beforeEach(() => {
    writtenFiles = new Map();
    writeDelays = [];
    readFileMock.mockImplementation(async ({ path }: { path: string }) => ({
      data: writtenFiles.get(path) ?? null,
    }));
    deleteFileMock.mockImplementation(async ({ path }: { path: string }) => {
      writtenFiles.delete(path);
    });
    renameMock.mockImplementation(
      async ({ from, to }: { from: string; to: string }) => {
        const data = writtenFiles.get(from);
        if (data == null) throw new Error(`missing file: ${from}`);
        writtenFiles.set(to, data);
        writtenFiles.delete(from);
      },
    );
    writeFileMock.mockImplementation(
      async ({ path, data }: { path: string; data: string }) => {
        // Simulate slow disk I/O: whichever write is issued first can
        // still take longer than one issued after it. Without reading
        // fresh from inside the serialized write slot, that lets an
        // earlier-issued write finish last and silently revert whatever
        // a later, faster mutation for a different key already wrote.
        const delay = writeDelays.shift() ?? 0;
        if (delay > 0)
          await new Promise((resolve) => setTimeout(resolve, delay));
        writtenFiles.set(path, data);
      },
    );
    getUriMock.mockImplementation(async ({ path }: { path: string }) => ({
      uri: `file:///current-container/${path}`,
    }));
  });

  it("keeps both mutations even when the first-issued write finishes last", async () => {
    writeDelays = [20, 0];

    const trackA = updateOfflineNativeAssetIndex("profile-1", (current) => ({
      ...current,
      trackA: { assetKey: "trackA" } as never,
    }));
    const trackB = updateOfflineNativeAssetIndex("profile-1", (current) => ({
      ...current,
      trackB: { assetKey: "trackB" } as never,
    }));

    await Promise.all([trackA, trackB]);

    const finalRaw = writtenFiles.get(
      "offline-meta/offline-assets-profile-1.json",
    );
    const final = JSON.parse(finalRaw ?? "{}");
    expect(final).toHaveProperty("trackA");
    expect(final).toHaveProperty("trackB");
  });

  it("promotes a verified temporary file instead of overwriting metadata in place", async () => {
    await updateOfflineNativeAssetIndex("atomic-profile", (current) => ({
      ...current,
      trackA: { assetKey: "trackA" } as never,
    }));

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "offline-meta/offline-assets-atomic-profile.json.next",
      }),
    );
    expect(writeFileMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: "offline-meta/offline-assets-atomic-profile.json",
      }),
    );
    expect(renameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "offline-meta/offline-assets-atomic-profile.json.next",
        to: "offline-meta/offline-assets-atomic-profile.json",
      }),
    );
  });

  it("recovers valid metadata from the latest crash-safe candidate", async () => {
    writtenFiles.set(
      "offline-meta/offline-assets-recovery-profile.json",
      "{truncated",
    );
    writtenFiles.set(
      "offline-meta/offline-assets-recovery-profile.json.next",
      JSON.stringify({ latest: { assetKey: "latest" } }),
    );
    writtenFiles.set(
      "offline-meta/offline-assets-recovery-profile.json.backup",
      JSON.stringify({ previous: { assetKey: "previous" } }),
    );

    await expect(
      ensureOfflineNativeAssetIndexLoaded("recovery-profile"),
    ).resolves.toEqual({ latest: { assetKey: "latest" } });
  });

  it("restores the previous metadata when promotion fails", async () => {
    const path = "offline-meta/offline-assets-rollback-profile.json";
    writtenFiles.set(
      path,
      JSON.stringify({ previous: { assetKey: "previous" } }),
    );
    renameMock.mockImplementation(
      async ({ from, to }: { from: string; to: string }) => {
        if (from.endsWith(".next")) throw new Error("promotion failed");
        const data = writtenFiles.get(from);
        if (data == null) throw new Error(`missing file: ${from}`);
        writtenFiles.set(to, data);
        writtenFiles.delete(from);
      },
    );

    await expect(
      updateOfflineNativeAssetIndex("rollback-profile", (current) => ({
        ...current,
        latest: { assetKey: "latest" } as never,
      })),
    ).rejects.toThrow("promotion failed");

    expect(JSON.parse(writtenFiles.get(path) ?? "{}")).toEqual({
      previous: { assetKey: "previous" },
    });
  });

  it("does not publish a failed atomic update to the in-memory index", async () => {
    await updateOfflineNativeAssetIndex("failed-update-profile", () => ({
      previous: { assetKey: "previous" } as never,
    }));
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      updateOfflineNativeAssetIndex("failed-update-profile", (current) => ({
        ...current,
        latest: { assetKey: "latest" } as never,
      })),
    ).rejects.toThrow("disk full");

    expect(loadOfflineNativeAssetIndex("failed-update-profile")).toEqual({
      previous: { assetKey: "previous" },
    });
  });

  it("does not publish a failed direct save to the in-memory index", async () => {
    await saveOfflineNativeAssetIndex("failed-save-profile", {
      previous: { assetKey: "previous" } as never,
    });
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      saveOfflineNativeAssetIndex("failed-save-profile", {
        latest: { assetKey: "latest" } as never,
      }),
    ).rejects.toThrow("disk full");

    expect(loadOfflineNativeAssetIndex("failed-save-profile")).toEqual({
      previous: { assetKey: "previous" },
    });
  });

  it("propagates native read failures and retries the loader later", async () => {
    readFileMock.mockRejectedValueOnce(new Error("filesystem unavailable"));

    await expect(
      ensureOfflineNativeAssetIndexLoaded("read-error-profile"),
    ).rejects.toThrow("filesystem unavailable");

    writtenFiles.set(
      "offline-meta/offline-assets-read-error-profile.json",
      JSON.stringify({ trackA: { assetKey: "trackA", path: "track-a.flac" } }),
    );
    await expect(
      ensureOfflineNativeAssetIndexLoaded("read-error-profile"),
    ).resolves.toEqual(
      expect.objectContaining({
        trackA: expect.objectContaining({
          uri: "file:///current-container/track-a.flac",
        }),
      }),
    );
  });

  it("rebuilds runtime locators when the native container path changes", async () => {
    writtenFiles.set(
      "offline-meta/offline-assets-relocated-profile.json",
      JSON.stringify({
        trackA: {
          assetKey: "trackA",
          path: "offline-media/profile/track-a.flac",
          uri: "file:///old-container/track-a.flac",
          playbackUrl: "capacitor://old-container/track-a.flac",
        },
      }),
    );

    const assets =
      await ensureOfflineNativeAssetIndexLoaded("relocated-profile");

    expect(assets.trackA).toEqual(
      expect.objectContaining({
        uri: "file:///current-container/offline-media/profile/track-a.flac",
      }),
    );
    expect(assets.trackA?.playbackUrl).not.toContain("old-container");
  });

  it("persists only relocatable paths, never container-specific URLs", async () => {
    await saveOfflineNativeAssetIndex("portable-profile", {
      trackA: {
        assetKey: "trackA",
        path: "offline-media/profile/track-a.flac",
        uri: "file:///current-container/track-a.flac",
        playbackUrl: "capacitor://current-container/track-a.flac",
      },
    });

    const persisted = JSON.parse(
      writtenFiles.get("offline-meta/offline-assets-portable-profile.json") ??
        "{}",
    );
    expect(persisted.trackA.path).toBe("offline-media/profile/track-a.flac");
    expect(persisted.trackA).not.toHaveProperty("uri");
    expect(persisted.trackA).not.toHaveProperty("playbackUrl");
  });
});
