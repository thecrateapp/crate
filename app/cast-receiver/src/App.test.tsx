import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { createReceiverStore } from "./receiver-store";

const items = [
  {
    itemId: "one",
    track: { trackId: 1 },
    title: "A title that remains readable even when it is unusually long",
    artist: "Artist One",
    album: "Album One",
    duration: 200,
    quality: "FLAC 24/96",
  },
  {
    itemId: "two",
    track: { trackId: 2 },
    title: "Second track",
    artist: "Artist Two",
  },
  {
    itemId: "three",
    track: { trackId: 3 },
    title: "Third track",
    artist: "Artist Three",
  },
  {
    itemId: "four",
    track: { trackId: 4 },
    title: "Fourth track",
    artist: "Artist Four",
  },
];

describe("Cast receiver app", () => {
  it.each([
    ["idle", "Ready to cast"],
    ["loading", "Connecting to Crate"],
    ["recovering", "Trying the next source"],
    ["error", "Playback unavailable"],
  ] as const)("renders the %s state", (phase, label) => {
    const store = createReceiverStore();
    if (phase === "loading") {
      store.dispatch({ type: "load-started", sessionId: "session-1" });
    } else if (phase === "recovering") {
      store.dispatch({ type: "recovering", message: label });
    } else if (phase === "error") {
      store.dispatch({ type: "terminal-error", message: label });
    }

    render(<App store={store} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders now playing and at most three upcoming items", () => {
    const store = createReceiverStore();
    store.dispatch({
      type: "session-loaded",
      appearance: {
        contractVersion: 1,
        skinId: "default",
        preferredMode: "dark",
        resolvedMode: "dark",
        reducedMotion: false,
      },
      queue: {
        queueRevision: 3,
        stateSeq: 1,
        currentIndex: 0,
        currentTime: 0,
        repeatMode: "off",
        shuffle: false,
        items,
      },
    });
    store.dispatch({ type: "player-state", state: "PLAYING" });

    render(<App store={store} />);

    expect(
      screen.getByRole("heading", { name: items[0]?.title }),
    ).toBeVisible();
    expect(screen.getByText("Playing on Crate")).toBeVisible();
    expect(screen.getByText("Second track")).toBeVisible();
    expect(screen.getByText("Third track")).toBeVisible();
    expect(screen.getByText("Fourth track")).toBeVisible();
    expect(screen.getByText("FLAC 24/96")).toBeVisible();
    expect(screen.getByTestId("cast-spectrum")).toHaveAttribute(
      "data-spectrum-state",
      "fallback",
    );
  });

  it("uses an artwork fallback and handles an empty queue", () => {
    const store = createReceiverStore();
    store.dispatch({
      type: "queue-loaded",
      queueRevision: 1,
      currentIndex: 0,
      items: [items[0]!],
    });
    const view = render(<App store={store} />);
    expect(screen.getByLabelText("No cover artwork available")).toBeVisible();

    act(() => {
      store.dispatch({
        type: "queue-loaded",
        queueRevision: 2,
        currentIndex: 0,
        items: [],
      });
    });
    expect(view.getByText("Ready to cast")).toBeVisible();
  });

  it("updates progress without publishing a structural store change", () => {
    const store = createReceiverStore();
    store.dispatch({
      type: "queue-loaded",
      queueRevision: 1,
      currentIndex: 0,
      items: [items[0]!],
    });
    render(<App store={store} />);

    act(() => store.progress.set({ currentTime: 50, duration: 200 }));

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(screen.getByText("0:50")).toBeVisible();
  });
});
