import { describe, expect, it, vi } from "vitest";

import {
  loadReceiverSession,
  publishPlayCheckpoint,
  publishReceiverState,
} from "./receiver-client";

describe("receiver session client", () => {
  it("maps the scoped bootstrap response to receiver contracts", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "session-1",
          protocol_version: 1,
          appearance: {
            contractVersion: 1,
            skinId: "crate-red",
            preferredMode: "dark",
            resolvedMode: "dark",
            reducedMotion: false,
          },
          queue: {
            revision: 4,
            state_seq: 7,
            current_index: 0,
            current_time: 12.5,
            repeat_mode: "all",
            shuffle: true,
            items: [
              {
                item_id: "item-1",
                track_id: 42,
                title: "A very good song",
                artist: "The Artist",
                album: "The Album",
                duration: 180,
                quality: "FLAC 24/96",
                artwork_url: "https://images.example.test/cover.jpg",
                content_type: "audio/flac",
                metadata_url:
                  "https://api.example.test/api/cast/sessions/lease/items/item-1",
                spectrum_url:
                  "https://api.example.test/api/cast/sessions/lease/items/item-1/spectrum",
                stream_url:
                  "https://api.example.test/api/cast/sessions/lease/items/item-1/stream",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const session = await loadReceiverSession(
      "https://api.example.test/api/cast/sessions/lease",
      "session-1",
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/api/cast/sessions/lease",
      { cache: "no-store", credentials: "omit", mode: "cors" },
    );
    expect(session.queue).toMatchObject({
      queueRevision: 4,
      stateSeq: 7,
      currentIndex: 0,
      currentTime: 12.5,
      repeatMode: "all",
      shuffle: true,
      items: [
        {
          itemId: "item-1",
          track: { trackId: 42 },
          resources: {
            contentType: "audio/flac",
            artworkUrl: "https://images.example.test/cover.jpg",
            spectrumUrl:
              "https://api.example.test/api/cast/sessions/lease/items/item-1/spectrum",
          },
        },
      ],
    });
  });

  it("maps the API snake-case appearance contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "session-1",
          protocol_version: 1,
          appearance: {
            contract_version: 1,
            skin_id: "crate-red",
            preferred_mode: "light",
            resolved_mode: "light",
            reduced_motion: true,
          },
          queue: { items: [] },
        }),
        { status: 200 },
      ),
    );

    const session = await loadReceiverSession(
      "https://api.example.test/api/cast/sessions/lease",
      "session-1",
      fetcher,
    );

    expect(session.appearance).toEqual({
      contractVersion: 1,
      skinId: "crate-red",
      preferredMode: "light",
      resolvedMode: "light",
      reducedMotion: true,
    });
  });

  it("publishes lease-scoped receiver state and checkpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const bootstrapUrl =
      "https://api.example.test/api/cast/sessions/private-lease";

    await publishReceiverState(
      bootstrapUrl,
      { stateSeq: 7, currentIndex: 1, currentTime: 42.5 },
      fetcher,
    );
    await publishPlayCheckpoint(
      bootstrapUrl,
      {
        clientEventId: "play-1",
        itemId: "item-1",
        startedAt: "2026-09-15T00:00:00.000Z",
        endedAt: "2026-09-15T00:03:00.000Z",
        playedSeconds: 180,
        trackDurationSeconds: 185,
        completionRatio: 180 / 185,
        wasSkipped: false,
        wasCompleted: true,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `${bootstrapUrl}/state`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          state_seq: 7,
          current_index: 1,
          current_time: 42.5,
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `${bootstrapUrl}/checkpoints`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"client_event_id":"play-1"'),
      }),
    );
  });

  it("rejects mismatched sessions without including the lease in the error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "session-other",
          protocol_version: 1,
          appearance: {},
          queue: { items: [] },
        }),
        { status: 200 },
      ),
    );

    await expect(
      loadReceiverSession(
        "https://api.example.test/api/cast/sessions/private-lease",
        "session-1",
        fetcher,
      ),
    ).rejects.toThrow("CAST_SESSION_INVALID");
    await expect(
      loadReceiverSession(
        "https://api.example.test/api/cast/sessions/private-lease",
        "session-1",
        fetcher,
      ),
    ).rejects.not.toThrow("private-lease");
  });
});
