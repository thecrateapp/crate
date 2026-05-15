import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  resolveMaybeApiAssetUrl: vi.fn(
    (url: string | null | undefined) => url ?? null,
  ),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`API ${status}`);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/library-routes", () => ({
  albumCoverApiUrl: vi.fn(() => undefined),
  artistPhotoApiUrl: vi.fn(() => undefined),
}));

import { ApiError, api } from "@/lib/api";
import {
  checkDiscoveryAvailable,
  fetchAlbumRadio,
  fetchArtistRadio,
  fetchHomePlaylistRadio,
  fetchInfiniteContinuation,
  fetchPlaylistRadio,
  fetchRadioContinuation,
  fetchTrackRadio,
  sendRadioFeedback,
  startShapedRadio,
} from "@/lib/radio";
import type { PlaySource } from "@/contexts/player-types";

const mockApi = vi.mocked(api);

describe("fetchRadioContinuation", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("uses the shaped radio session endpoint when a session is active", async () => {
    mockApi.mockResolvedValue({
      session_id: "sess-1",
      tracks: [
        {
          track_id: 42,
          entity_uid: "123e4567-e89b-12d3-a456-426614174042",
          storage_id: "track-42",
          title: "Axe to Fall",
          artist: "Converge",
          album: "Axe to Fall",
          album_id: 7,
          distance: 0.12,
        },
      ],
    });

    const controller = new AbortController();
    const source: PlaySource = {
      type: "radio",
      name: "Discovery Radio",
      radio: {
        seedType: "discovery",
        shapedSessionId: "sess-1",
      },
    };

    const tracks = await fetchRadioContinuation(source, 12, {
      signal: controller.signal,
    });

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/next",
      "POST",
      { session_id: "sess-1", count: 12 },
      { signal: controller.signal },
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174042",
      entityUid: "123e4567-e89b-12d3-a456-426614174042",
      libraryTrackId: 42,
      title: "Axe to Fall",
      artist: "Converge",
    });
  });

  it("falls back to legacy track continuation by entity UID when present", async () => {
    mockApi.mockResolvedValue({
      session: {
        type: "track",
        seed: {
          track_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
        },
      },
      tracks: [
        {
          track_id: 7,
          track_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
          title: "Locust Reign",
          artist: "Converge",
          album: "Petitioning the Empty Sky",
        },
      ],
    });

    const source: PlaySource = {
      type: "radio",
      name: "Track Radio",
      radio: {
        seedType: "track",
        seedEntityUid: "123e4567-e89b-12d3-a456-426614174000",
      },
    };

    const tracks = await fetchRadioContinuation(source, 9);

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=9&entity_uid=123e4567-e89b-12d3-a456-426614174000",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174000",
      entityUid: "123e4567-e89b-12d3-a456-426614174000",
      libraryTrackId: 7,
    });
  });

  it("treats string UUID seed ids as entity UIDs for legacy continuations", async () => {
    mockApi.mockResolvedValue({
      session: { type: "track" },
      tracks: [
        {
          track_id: 7,
          track_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
          title: "Locust Reign",
          artist: "Converge",
          album: "Petitioning the Empty Sky",
        },
      ],
    });

    const source: PlaySource = {
      type: "radio",
      name: "Track Radio",
      radio: {
        seedType: "track",
        seedId: "123e4567-e89b-12d3-a456-426614174000",
      },
    };

    const tracks = await fetchRadioContinuation(source, 9);

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=9&entity_uid=123e4567-e89b-12d3-a456-426614174000",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174000",
      entityUid: "123e4567-e89b-12d3-a456-426614174000",
    });
  });
});

