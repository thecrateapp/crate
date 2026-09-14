import { describe, expect, it, vi } from "vitest";

import { loadReceiverSession } from "./receiver-client";

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
          },
        },
      ],
    });
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
