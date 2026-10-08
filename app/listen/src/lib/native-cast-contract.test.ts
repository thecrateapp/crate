import { describe, expect, it } from "vitest";

import { buildNativeQueuePayload } from "./cast-sender-media";

const session = {
  session_id: "session-1",
  lease: "receiver-lease",
  bootstrap_url: "https://api.example/api/cast/sessions/receiver-lease",
  receiver_application_id: "ABCD1234",
  queue: {
    revision: 3,
    state_seq: 7,
    current_index: 1,
    current_time: 42.5,
    repeat_mode: "all" as const,
    shuffle: true,
    items: [
      {
        item_id: "item-1",
        title: "One",
        artist: "Artist",
        album: "Album",
        duration: 180,
        content_type: "audio/mpeg",
        stream_url: "https://api.example/one",
        metadata_url: "https://api.example/one/meta",
        artwork_url: "https://api.example/one/artwork",
      },
      {
        item_id: "item-2",
        title: "Two",
        artist: "Artist",
        content_type: "audio/mp4",
        stream_url: "https://api.example/two",
        metadata_url: "https://api.example/two/meta",
      },
    ],
  },
};

describe("native Cast bridge contract", () => {
  it("serializes the same receiver-owned queue contract as the web sender", () => {
    expect(buildNativeQueuePayload(session)).toEqual({
      protocolVersion: 1,
      sessionId: "session-1",
      bootstrapUrl: session.bootstrap_url,
      currentIndex: 1,
      currentTime: 42.5,
      repeatMode: "all",
      items: [
        {
          stableId: "item-1",
          streamUrl: "https://api.example/one",
          contentType: "audio/mpeg",
          title: "One",
          artist: "Artist",
          album: "Album",
          artworkUrl: "https://api.example/one/artwork",
          duration: 180,
          customData: {
            crateCast: {
              protocolVersion: 1,
              sessionId: "session-1",
              bootstrapUrl: session.bootstrap_url,
              itemId: "item-1",
            },
          },
        },
        expect.objectContaining({
          stableId: "item-2",
          streamUrl: "https://api.example/two",
          contentType: "audio/mp4",
          title: "Two",
        }),
      ],
    });
    expect(JSON.stringify(buildNativeQueuePayload(session))).not.toContain(
      "Authorization",
    );
  });
});