describe("seeded radio wrappers", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("starts artist radio via the shaped radio session endpoint", async () => {
    mockApi.mockResolvedValue({
      session_id: "artist-sess",
      seed_label: "Converge",
      tracks: [],
    });

    const result = await fetchArtistRadio(7, "Converge");

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      {
        mode: "seeded",
        seed_type: "artist",
        seed_value: "7",
      },
      { signal: undefined },
    );
    expect(result.source.radio).toMatchObject({
      seedType: "artist",
      seedId: 7,
      shapedSessionId: "artist-sess",
    });
  });

  it("starts home playlist radio via the shaped radio session endpoint", async () => {
    mockApi.mockResolvedValue({
      session_id: "home-sess",
      seed_label: "Daily Discovery",
      tracks: [],
    });

    const result = await fetchHomePlaylistRadio({
      playlistId: "daily-discovery",
      playlistName: "Daily Discovery",
    });

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      {
        mode: "seeded",
        seed_type: "home-playlist",
        seed_value: "daily-discovery",
      },
      { signal: undefined },
    );
    expect(result.source.radio).toMatchObject({
      seedType: "home-playlist",
      seedId: "daily-discovery",
      shapedSessionId: "home-sess",
    });
  });

  it("starts track radio with libraryTrackId", async () => {
    mockApi.mockResolvedValue({
      session_id: "t1",
      seed_label: "A",
      tracks: [],
    });
    await fetchTrackRadio({ libraryTrackId: 99, title: "Song" });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      { mode: "seeded", seed_type: "track", seed_value: "99" },
      { signal: undefined },
    );
  });

  it("starts track radio with entityUid", async () => {
    mockApi.mockResolvedValue({
      session_id: "t2",
      seed_label: "B",
      tracks: [],
    });
    await fetchTrackRadio({ entityUid: "uuid-1", title: "Song" });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      { mode: "seeded", seed_type: "track", seed_value: "uuid-1" },
      { signal: undefined },
    );
  });

  it("starts track radio with path", async () => {
    mockApi.mockResolvedValue({
      session_id: "t3",
      seed_label: "C",
      tracks: [],
    });
    await fetchTrackRadio({ path: "/music/a.flac", title: "Song" });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      { mode: "seeded", seed_type: "track", seed_value: "/music/a.flac" },
      { signal: undefined },
    );
  });

  it("throws when track radio has no seed", async () => {
    await expect(fetchTrackRadio({ title: "Song" })).rejects.toThrow(
      "track radio requires libraryTrackId, entityUid or path",
    );
  });

  it("starts album radio", async () => {
    mockApi.mockResolvedValue({
      session_id: "al1",
      seed_label: "Album",
      tracks: [],
    });
    await fetchAlbumRadio({ albumId: 3, artistName: "A", albumName: "B" });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      { mode: "seeded", seed_type: "album", seed_value: "3" },
      { signal: undefined },
    );
  });

  it("starts playlist radio", async () => {
    mockApi.mockResolvedValue({
      session_id: "pl1",
      seed_label: "P",
      tracks: [],
    });
    await fetchPlaylistRadio({ playlistId: 5, playlistName: "P" });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      { mode: "seeded", seed_type: "playlist", seed_value: "5" },
      { signal: undefined },
    );
  });
});

describe("startShapedRadio", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("returns null only for unavailable radio responses", async () => {
    mockApi.mockRejectedValue(new ApiError(422, "Unavailable"));

    await expect(startShapedRadio("discovery")).resolves.toBeNull();
  });

  it("surfaces operational failures instead of reporting missing history", async () => {
    mockApi.mockRejectedValue(new ApiError(500, "API 500"));

    await expect(startShapedRadio("discovery")).rejects.toThrow("API 500");
  });

  it("starts seeded shaped radio", async () => {
    mockApi.mockResolvedValue({
      session_id: "sess-1",
      seed_label: "Seed",
      tracks: [
        {
          track_id: 1,
          entity_uid: "u1",
          title: "T",
          artist: "A",
          distance: 0.1,
        },
      ],
    });
    const result = await startShapedRadio("seeded", "artist", "7");
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("sess-1");
    expect(result!.source.radio!.seedType).toBe("artist");
    expect(result!.source.radio!.seedId).toBe(7);
  });

  it("returns null for 404 unavailable", async () => {
    mockApi.mockRejectedValue(new ApiError(404, "Not found"));
    await expect(startShapedRadio("discovery")).resolves.toBeNull();
  });
});

