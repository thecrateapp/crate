import { describe, expect, it, vi } from "vitest";

import { createCafAdapter } from "./caf-adapter";
import type {
  CafCustomMessageEvent,
  CafEvent,
  CafLoadRequest,
  CafRuntime,
} from "./caf-types";

function createFakeRuntime() {
  const calls: string[] = [];
  const listeners = new Map<string, (event: CafEvent) => void>();
  let loadInterceptor:
    | ((request: CafLoadRequest) => CafLoadRequest)
    | undefined;
  let customListener: ((event: CafCustomMessageEvent) => void) | undefined;

  const playerManager = {
    addEventListener(type: string, listener: (event: CafEvent) => void) {
      calls.push(`player:add:${type}`);
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      calls.push(`player:remove:${type}`);
      listeners.delete(type);
    },
    setMessageInterceptor(
      type: string,
      interceptor: ((request: CafLoadRequest) => CafLoadRequest) | null,
    ) {
      calls.push(`player:interceptor:${type}:${interceptor ? "set" : "clear"}`);
      loadInterceptor = interceptor ?? undefined;
    },
  };
  const context = {
    getPlayerManager() {
      calls.push("context:get-player");
      return playerManager;
    },
    addCustomMessageListener(
      namespace: string,
      listener: (event: CafCustomMessageEvent) => void,
    ) {
      calls.push(`context:add-custom:${namespace}`);
      customListener = listener;
    },
    removeCustomMessageListener(
      namespace: string,
      listener: (event: CafCustomMessageEvent) => void,
    ) {
      calls.push(`context:remove-custom:${namespace}`);
      if (customListener === listener) customListener = undefined;
    },
    start() {
      calls.push("context:start");
    },
    stop() {
      calls.push("context:stop");
    },
  };
  const runtime: CafRuntime = {
    framework: {
      CastReceiverContext: {
        getInstance() {
          calls.push("runtime:get-context");
          return context;
        },
      },
      messages: { MessageType: { LOAD: "LOAD" } },
      events: {
        EventType: {
          BUFFERING: "BUFFERING",
          ERROR: "ERROR",
          MEDIA_STATUS: "MEDIA_STATUS",
          MEDIA_FINISHED: "MEDIA_FINISHED",
          PAUSE: "PAUSE",
          PLAYING: "PLAYING",
          PLAYER_LOADING: "PLAYER_LOADING",
          REQUEST_QUEUE_INSERT: "REQUEST_QUEUE_INSERT",
          REQUEST_QUEUE_LOAD: "REQUEST_QUEUE_LOAD",
          REQUEST_QUEUE_REMOVE: "REQUEST_QUEUE_REMOVE",
          REQUEST_QUEUE_REORDER: "REQUEST_QUEUE_REORDER",
          REQUEST_QUEUE_UPDATE: "REQUEST_QUEUE_UPDATE",
          TIME_UPDATE: "TIME_UPDATE",
        },
      },
    },
  };

  return {
    calls,
    custom: (data: unknown) => customListener?.({ data }),
    event: (type: string, event: CafEvent = {}) => listeners.get(type)?.(event),
    intercept: (request: CafLoadRequest) => loadInterceptor?.(request),
    runtime,
  };
}

describe("CAF adapter", () => {
  it("wires CAF before starting the receiver context", () => {
    const fake = createFakeRuntime();
    const adapter = createCafAdapter({ runtime: fake.runtime, handlers: {} });

    adapter.start();

    expect(fake.calls[0]).toBe("runtime:get-context");
    expect(fake.calls[1]).toBe("context:get-player");
    expect(fake.calls[fake.calls.length - 1]).toBe("context:start");
    expect(fake.calls).toContain("player:interceptor:LOAD:set");
  });

  it("validates Crate LOAD data and preserves standard CAF semantics", () => {
    const fake = createFakeRuntime();
    const onLoad = vi.fn();
    createCafAdapter({ runtime: fake.runtime, handlers: { onLoad } }).start();
    const valid = {
      media: {
        customData: {
          crateCast: {
            protocolVersion: 1,
            sessionId: "session-1",
            bootstrapUrl: "https://cast.example.test/api/cast/sessions/lease",
          },
        },
      },
    };
    const fallback = { media: { customData: { unrelated: true } } };

    expect(fake.intercept(valid)).toBe(valid);
    expect(fake.intercept(fallback)).toBe(fallback);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledWith(valid.media.customData.crateCast);
  });

  it("publishes player, queue, progress and protocol events", () => {
    const fake = createFakeRuntime();
    const handlers = {
      onPlayerState: vi.fn(),
      onProgress: vi.fn(),
      onQueueChange: vi.fn(),
      onProtocolMessage: vi.fn(),
      onError: vi.fn(),
    };
    createCafAdapter({ runtime: fake.runtime, handlers }).start();

    fake.event("PLAYING");
    fake.event("TIME_UPDATE", { currentMediaTime: 42.5, duration: 180 });
    fake.event("REQUEST_QUEUE_UPDATE", {
      queueData: { items: [{ itemId: 7 }] },
    });
    fake.event("ERROR", { error: { code: "MEDIA_NETWORK" } });
    fake.custom({
      version: 1,
      messageId: "status-1",
      type: "receiver.status",
      sessionId: "session-1",
      queueRevision: 2,
      stateSeq: 8,
      currentIndex: 0,
      currentTime: 42.5,
      playerState: "PLAYING",
      consecutiveFailures: 0,
    });
    fake.custom({ version: 999, messageId: "bad", type: "receiver.ready" });

    expect(handlers.onPlayerState).toHaveBeenCalledWith("PLAYING");
    expect(handlers.onProgress).toHaveBeenCalledWith({
      currentTime: 42.5,
      duration: 180,
    });
    expect(handlers.onQueueChange).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onProtocolMessage).toHaveBeenCalledTimes(1);
  });

  it("removes every listener and interceptor on teardown", () => {
    const fake = createFakeRuntime();
    const adapter = createCafAdapter({ runtime: fake.runtime, handlers: {} });
    adapter.start();

    adapter.stop();

    expect(fake.calls).toContain("player:interceptor:LOAD:clear");
    expect(fake.calls).toContain(
      "context:remove-custom:urn:x-cast:app.cratemusic.crate.v1",
    );
    expect(fake.calls[fake.calls.length - 1]).toBe("context:stop");
  });
});
