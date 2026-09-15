import { describe, expect, it, vi } from "vitest";

import type { CrateLoadData } from "./caf-types";
import { createReceiverSessionRuntime } from "./receiver-session-runtime";
import { createReceiverStore } from "./receiver-store";

const loadData: CrateLoadData = {
  bootstrapUrl: "https://api.test/api/cast/sessions/private-lease",
  protocolVersion: 1,
  sessionId: "session-1",
};

const session = {
  sessionId: "session-1",
  appearance: {
    contractVersion: 1 as const,
    skinId: "default",
    preferredMode: "system" as const,
    resolvedMode: "dark" as const,
    reducedMotion: false,
  },
  queue: {
    queueRevision: 4,
    stateSeq: 7,
    currentIndex: 0,
    currentTime: 12,
    repeatMode: "off" as const,
    shuffle: false,
    items: [
      {
        itemId: "item-1",
        track: { trackId: 1 },
        title: "One",
        artist: "Artist",
        duration: 100,
      },
      {
        itemId: "item-2",
        track: { trackId: 2 },
        title: "Two",
        artist: "Artist",
        duration: 200,
      },
    ],
  },
};

function setup() {
  const store = createReceiverStore();
  const sendProtocolMessage = vi.fn();
  const publishState = vi.fn(async () => undefined);
  const publishCheckpoint = vi.fn(async () => undefined);
  const loadSession = vi.fn(async () => session);
  const retryCurrentItem = vi.fn(() => true);
  const skipCurrentItem = vi.fn(() => true);
  const telemetry = {
    captureError: vi.fn(),
    metric: vi.fn(),
  };
  let nowMs = Date.parse("2026-09-14T12:00:00.000Z");
  const runtime = createReceiverSessionRuntime({
    store,
    loadSession,
    publishState,
    publishCheckpoint,
    sendProtocolMessage,
    now: () => new Date(nowMs),
    makeMessageId: () => "message-1",
    retryCurrentItem,
    skipCurrentItem,
    telemetry,
  });
  return {
    advance(ms: number) {
      nowMs += ms;
    },
    publishCheckpoint,
    publishState,
    loadSession,
    runtime,
    retryCurrentItem,
    sendProtocolMessage,
    skipCurrentItem,
    store,
    telemetry,
  };
}

