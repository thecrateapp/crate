import { beforeEach, describe, expect, it, vi } from "vitest";

const { cachedAssetsMock, hydrateOfflineProfileStateMock } = vi.hoisted(() => ({
  cachedAssetsMock: vi.fn(),
  hydrateOfflineProfileStateMock: vi.fn(),
}));

vi.mock("@/lib/offline-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-assets")>()),
  hasCachedTrackAssets: cachedAssetsMock,
}));
vi.mock("./offline-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./offline-storage")>()),
  hydrateOfflineProfileState: hydrateOfflineProfileStateMock,
}));

import { hasOfflinePlaybackContent } from "./offline";

describe("hasOfflinePlaybackContent", () => {
  beforeEach(() => {
    cachedAssetsMock.mockReset();
    hydrateOfflineProfileStateMock.mockReset();
  });

  it("requires at least one asset confirmed on disk", async () => {
    hydrateOfflineProfileStateMock.mockResolvedValue({
      items: {
        "album:7": {
          key: "album:7",
          kind: "album",
          entityId: "7",
          title: "Album",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          readyAssetKeys: ["entity-1"],
          tracks: [
            {
              entity_uid: "entity-1",
              title: "Track",
              artist: "Artist",
              stream_url: "/api/stream",
              download_url: "/api/download",
            },
          ],
        },
      },
    });
    cachedAssetsMock.mockResolvedValue(new Set());

    await expect(hasOfflinePlaybackContent("profile-1")).resolves.toBe(false);
    expect(cachedAssetsMock).toHaveBeenCalledWith(
      "profile-1",
      expect.arrayContaining([
        expect.objectContaining({ entity_uid: "entity-1" }),
      ]),
    );
  });

  it("recognizes a confirmed asset from partially downloaded content", async () => {
    hydrateOfflineProfileStateMock.mockResolvedValue({
      items: {
        "playlist:3": {
          key: "playlist:3",
          kind: "playlist",
          entityId: "3",
          title: "Playlist",
          state: "error",
          trackCount: 2,
          readyTrackCount: 1,
          readyAssetKeys: ["entity-2"],
          tracks: [
            {
              entity_uid: "entity-1",
              title: "Missing",
              artist: "Artist",
              stream_url: "/api/stream/1",
              download_url: "/api/download/1",
            },
            {
              entity_uid: "entity-2",
              title: "Cached",
              artist: "Artist",
              stream_url: "/api/stream/2",
              download_url: "/api/download/2",
            },
          ],
        },
      },
    });
    cachedAssetsMock.mockResolvedValue(new Set(["entity-2"]));

    await expect(hasOfflinePlaybackContent("profile-1")).resolves.toBe(true);
    expect(cachedAssetsMock.mock.calls[0]?.[1]).toHaveLength(1);
    expect(cachedAssetsMock.mock.calls[0]?.[1][0].entity_uid).toBe("entity-2");
  });
});
