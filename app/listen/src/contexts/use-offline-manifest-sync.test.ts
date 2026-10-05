import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, cacheTrackAssetMock, commitSnapshotMock, snapshotRef } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    cacheTrackAssetMock: vi.fn(),
    commitSnapshotMock: vi.fn(),
    snapshotRef: { current: { items: {} as Record<string, unknown> } },
  }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

vi.mock("@/lib/offline", () => ({
  buildAssetUsage: vi.fn(() => new Map()),
  cacheTrackAsset: cacheTrackAssetMock,
  deleteCachedTrackAsset: vi.fn(),
  ensureOfflineStorageBudget: vi.fn(),
  getOfflineAssetsNeedingRefresh: vi.fn(async () => new Set(["track-1"])),
  getOfflineItemKey: () => "album:1",
  getOfflineTrackAssetKey: () => "track-1",
  hasCachedTrackAssets: vi.fn(async () => new Set(["track-1"])),
}));

vi.mock("@/lib/offline-scheduler", () => ({
  runBoundedOfflineTasks: async (
    tracks: unknown[],
    task: (track: unknown) => Promise<void>,
  ) => {
    for (const track of tracks) await task(track);
    return { cancelled: false };
  },
  waitForOfflineTransferPermission: vi.fn(),
}));

import { useOfflineManifestSync } from "@/contexts/use-offline-manifest-sync";

describe("useOfflineManifestSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotRef.current = {
      items: {
        "album:1": {
          key: "album:1",
          kind: "album",
          entityId: "1",
          title: "Album",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          contentVersion: "old-version",
          updatedAt: "2026-01-01T00:00:00Z",
          totalBytes: 100,
          readyAssetKeys: ["track-1"],
          tracks: [],
        },
      },
    };
    commitSnapshotMock.mockImplementation((next) => {
      snapshotRef.current = {
        ...snapshotRef.current,
        ...next,
        items: { ...snapshotRef.current.items, ...next.items },
      };
    });
    apiMock.mockResolvedValue({
      kind: "album",
      id: 1,
      title: "Album",
      content_version: "new-version",
      updated_at: "2026-09-29T00:00:00Z",
      track_count: 1,
      total_bytes: 128,
      tracks: [
        {
          entity_uid: "track-1",
          title: "Track",
          artist: "Artist",
          stream_url: "/stream/track-1",
          download_url: "/download/track-1",
          byte_length: 128,
        },
      ],
    });
  });

  it("refreshes a cached stale asset before advancing the manifest version", async () => {
    const { result } = renderHook(() =>
      useOfflineManifestSync({
        supported: true,
        profileKey: "profile",
        snapshotRef: snapshotRef as never,
        transferAbortRef: { current: null },
        commitSnapshot: commitSnapshotMock,
      }),
    );

    await act(async () => {
      await result.current("album", 1, "/manifest");
    });

    expect(cacheTrackAssetMock).toHaveBeenCalledOnce();
    expect(snapshotRef.current.items["album:1"]).toMatchObject({
      state: "ready",
      contentVersion: "new-version",
      updatedAt: "2026-09-29T00:00:00Z",
    });
  });

  it("keeps the old manifest version if refreshing its cached asset fails", async () => {
    cacheTrackAssetMock.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() =>
      useOfflineManifestSync({
        supported: true,
        profileKey: "profile",
        snapshotRef: snapshotRef as never,
        transferAbortRef: { current: null },
        commitSnapshot: commitSnapshotMock,
      }),
    );

    await act(async () => {
      await result.current("album", 1, "/manifest");
    });

    expect(cacheTrackAssetMock).toHaveBeenCalledOnce();
    expect(snapshotRef.current.items["album:1"]).toMatchObject({
      state: "error",
      contentVersion: "old-version",
      updatedAt: "2026-01-01T00:00:00Z",
      readyAssetKeys: ["track-1"],
    });
  });
});