describe("fetchRadioContinuation edge cases", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("returns empty for missing radio", async () => {
    const source: PlaySource = { type: "radio", name: "R" };
    expect(await fetchRadioContinuation(source, 5)).toEqual([]);
  });

  it("returns empty for artist radio with non-numeric seedId", async () => {
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "artist", seedId: "bad" as any },
    };
    expect(await fetchRadioContinuation(source, 5)).toEqual([]);
  });

  it("uses track_id when seedId is a number", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 7, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "track", seedId: 7 },
    };
    const tracks = await fetchRadioContinuation(source, 3);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=3&track_id=7",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({ libraryTrackId: 7 });
  });

  it("uses path when seedId contains a slash", async () => {
    mockApi.mockResolvedValue({ tracks: [] });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "track", seedId: "/music/a.flac" },
    };
    await fetchRadioContinuation(source, 3);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=3&path=%2Fmusic%2Fa.flac",
      "GET",
      undefined,
      { signal: undefined },
    );
  });

  it("uses seedPath when present", async () => {
    mockApi.mockResolvedValue({ tracks: [] });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "track", seedPath: "/music/b.flac" },
    };
    await fetchRadioContinuation(source, 3);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=3&path=%2Fmusic%2Fb.flac",
      "GET",
      undefined,
      { signal: undefined },
    );
  });

  it("uses legacy seedStorageId", async () => {
    mockApi.mockResolvedValue({ tracks: [] });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "track", seedStorageId: "st-1" },
    };
    await fetchRadioContinuation(source, 3);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=3&storage_id=st-1",
      "GET",
      undefined,
      { signal: undefined },
    );
  });

  it("returns empty when no usable seed", async () => {
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "track", seedId: null as any },
    };
    expect(await fetchRadioContinuation(source, 3)).toEqual([]);
  });

  it("returns empty for album radio when seedId is null", async () => {
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "album", seedId: null as any },
    };
    expect(await fetchRadioContinuation(source, 3)).toEqual([]);
  });

  it("continues album radio", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 8, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "album", seedId: 4 },
    };
    const tracks = await fetchRadioContinuation(source, 5);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/album/4?limit=5",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({ libraryTrackId: 8 });
  });

  it("continues playlist radio with numeric seed", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 9, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "playlist", seedId: 2 },
    };
    const tracks = await fetchRadioContinuation(source, 5);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/playlist/2?limit=5",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({ libraryTrackId: 9 });
  });

  it("continues playlist radio with string seed", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 10, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "playlist", seedId: "daily" },
    };
    const tracks = await fetchRadioContinuation(source, 5);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/home-playlist/daily?limit=5",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({ libraryTrackId: 10 });
  });
});

describe("fetchInfiniteContinuation", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("returns empty when no radio", async () => {
    const source: PlaySource = { type: "album", name: "A" };
    expect(await fetchInfiniteContinuation(source, 5)).toEqual([]);
  });

  it("continues album infinite", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 1, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "album",
      name: "A",
      radio: { seedType: "album", seedId: 3 },
    };
    const tracks = await fetchInfiniteContinuation(source, 4);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/album/3?limit=4",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks).toHaveLength(1);
  });

  it("continues playlist infinite", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 2, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "playlist",
      name: "P",
      radio: { seedType: "playlist", seedId: 5 },
    };
    const tracks = await fetchInfiniteContinuation(source, 4);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/playlist/5?limit=4",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks).toHaveLength(1);
  });

  it("continues home-playlist infinite", async () => {
    mockApi.mockResolvedValue({
      tracks: [{ track_id: 3, title: "T", artist: "A" }],
    });
    const source: PlaySource = {
      type: "playlist",
      name: "P",
      radio: { seedType: "playlist", seedId: "home" },
    };
    const tracks = await fetchInfiniteContinuation(source, 4);
    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/home-playlist/home?limit=4",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks).toHaveLength(1);
  });
});

describe("requestRadio 404 handling", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("returns empty tracks on 404 for album radio", async () => {
    mockApi.mockRejectedValue(new ApiError(404, "Not found"));
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "album", seedId: 1 },
    };
    expect(await fetchRadioContinuation(source, 5)).toEqual([]);
  });

  it("throws on non-404 errors", async () => {
    mockApi.mockRejectedValue(new ApiError(500, "Server error"));
    const source: PlaySource = {
      type: "radio",
      name: "R",
      radio: { seedType: "album", seedId: 1 },
    };
    await expect(fetchRadioContinuation(source, 5)).rejects.toThrow("API 500");
  });
});

describe("sendRadioFeedback", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("sends like feedback", async () => {
    mockApi.mockResolvedValue(undefined);
    await sendRadioFeedback("sess-1", 42, "like");
    expect(mockApi).toHaveBeenCalledWith("/api/radio/feedback", "POST", {
      session_id: "sess-1",
      track_id: 42,
      action: "like",
    });
  });

  it("silently catches errors", async () => {
    mockApi.mockRejectedValue(new Error("fail"));
    await expect(
      sendRadioFeedback("sess-1", 42, "dislike"),
    ).resolves.toBeUndefined();
  });
});

describe("checkDiscoveryAvailable", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("returns availability from API", async () => {
    mockApi.mockResolvedValue({ available: true });
    expect(await checkDiscoveryAvailable()).toBe(true);
  });

  it("returns false on error", async () => {
    mockApi.mockRejectedValue(new Error("fail"));
    expect(await checkDiscoveryAvailable()).toBe(false);
  });
});
