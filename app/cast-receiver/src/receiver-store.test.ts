import { describe, expect, it, vi } from "vitest";

import { createReceiverStore } from "./receiver-store";

describe("receiver store", () => {
  it("moves through discrete playback phases", () => {
    const store = createReceiverStore();

    expect(store.getSnapshot().phase).toBe("idle");
    store.dispatch({ type: "load-started", sessionId: "session-1" });
    expect(store.getSnapshot().phase).toBe("loading");
    store.dispatch({ type: "player-state", state: "PLAYING" });
    expect(store.getSnapshot().phase).toBe("playing");
    store.dispatch({ type: "player-state", state: "PAUSED" });
    expect(store.getSnapshot().phase).toBe("paused");
    store.dispatch({ type: "player-state", state: "BUFFERING" });
    expect(store.getSnapshot().phase).toBe("buffering");
    store.dispatch({ type: "recovering", message: "Retrying media" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "recovering",
      message: "Retrying media",
    });
    store.dispatch({ type: "terminal-error", message: "Unable to play" });
    expect(store.getSnapshot()).toMatchObject({
      phase: "error",
      message: "Unable to play",
    });
  });

  it("updates queue metadata atomically", () => {
    const store = createReceiverStore();
    const item = {
      itemId: "item-1",
      track: { trackId: 7 },
      title: "Track",
      artist: "Artist",
    };

    store.dispatch({
      type: "queue-loaded",
      queueRevision: 4,
      currentIndex: 0,
      items: [item],
    });

    expect(store.getSnapshot()).toMatchObject({
      queueRevision: 4,
      currentIndex: 0,
      items: [item],
    });
  });

  it("loads queue and appearance as one session snapshot", () => {
    const store = createReceiverStore();
    const appearance = {
      contractVersion: 1 as const,
      skinId: "crate-red",
      preferredMode: "dark" as const,
      resolvedMode: "dark" as const,
      reducedMotion: false,
    };

    store.dispatch({
      type: "session-loaded",
      appearance,
      queue: {
        queueRevision: 2,
        stateSeq: 3,
        currentIndex: 0,
        currentTime: 16,
        repeatMode: "off",
        shuffle: false,
        items: [],
      },
    });

    expect(store.getSnapshot()).toMatchObject({ appearance, queueRevision: 2 });
    expect(store.getSnapshot()).toMatchObject({
      stateSeq: 3,
      repeatMode: "off",
      shuffle: false,
    });
    expect(store.progress.getSnapshot()).toEqual({
      currentTime: 16,
      duration: 0,
    });
  });

  it("adopts the current CAF item without replacing the queue", () => {
    const store = createReceiverStore();
    store.dispatch({
      type: "queue-loaded",
      queueRevision: 2,
      currentIndex: 0,
      items: [
        { itemId: "one", track: { trackId: 1 }, title: "One", artist: "A" },
        { itemId: "two", track: { trackId: 2 }, title: "Two", artist: "A" },
      ],
    });

    store.dispatch({ type: "current-item", itemId: "two" });

    expect(store.getSnapshot().currentIndex).toBe(1);
  });

  it("keeps high-frequency progress outside structural subscriptions", () => {
    const store = createReceiverStore();
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    store.progress.set({ currentTime: 25, duration: 100 });

    expect(store.progress.getSnapshot()).toEqual({
      currentTime: 25,
      duration: 100,
    });
    expect(subscriber).not.toHaveBeenCalled();

    store.dispatch({ type: "player-state", state: "PLAYING" });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not notify when a structural action is a no-op", () => {
    const store = createReceiverStore();
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.dispatch({ type: "player-state", state: "IDLE" });

    expect(subscriber).not.toHaveBeenCalled();
  });
});
