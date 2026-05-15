import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveOfflineProfileKeyFromStoredUser,
  getActiveOfflineProfileKey,
  getOfflineItemKey,
  getOfflineTrackManifestPaths,
  getOfflineTrackAssetKey,
  canonicalStreamPath,
  canonicalStreamUrl,
  loadOfflineSnapshot,
  normalizeOfflineSnapshot,
  saveOfflineSnapshot,
  setActiveOfflineProfileKey,
  summarizeOfflineSnapshot,
  buildAssetUsage,
  isOfflineBusy,
  getOfflineStateLabel,
  getOfflineActionLabel,
  type OfflineSnapshot,
} from "./offline";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("offline metadata helpers", () => {
  it("derives a profile key from the persisted user id", () => {
    localStorage.setItem("listen-auth-user-id", "42");

    const key = deriveOfflineProfileKeyFromStoredUser(
      "https://api.example.test",
    );

    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
  });

  it("round-trips the active offline profile key", () => {
    setActiveOfflineProfileKey("profile-1");
    expect(getActiveOfflineProfileKey()).toBe("profile-1");

    setActiveOfflineProfileKey(null);
    expect(getActiveOfflineProfileKey()).toBeNull();
  });

  it("loads and saves offline snapshots per profile", () => {
    const snapshot: OfflineSnapshot = {
      items: {
        [getOfflineItemKey("track", "storage-1")]: {
          key: getOfflineItemKey("track", "storage-1"),
          kind: "track",
          entityId: "storage-1",
          title: "Track",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          totalBytes: 1234,
          tracks: [
            {
              storage_id: "storage-1",
              title: "Track",
              artist: "Artist",
              stream_url: "/api/tracks/by-storage/storage-1/stream",
              download_url: "/api/tracks/by-storage/storage-1/download",
            },
          ],
        },
      },
    };

    saveOfflineSnapshot("profile-1", snapshot);

    expect(loadOfflineSnapshot("profile-1")).toEqual(snapshot);
  });

  it("summarizes offline state across items", () => {
    const summary = summarizeOfflineSnapshot({
      items: {
        "track:storage-1": {
          key: "track:storage-1",
          kind: "track",
          entityId: "storage-1",
          title: "Track A",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          totalBytes: 100,
          tracks: [
            {
              storage_id: "storage-1",
              title: "Track A",
              artist: "Artist",
              stream_url: "/api/tracks/by-storage/storage-1/stream",
              download_url: "/api/tracks/by-storage/storage-1/download",
            },
          ],
        },
        "album:14": {
          key: "album:14",
          kind: "album",
          entityId: "14",
          title: "Album",
          state: "error",
          trackCount: 2,
          readyTrackCount: 1,
          totalBytes: 300,
          tracks: [
            {
              storage_id: "storage-1",
              title: "Track A",
              artist: "Artist",
              stream_url: "/api/tracks/by-storage/storage-1/stream",
              download_url: "/api/tracks/by-storage/storage-1/download",
            },
            {
              storage_id: "storage-2",
              title: "Track B",
              artist: "Artist",
              stream_url: "/api/tracks/by-storage/storage-2/stream",
              download_url: "/api/tracks/by-storage/storage-2/download",
            },
          ],
        },
      },
    });

    expect(summary).toEqual({
      itemCount: 2,
      readyItemCount: 1,
      errorItemCount: 1,
      trackCount: 3,
      readyTrackCount: 2,
      totalBytes: 400,
    });
  });

  it("canonicalizes legacy track snapshots to entity_uid when available", () => {
    const snapshot = normalizeOfflineSnapshot({
      items: {
        "track:storage-1": {
          key: "track:storage-1",
          kind: "track",
          entityId: "storage-1",
          title: "Track",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          totalBytes: 1234,
          readyAssetKeys: ["storage-1"],
          tracks: [
            {
              entity_uid: "entity-1",
              storage_id: "storage-1",
              title: "Track",
              artist: "Artist",
              stream_url: "/api/tracks/by-entity/entity-1/stream",
              download_url: "/api/tracks/by-entity/entity-1/download",
            },
          ],
        },
      },
    });

    expect(snapshot.items["track:entity-1"]).toBeTruthy();
    expect(snapshot.items["track:entity-1"]?.entityId).toBe("entity-1");
    expect(snapshot.items["track:entity-1"]?.readyAssetKeys).toEqual([
      "entity-1",
    ]);
    expect(snapshot.items["track:entity-1"]?.readyStorageIds).toBeUndefined();
  });

  it("builds offline track manifest candidates preferring entity_uid", () => {
    expect(
      getOfflineTrackManifestPaths({
        entity_uid: "entity-1",
        storage_id: "storage-1",
      }),
    ).toEqual(["/api/offline/tracks/by-entity/entity-1/manifest"]);

    expect(getOfflineTrackManifestPaths("entity-legacy")).toEqual([
      "/api/offline/tracks/by-entity/entity-legacy/manifest",
      "/api/offline/tracks/by-storage/entity-legacy/manifest",
    ]);
  });
});

