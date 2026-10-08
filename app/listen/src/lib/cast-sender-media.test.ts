import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCastTicketRequest,
  buildWebQueueLoad,
  resolveCastMedia,
} from "./cast-sender-media";

describe("cast sender media", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prefers the stable library entity reference for ticket requests", () => {
    expect(
      buildCastTicketRequest({
        id: "track",
        entityUid: "track-entity",
        title: "Track",
        artist: "Artist",
      }),
    ).toMatchObject({
      purpose: "google_cast",
      track_entity_uid: "track-entity",
      delivery: "auto",
    });
  });

  it("describes an unreachable Cast endpoint instead of leaking a fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    await expect(
      resolveCastMedia({
        stream_url: "https://stream.example/track",
        metadata_url: "https://stream.example/metadata",
        expires_at: "2030-01-01T00:00:00Z",
        delivery_policy: "direct",
      }),
    ).rejects.toThrow(
      "Could not reach the Cast media endpoint. Check that this Crate server is reachable over HTTPS.",
    );
  });

  it("retries while receiver-safe media is still preparing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 425, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 425, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stream_url: "https://stream.example/track",
            title: "Track",
            artist: "Artist",
          }),
          { status: 200 },
        ),
      );

    const mediaPromise = resolveCastMedia({
      stream_url: "https://stream.example/track",
      metadata_url: "https://stream.example/metadata",
      expires_at: "2030-01-01T00:00:00Z",
      delivery_policy: "auto",
    });
    await vi.runAllTimersAsync();

    await expect(mediaPromise).resolves.toMatchObject({ title: "Track" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("builds a full CAF queue with scoped bootstrap data", () => {
    class MediaInfo {
      customData?: unknown;
      metadata?: unknown;
      duration?: number;
      constructor(
        public contentId: string,
        public contentType: string,
      ) {}
    }
    class QueueItem {
      autoplay?: boolean;
      startTime?: number;
      constructor(public media: MediaInfo) {}
    }
    const chromeCast = {
      Image: class {
        constructor(public url: string) {}
      },
      media: {
        MediaInfo,
        MusicTrackMediaMetadata: class {},
        QueueItem,
        RepeatMode: {
          OFF: "OFF",
          ALL: "ALL",
          SINGLE: "SINGLE",
        },
      },
    };
    const session = {
      session_id: "session-1",
      lease: "private-lease",
      bootstrap_url: "https://api.example/api/cast/sessions/private-lease",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 2,
        state_seq: 1,
        current_index: 1,
        current_time: 23,
        repeat_mode: "all" as const,
        shuffle: false,
        items: [
          {
            item_id: "one",
            title: "One",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/one",
            metadata_url: "https://api.example/one/meta",
          },
          {
            item_id: "two",
            title: "Two",
            artist: "Artist",
            album: "Album",
            duration: 180,
            artwork_url: "https://images.example/two.jpg",
            content_type: "audio/mp4",
            stream_url: "https://api.example/two",
            metadata_url: "https://api.example/two/meta",
          },
        ],
      },
    };

    const load = buildWebQueueLoad(session, chromeCast as never);

    expect(load).toMatchObject({
      repeatMode: "ALL",
      startIndex: 1,
      startTime: 23,
    });
    expect(load.items).toHaveLength(2);
    expect(load.items[1]).toMatchObject({
      autoplay: true,
      startTime: 23,
      media: {
        contentId: "https://api.example/two",
        contentType: "audio/mp4",
        duration: 180,
        customData: {
          crateCast: {
            protocolVersion: 1,
            sessionId: "session-1",
            bootstrapUrl: "https://api.example/api/cast/sessions/private-lease",
            itemId: "two",
          },
        },
      },
    });
  });
});
