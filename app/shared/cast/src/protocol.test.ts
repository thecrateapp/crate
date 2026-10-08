import { describe, expect, it } from "vitest";

import {
  CAST_PROTOCOL_NAMESPACE,
  CAST_PROTOCOL_VERSION,
  MAX_CAST_QUEUE_ITEMS,
  parseCastProtocolMessage,
  redactCastProtocolValue,
  type CastQueueMutationMessage,
  type CastReceiverStatusMessage,
} from "./protocol";

function queueItem(itemId = "item-1") {
  return {
    itemId,
    track: { trackId: 7, trackEntityUid: "track-uid-7" },
    title: "Track",
    artist: "Artist",
    album: "Album",
    duration: 180,
    resources: {
      contentType: "audio/mpeg",
      streamUrl:
        "https://api.example.test/api/cast/sessions/lease-secret/items/item-1/stream",
      metadataUrl:
        "https://api.example.test/api/cast/sessions/lease-secret/items/item-1",
    },
  };
}

function queueSnapshot() {
  return {
    queueRevision: 5,
    stateSeq: 12,
    currentIndex: 0,
    currentTime: 37.5,
    repeatMode: "all",
    shuffle: false,
    items: [queueItem()],
  };
}

describe("Cast protocol", () => {
  it("uses a stable versioned namespace", () => {
    expect(CAST_PROTOCOL_NAMESPACE).toBe("urn:x-cast:app.cratemusic.crate.v1");
    expect(CAST_PROTOCOL_VERSION).toBe(1);
  });

  it("parses a queue replacement and ignores additive fields", () => {
    const result = parseCastProtocolMessage({
      version: 1,
      messageId: "message-1",
      type: "queue.replace",
      sessionId: "session-1",
      mutationId: "mutation-1",
      expectedQueueRevision: 4,
      queue: queueSnapshot(),
      futureField: "ignored",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("queue.replace");
    if (result.value.type === "queue.replace") {
      expect(result.value.queue.items).toHaveLength(1);
      expect(result.value.queue.items[0].track.trackId).toBe(7);
      expect(result.value.expectedQueueRevision).toBe(4);
    }
  });

  it.each([
    ["queue.insert", { index: 2, item: queueItem("item-2") }],
    ["queue.remove", { itemId: "item-2" }],
    ["queue.move", { itemId: "item-2", toIndex: 0 }],
    ["queue.clear", {}],
    ["queue.set-repeat", { repeatMode: "one" }],
    ["queue.set-shuffle", { shuffle: true }],
  ])("parses the %s queue mutation", (operationType, operation) => {
    const result = parseCastProtocolMessage({
      version: 1,
      messageId: "message-1",
      type: "queue.mutate",
      sessionId: "session-1",
      mutationId: "mutation-1",
      expectedQueueRevision: 7,
      operation: { type: operationType, ...operation },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const message = result.value as CastQueueMutationMessage;
      expect(message.expectedQueueRevision).toBe(7);
      expect(message.mutationId).toBe("mutation-1");
    }
  });

  it("parses queue acknowledgements and authoritative snapshots", () => {
    const acknowledgement = parseCastProtocolMessage({
      version: 1,
      messageId: "ack-1",
      replyTo: "message-1",
      type: "queue.ack",
      sessionId: "session-1",
      mutationId: "mutation-1",
      queueRevision: 8,
      stateSeq: 13,
    });
    const snapshot = parseCastProtocolMessage({
      version: 1,
      messageId: "snapshot-1",
      replyTo: "message-2",
      type: "queue.snapshot",
      sessionId: "session-1",
      reason: "conflict",
      queue: queueSnapshot(),
    });

    expect(acknowledgement).toMatchObject({
      ok: true,
      value: { replyTo: "message-1", queueRevision: 8 },
    });
    expect(snapshot).toMatchObject({
      ok: true,
      value: { reason: "conflict", queue: { queueRevision: 5 } },
    });
  });

  it("parses a bounded appearance update", () => {
    const result = parseCastProtocolMessage({
      version: 1,
      messageId: "message-1",
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

  it("keeps queue revisions separate from dynamic state sequence", () => {
    const result = parseCastProtocolMessage({
      version: 1,
      messageId: "message-1",
      type: "receiver.status",
      sessionId: "session-1",
      queueRevision: 8,
      stateSeq: 43,
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
      expect(status.queueRevision).toBe(8);
      expect(status.stateSeq).toBe(43);
      expect(status.error?.code).toBe("MEDIA_RETRYING");
    }
  });

  it("requires message correlation for every message", () => {
    expect(
      parseCastProtocolMessage({ version: 1, type: "receiver.ready" }),
    ).toEqual({ ok: false, error: "INVALID_MESSAGE" });
  });

  it("rejects unsupported protocol versions", () => {
    expect(
      parseCastProtocolMessage({
        version: 2,
        messageId: "message-1",
        type: "receiver.ready",
      }),
    ).toEqual({ ok: false, error: "UNSUPPORTED_VERSION" });
  });

  it("rejects malformed and unknown messages", () => {
    expect(parseCastProtocolMessage(null)).toEqual({
      ok: false,
      error: "INVALID_MESSAGE",
    });
    expect(
      parseCastProtocolMessage({
        version: 1,
        messageId: "message-1",
        type: "queue.destroy",
      }),
    ).toEqual({ ok: false, error: "UNKNOWN_MESSAGE_TYPE" });
    expect(
      parseCastProtocolMessage({
        version: 1,
        messageId: "message-1",
        type: "queue.mutate",
        sessionId: "session-1",
        mutationId: "mutation-1",
        expectedQueueRevision: -1,
        operation: { type: "queue.clear" },
      }),
    ).toEqual({ ok: false, error: "INVALID_MESSAGE" });
  });

  it("rejects duplicate item ids and oversized queues", () => {
    const base = {
      version: 1,
      messageId: "message-1",
      type: "queue.replace",
      sessionId: "session-1",
      mutationId: "mutation-1",
      expectedQueueRevision: 4,
    };
    expect(
      parseCastProtocolMessage({
        ...base,
        queue: {
          ...queueSnapshot(),
          items: [queueItem("duplicate"), queueItem("duplicate")],
        },
      }),
    ).toEqual({ ok: false, error: "INVALID_MESSAGE" });
    expect(
      parseCastProtocolMessage({
        ...base,
        queue: {
          ...queueSnapshot(),
          items: Array.from({ length: MAX_CAST_QUEUE_ITEMS + 1 }, (_, index) =>
            queueItem(`item-${index}`),
          ),
        },
      }),
    ).toEqual({ ok: false, error: "INVALID_MESSAGE" });
  });

  it("bounds capabilities and item fields", () => {
    expect(
      parseCastProtocolMessage({
        version: 1,
        messageId: "message-1",
        type: "receiver.ready",
        capabilities: Array.from({ length: 33 }, (_, index) => `cap-${index}`),
      }),
    ).toEqual({ ok: false, error: "INVALID_MESSAGE" });
    expect(
      parseCastProtocolMessage({
        version: 1,
        messageId: "message-1",
        type: "queue.mutate",
        sessionId: "session-1",
        mutationId: "mutation-1",
        expectedQueueRevision: 1,
        operation: {
          type: "queue.insert",
          index: 0,
          item: { ...queueItem(), title: "x".repeat(513) },
        },
      }),
    ).toEqual({ ok: false, error: "INVALID_MESSAGE" });
  });

  it("redacts leases from fields, URL paths, queries, and nested values", () => {
    expect(
      redactCastProtocolValue({
        lease: "opaque-secret",
        streamUrl:
          "https://api.example.test/api/cast/sessions/opaque-secret/items/item-1/stream?ticket=secret",
        nested: {
          authorization: "Bearer secret",
          message: "safe",
        },
      }),
    ).toEqual({
      lease: "[REDACTED]",
      streamUrl:
        "https://api.example.test/api/cast/sessions/[REDACTED]/items/item-1/stream",
      nested: {
        authorization: "[REDACTED]",
        message: "safe",
      },
    });
  });
});
