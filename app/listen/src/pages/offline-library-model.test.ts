import { describe, expect, it } from "vitest";

import { buildOfflineLibraryGroups } from "@/pages/offline-library-model";

describe("buildOfflineLibraryGroups", () => {
  it("includes only confirmed cached tracks and marks them offline-only", () => {
    const groups = buildOfflineLibraryGroups([
      {
        key: "album:1",
        kind: "album",
        entityId: "1",
        title: "Album",
        state: "error",
        trackCount: 2,
        readyTrackCount: 1,
        readyAssetKeys: ["entity-1"],
        tracks: [
          {
            entity_uid: "entity-1",
            storage_id: "storage-1",
            track_id: 11,
            title: "Cached Song",
            artist: "Band",
            album: "Album",
            duration: 180,
            stream_url: "/api/cached-stream",
            download_url: "/api/download",
          },
          {
            entity_uid: "entity-2",
            title: "Missing Song",
            artist: "Band",
            stream_url: "/api/missing-stream",
            download_url: "/api/download",
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tracks).toHaveLength(1);
    expect(groups[0]?.tracks[0]).toMatchObject({
      id: "offline:entity-1",
      entityUid: "entity-1",
      path: "storage-1",
      libraryTrackId: 11,
      title: "Cached Song",
      artist: "Band",
      offlineOnly: true,
      origin: "local",
    });
    expect(groups[0]?.tracks[0]).not.toHaveProperty("stream_url");
  });

  it("supports ready snapshots created before per-track ready keys existed", () => {
    const groups = buildOfflineLibraryGroups([
      {
        key: "track:storage-1",
        kind: "track",
        entityId: "storage-1",
        title: "Track",
        state: "ready",
        trackCount: 1,
        readyTrackCount: 1,
        tracks: [
          {
            storage_id: "storage-1",
            title: "Track",
            artist: "Artist",
            stream_url: "/api/stream",
            download_url: "/api/download",
          },
        ],
      },
    ]);

    expect(groups[0]?.tracks[0]).toMatchObject({
      id: "offline:storage-1",
      path: "storage-1",
      offlineOnly: true,
    });
  });

  it("fails closed for a cached track without a stable asset identity", () => {
    expect(
      buildOfflineLibraryGroups([
        {
          key: "album:1",
          kind: "album",
          entityId: "1",
          title: "Album",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          tracks: [
            {
              title: "Track",
              artist: "Artist",
              stream_url: "/api/stream",
              download_url: "/api/download",
            },
          ],
        },
      ]),
    ).toEqual([]);
  });
});