describe("getOfflineTrackAssetKey", () => {
  it("returns entity_uid from object", () => {
    expect(
      getOfflineTrackAssetKey({ entity_uid: "e1", storage_id: "s1" }),
    ).toBe("e1");
  });

  it("returns storage_id when no entity_uid", () => {
    expect(getOfflineTrackAssetKey({ storage_id: "s1" })).toBe("s1");
  });

  it("returns string directly", () => {
    expect(getOfflineTrackAssetKey("track-1")).toBe("track-1");
  });

  it("returns null for empty input", () => {
    expect(getOfflineTrackAssetKey(null)).toBeNull();
  });
});

describe("canonicalStreamPath", () => {
  it("returns entity stream path for entity_uid", () => {
    expect(canonicalStreamPath({ entity_uid: "e1" })).toContain(
      "/api/tracks/by-entity/e1/stream",
    );
  });

  it("returns legacy stream path for storage_id", () => {
    expect(canonicalStreamPath({ storage_id: "s1" })).toContain(
      "/api/tracks/by-storage/s1/stream",
    );
  });

  it("throws when no identity", () => {
    expect(() => canonicalStreamPath({})).toThrow();
  });
});

describe("canonicalStreamUrl", () => {
  it("returns url path for entity track", () => {
    expect(canonicalStreamUrl({ entity_uid: "e1" })).toContain(
      "/api/tracks/by-entity/e1/stream",
    );
  });
});

describe("buildAssetUsage", () => {
  it("counts asset usage across items", () => {
    const usage = buildAssetUsage({
      items: {
        "album:1": {
          key: "album:1",
          kind: "album",
          entityId: "1",
          title: "A",
          state: "ready",
          trackCount: 2,
          readyTrackCount: 2,
          tracks: [
            {
              entity_uid: "e1",
              title: "T1",
              artist: "A",
              stream_url: "",
              download_url: "",
            },
            {
              entity_uid: "e1",
              title: "T2",
              artist: "A",
              stream_url: "",
              download_url: "",
            },
          ],
        },
      },
    });
    expect(usage.get("e1")).toBe(2);
  });
});

describe("isOfflineBusy", () => {
  it("returns true for active states", () => {
    expect(isOfflineBusy("queued")).toBe(true);
    expect(isOfflineBusy("downloading")).toBe(true);
    expect(isOfflineBusy("syncing")).toBe(true);
  });

  it("returns false for idle/ready/error", () => {
    expect(isOfflineBusy("idle")).toBe(false);
    expect(isOfflineBusy("ready")).toBe(false);
    expect(isOfflineBusy("error")).toBe(false);
  });
});

describe("getOfflineStateLabel", () => {
  it("returns labels for states", () => {
    expect(getOfflineStateLabel("ready")).toBe("Available offline");
    expect(getOfflineStateLabel("error")).toBe("Offline copy failed");
    expect(getOfflineStateLabel("idle")).toBeNull();
  });
});

describe("getOfflineActionLabel", () => {
  it("returns action labels", () => {
    expect(getOfflineActionLabel("ready")).toBe("Remove offline copy");
    expect(getOfflineActionLabel("error")).toBe("Retry offline copy");
    expect(getOfflineActionLabel("idle")).toBe("Make available offline");
  });
});
