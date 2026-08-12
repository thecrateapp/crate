import { describe, expect, it } from "vitest";

import { initialJamSessionState, jamSessionReducer } from "@/pages/jam-reducer";

describe("Jam authoritative queue state", () => {
  it("hydrates stable queue items and pending requests from room data", () => {
    const next = jamSessionReducer(initialJamSessionState, {
      type: "APPLY_ROOM_DATA",
      payload: {
        id: "room",
        host_user_id: 1,
        name: "Friday",
        status: "active",
        visibility: "public",
        is_permanent: false,
        queue_mode: "manual",
        created_at: "2026-01-01T00:00:00Z",
        queue: [
          {
            id: "item-1",
            track: { id: "track-1", title: "One", artist: "Artist" },
            vote_count: 2,
            voted_by_me: true,
          },
        ],
        requests: [
          {
            id: "request-1",
            status: "pending",
            track: { id: "track-2", title: "Two", artist: "Artist" },
          },
        ],
        members: [],
        events: [],
      },
    });

    expect(next.queueItems[0]?.id).toBe("item-1");
    expect(next.queueItems[0]?.vote_count).toBe(2);
    expect(next.pendingRequests[0]?.id).toBe("request-1");
  });

  it("rehydrates artwork when the authoritative queue contains an old URL", () => {
    const next = jamSessionReducer(initialJamSessionState, {
      type: "APPLY_ROOM_DATA",
      payload: {
        id: "room",
        host_user_id: 1,
        name: "Friday",
        status: "active",
        visibility: "public",
        is_permanent: false,
        created_at: "2026-01-01T00:00:00Z",
        queue: [
          {
            id: "item-1",
            track: {
              id: "track-1",
              title: "One",
              artist: "Artist",
              album: "Album",
              globalAlbumUid: "global-album-1",
              albumCover:
                "https://old-session.example/api/catalog/albums/global-album-1/cover?media_ticket=expired",
            },
            vote_count: 0,
            voted_by_me: false,
          },
        ],
        members: [],
        events: [],
      },
    });

    expect(next.queueItems[0]?.track.albumCover).toBe(
      "/api/catalog/albums/global-album-1/cover?size=512&format=webp",
    );
    expect(next.sharedQueue[0]?.albumCover).toBe(
      "/api/catalog/albums/global-album-1/cover?size=512&format=webp",
    );
  });

  it("updates a vote without losing the queue item", () => {
    const state = {
      ...initialJamSessionState,
      queueItems: [
        {
          id: "item-1",
          track: { id: "track-1", title: "One", artist: "Artist" },
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    };

    const next = jamSessionReducer(state, {
      type: "QUEUE_VOTE",
      payload: { queueItemId: "item-1", voted: true, voteCount: 1 },
    });

    expect(next.queueItems).toEqual([
      expect.objectContaining({
        id: "item-1",
        vote_count: 1,
        voted_by_me: true,
      }),
    ]);
  });

  it("moves a voted queued track ahead of lower-voted tracks locally", () => {
    const first = { id: "track-1", title: "One", artist: "Artist" };
    const second = { id: "track-2", title: "Two", artist: "Artist" };
    const state = {
      ...initialJamSessionState,
      queueItems: [
        {
          id: "item-1",
          track: first,
          status: "queued" as const,
          position: 0,
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "item-2",
          track: second,
          status: "queued" as const,
          position: 1,
          vote_count: 0,
          voted_by_me: false,
        },
      ],
      sharedQueue: [first, second],
    };

    const next = jamSessionReducer(state, {
      type: "QUEUE_VOTE",
      payload: { queueItemId: "item-2", voted: true, voteCount: 1 },
    });

    expect(next.queueItems.map((item) => item.id)).toEqual([
      "item-2",
      "item-1",
    ]);
    expect(next.sharedQueue.map((track) => track.id)).toEqual([
      "track-2",
      "track-1",
    ]);
  });

  it("removes an authoritative queue item by its stable id", () => {
    const state = jamSessionReducer(initialJamSessionState, {
      type: "APPLY_ROOM_DATA",
      payload: {
        id: "room",
        host_user_id: 1,
        name: "Friday",
        status: "active",
        visibility: "public",
        is_permanent: false,
        created_at: "2026-01-01T00:00:00Z",
        queue: [
          {
            id: "item-1",
            track: { id: "track-1", title: "One", artist: "Artist" },
            vote_count: 0,
            voted_by_me: false,
          },
        ],
        members: [],
        events: [],
      },
    });

    const next = jamSessionReducer(state, {
      type: "QUEUE_REMOVE_ITEM",
      payload: "item-1",
    });

    expect(next.queueItems).toEqual([]);
    expect(next.sharedQueue).toEqual([]);
  });
});