describe("receiver session runtime", () => {
  it("loads the scoped queue and announces a receiver-owned snapshot", async () => {
    const { runtime, sendProtocolMessage, store, telemetry } = setup();

    await runtime.load(loadData);

    expect(store.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      queueRevision: 4,
      stateSeq: 7,
      currentIndex: 0,
    });
    expect(sendProtocolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "queue.snapshot",
        sessionId: "session-1",
        reason: "reconnect",
        queue: session.queue,
      }),
    );
    expect(telemetry.metric).toHaveBeenCalledWith("receiver.session_load", {
      outcome: "success",
    });
    expect(sendProtocolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "receiver.status",
        sessionId: "session-1",
        stateSeq: 7,
        currentTime: 12,
      }),
    );
  });

  it("publishes monotonic receiver state without leaking the lease", async () => {
    const { runtime, publishState, sendProtocolMessage, store } = setup();
    await runtime.load(loadData);
    sendProtocolMessage.mockClear();

    runtime.playerState("PLAYING");
    runtime.progress({ currentTime: 18, duration: 100 });
    await runtime.flushState();
    await runtime.flushState();

    expect(publishState).toHaveBeenNthCalledWith(1, loadData.bootstrapUrl, {
      stateSeq: 8,
      currentIndex: 0,
      currentTime: 18,
    });
    expect(publishState).toHaveBeenNthCalledWith(2, loadData.bootstrapUrl, {
      stateSeq: 9,
      currentIndex: 0,
      currentTime: 18,
    });
    expect(store.getSnapshot().stateSeq).toBe(9);
    expect(JSON.stringify(sendProtocolMessage.mock.calls)).not.toContain(
      "private-lease",
    );
  });

  it("continues heartbeats after a transient state write failure", async () => {
    const { publishState, runtime } = setup();
    publishState
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(undefined);
    await runtime.load(loadData);

    await expect(runtime.flushState()).rejects.toThrow("network unavailable");
    await expect(runtime.flushState()).resolves.toBeUndefined();

    expect(publishState).toHaveBeenCalledTimes(2);
    expect(publishState).toHaveBeenNthCalledWith(
      2,
      loadData.bootstrapUrl,
      expect.objectContaining({ stateSeq: 9 }),
    );
  });

  it("refreshes its structural queue after a CAF mutation", async () => {
    const { loadSession, runtime, sendProtocolMessage, store } = setup();
    await runtime.load(loadData);
    loadSession.mockResolvedValueOnce({
      ...session,
      queue: {
        ...session.queue,
        queueRevision: 5,
        items: [session.queue.items[1]!],
        currentIndex: 0,
      },
    });

    await runtime.refreshQueue();

    expect(store.getSnapshot()).toMatchObject({
      queueRevision: 5,
      currentIndex: 0,
      items: [expect.objectContaining({ itemId: "item-2" })],
    });
    expect(sendProtocolMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "receiver.status", queueRevision: 5 }),
    );
  });

  it("ignores an out-of-order queue refresh", async () => {
    const { loadSession, runtime, sendProtocolMessage, store, telemetry } =
      setup();
    await runtime.load(loadData);
    sendProtocolMessage.mockClear();
    loadSession.mockResolvedValueOnce({
      ...session,
      queue: {
        ...session.queue,
        queueRevision: 3,
        items: [session.queue.items[1]!],
        currentIndex: 0,
      },
    });

    await runtime.refreshQueue();

    expect(store.getSnapshot()).toMatchObject({
      queueRevision: 4,
      currentIndex: 0,
      items: [
        expect.objectContaining({ itemId: "item-1" }),
        expect.objectContaining({ itemId: "item-2" }),
      ],
    });
    expect(sendProtocolMessage).not.toHaveBeenCalled();
    expect(telemetry.metric).toHaveBeenCalledWith("receiver.queue_conflict", {
      outcome: "stale_snapshot",
    });
  });

  it("records one idempotent checkpoint when CAF advances the queue", async () => {
    const { advance, publishCheckpoint, runtime } = setup();
    await runtime.load(loadData);
    runtime.playerState("PLAYING");
    runtime.progress({ currentTime: 20, duration: 100 });
    advance(8_000);
    runtime.progress({ currentTime: 28, duration: 100 });

    runtime.currentItem("item-2");
    await runtime.drain();

    expect(publishCheckpoint).toHaveBeenCalledOnce();
    expect(publishCheckpoint).toHaveBeenCalledWith(
      loadData.bootstrapUrl,
      expect.objectContaining({
        clientEventId: "session-1:item-1:1789387200000",
        itemId: "item-1",
        playedSeconds: 8,
        trackDurationSeconds: 100,
        wasCompleted: false,
        wasSkipped: true,
      }),
    );
  });

  it("ignores events from a superseded asynchronous load", async () => {
    const store = createReceiverStore();
    let resolveFirst: ((value: typeof session) => void) | undefined;
    const loadSession = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<typeof session>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...session, sessionId: "session-2" });
    const runtime = createReceiverSessionRuntime({
      store,
      loadSession,
      publishState: vi.fn(async () => undefined),
      publishCheckpoint: vi.fn(async () => undefined),
      sendProtocolMessage: vi.fn(),
    });

    const first = runtime.load(loadData);
    await runtime.load({ ...loadData, sessionId: "session-2" });
    resolveFirst?.(session);
    await first;

    expect(store.getSnapshot().sessionId).toBe("session-2");
  });

  it("retries twice, skips failed media, and stops after three failed items", async () => {
    const {
      retryCurrentItem,
      runtime,
      sendProtocolMessage,
      skipCurrentItem,
      store,
      telemetry,
    } = setup();
    await runtime.load(loadData);

    runtime.mediaError();
    runtime.mediaError();
    runtime.mediaError();

    expect(retryCurrentItem).toHaveBeenCalledTimes(2);
    expect(skipCurrentItem).toHaveBeenCalledTimes(1);
    expect(sendProtocolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "receiver.status",
        error: expect.objectContaining({ code: "MEDIA_RETRYING", attempt: 2 }),
      }),
    );

    runtime.currentItem("item-2");
    runtime.mediaError();
    runtime.mediaError();
    runtime.mediaError();
    runtime.currentItem("item-1");
    runtime.mediaError();
    runtime.mediaError();
    runtime.mediaError();

    expect(skipCurrentItem).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toMatchObject({
      phase: "error",
      message: "Unable to play this item",
    });
    expect(telemetry.metric).toHaveBeenCalledWith("receiver.media_retry", {
      attempt: 1,
      outcome: "retry",
    });
    expect(telemetry.metric).toHaveBeenCalledWith("receiver.media_skip", {
      outcome: "skip",
    });
    expect(telemetry.metric).toHaveBeenCalledWith("receiver.media_terminal", {
      outcome: "error",
    });
  });

  it("reports a failed scoped session load without exposing its URL", async () => {
    const { loadSession, runtime, telemetry } = setup();
    const error = new Error("CAST_SESSION_UNAVAILABLE");
    loadSession.mockRejectedValueOnce(error);

    await runtime.load(loadData);

    expect(telemetry.metric).toHaveBeenCalledWith("receiver.session_load", {
      outcome: "error",
    });
    expect(telemetry.captureError).toHaveBeenCalledWith(error, "session_load");
    expect(JSON.stringify(telemetry.captureError.mock.calls)).not.toContain(
      "private-lease",
    );
  });
});
