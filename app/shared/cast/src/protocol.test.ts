import { describe, expect, it } from "vitest";

import {
  CAST_PROTOCOL_NAMESPACE,
  CAST_PROTOCOL_VERSION,
  parseCastProtocolMessage,
  redactCastProtocolValue,
  type CastQueueMutationMessage,
  type CastReceiverStatusMessage,
} from "./protocol";

describe("Cast protocol", () => {
  it("uses a stable versioned namespace", () => {
    expect(CAST_PROTOCOL_NAMESPACE).toBe("urn:x-cast:app.cratemusic.crate.v1");
    expect(CAST_PROTOCOL_VERSION).toBe(1);
  });

  it("parses a queue replacement and ignores additive fields", () => {
    const result = parseCastProtocolMessage({
      version: 1,
      type: "queue.replace",
      sessionId: "session-1",
      mutationId: "mutation-1",
      expectedRevision: 4,
      queue: {
        revision: 5,
        currentIndex: 0,
        currentTime: 37.5,
        repeatMode: "all",
        shuffle: false,
        items: [
          {
            itemId: "item-1",
            title: "Track",
            artist: "Artist",
            album: "Album",
            contentType: "audio/mpeg",
            streamUrl: "https://api.example.test/stream?lease=secret",
            metadataUrl: "https://api.example.test/meta?lease=secret",
            duration: 180,
          },
        ],
      },
      futureField: "ignored",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("queue.replace");
    if (result.value.type === "queue.replace") {
      expect(result.value.queue.items).toHaveLength(1);
    }
  });

  it.each([
    [
      "queue.insert",
      {
        index: 2,
        item: {
          itemId: "item-2",
          title: "Second",
          artist: "Artist",
          contentType: "audio/aac",
          streamUrl: "https://api.example.test/stream",
          metadataUrl: "https://api.example.test/meta",
        },
      },
    ],
    ["queue.remove", { itemId: "item-2" }],
    ["queue.move", { itemId: "item-2", toIndex: 0 }],
    ["queue.clear", {}],
    ["queue.set-repeat", { repeatMode: "one" }],
    ["queue.set-shuffle", { shuffle: true }],
  ])("parses the %s queue mutation", (operationType, operation) => {
    const result = parseCastProtocolMessage({
      version: 1,
      type: "queue.mutate",
      sessionId: "session-1",
      mutationId: "mutation-1",
      expectedRevision: 7,
      operation: { type: operationType, ...operation },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const message = result.value as CastQueueMutationMessage;
      expect(message.expectedRevision).toBe(7);
      expect(message.mutationId).toBe("mutation-1");
    }
  });

  it("parses a bounded appearance update", () => {
    const result = parseCastProtocolMessage({
      version: 1,
      type: "appearance.update",
      sessionId: "session-1",
      appearance: {
        contractVersion: 1,
        skinId: "crate-red",
        preferredMode: "system",
        resolvedMode: "dark",
        reducedMotion: true,
        artworkPalette: ["#112233", "#aabbcc"],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        appearance: {
          skinId: "crate-red",
          resolvedMode: "dark",
        },
      },
    });
  });

  it("parses receiver status without requiring signed resource URLs", () => {
    const result = parseCastProtocolMessage({
      version: 1,
      type: "receiver.status",
      sessionId: "session-1",
      revision: 8,
      currentIndex: 2,
      currentTime: 12.25,
      playerState: "BUFFERING",
      consecutiveFailures: 1,
      error: {
        code: "MEDIA_RETRYING",
        recoverable: true,
        itemId: "item-3",
        attempt: 2,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const status = result.value as CastReceiverStatusMessage;
      expect(status.error?.code).toBe("MEDIA_RETRYING");
    }
  });

  it("rejects unsupported protocol versions", () => {
    expect(
      parseCastProtocolMessage({ version: 2, type: "receiver.ready" }),
    ).toEqual({
      ok: false,
      error: "UNSUPPORTED_VERSION",
    });
  });

  it("rejects malformed and unknown messages", () => {
    expect(parseCastProtocolMessage(null)).toEqual({
      ok: false,
      error: "INVALID_MESSAGE",
    });
    expect(
      parseCastProtocolMessage({ version: 1, type: "queue.destroy" }),
    ).toEqual({
      ok: false,
      error: "UNKNOWN_MESSAGE_TYPE",
    });
    expect(
      parseCastProtocolMessage({
        version: 1,
        type: "queue.mutate",
        sessionId: "session-1",
        mutationId: "mutation-1",
        expectedRevision: -1,
        operation: { type: "queue.clear" },
      }),
    ).toEqual({
      ok: false,
      error: "INVALID_MESSAGE",
    });
  });

  it("redacts leases, signed URLs, and token-like values recursively", () => {
    expect(
      redactCastProtocolValue({
        lease: "opaque-secret",
        streamUrl: "https://api.example.test/stream?ticket=secret",
        nested: {
          authorization: "Bearer secret",
          message: "safe",
        },
      }),
    ).toEqual({
      lease: "[REDACTED]",
      streamUrl: "https://api.example.test/stream",
      nested: {
        authorization: "[REDACTED]",
        message: "safe",
      },
    });
  });
});
