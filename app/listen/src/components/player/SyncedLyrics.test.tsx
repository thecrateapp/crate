import { it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useState, useMemo } from "react";
import {
  PlayerProgressContext,
  PlayerStateContext,
  type PlayerStateValue,
} from "../../contexts/player-context";
import { PlayerTimeReaderContext } from "../../contexts/player-time-reader";
import { SyncedLyrics } from "./SyncedLyrics";
it("moves the active underline without re-rendering lyric rows, and seeks by line", () => {
  const seek = vi.fn();
  const reads = vi.fn();
  function Rows() {
    reads();
    return (
      <SyncedLyrics
        lines={[
          { time: 0, text: "First" },
          { time: 10, text: "Second" },
        ]}
        onSeek={seek}
      />
    );
  }
  function Harness() {
    const [time, setTime] = useState(5);
    const rows = useMemo(() => <Rows />, []);
    return (
      <PlayerProgressContext value={{ currentTime: time, duration: 20 }}>
        {rows}
        <button onClick={() => setTime(15)}>Tick</button>
      </PlayerProgressContext>
    );
  }
  render(<Harness />);
  const first = screen.getByRole("button", { name: "First" });
  const second = screen.getByRole("button", { name: "Second" });
  expect(first).toHaveAttribute("aria-current", "true");
  expect(first.style.getPropertyValue("--lyric-progress")).toBe("0.5");
  fireEvent.click(screen.getByRole("button", { name: "Tick" }));
  expect(second).toHaveAttribute("aria-current", "true");
  expect(first).toHaveAttribute("data-state", "past");
  expect(reads).toHaveBeenCalledTimes(1);
  fireEvent.click(second);
  expect(seek).toHaveBeenCalledWith(10);
});
it("follows the exact engine time between coarse progress commits while playing", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      callbacks.set(nextId, callback);
      return nextId++;
    });
  const caf = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id) => void callbacks.delete(id));
  const runFrame = () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    act(() => pending.forEach((callback) => callback(0)));
  };
  let exact = 2;
  try {
    render(
      <PlayerTimeReaderContext value={() => exact}>
        <PlayerStateContext
          value={{ isPlaying: true } as unknown as PlayerStateValue}
        >
          <PlayerProgressContext value={{ currentTime: 2, duration: 20 }}>
            <SyncedLyrics
              lines={[
                { time: 0, text: "First" },
                { time: 10, text: "Second" },
              ]}
              onSeek={vi.fn()}
            />
          </PlayerProgressContext>
        </PlayerStateContext>
      </PlayerTimeReaderContext>,
    );
    const first = screen.getByRole("button", { name: "First" });
    expect(first.style.getPropertyValue("--lyric-progress")).toBe("0.2");

    // Engine ticks advance the ref; React progress is still at 2 s.
    exact = 2.5;
    runFrame();
    expect(first.style.getPropertyValue("--lyric-progress")).toBe("0.25");

    exact = 10.2;
    runFrame();
    expect(screen.getByRole("button", { name: "Second" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  } finally {
    raf.mockRestore();
    caf.mockRestore();
  }
});

it("runs no frame loop while paused", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  try {
    render(
      <PlayerTimeReaderContext value={() => 3}>
        <PlayerStateContext
          value={{ isPlaying: false } as unknown as PlayerStateValue}
        >
          <PlayerProgressContext value={{ currentTime: 3, duration: 20 }}>
            <SyncedLyrics
              lines={[{ time: 0, text: "Only" }]}
              onSeek={vi.fn()}
            />
          </PlayerProgressContext>
        </PlayerStateContext>
      </PlayerTimeReaderContext>,
    );
    expect(raf).not.toHaveBeenCalled();
  } finally {
    raf.mockRestore();
  }
});

it("centers the active line inside its own surface without scrolling the outer page", () => {
  const scroll = vi.fn();
  const pageScroll = vi.fn();
  const originalScroll = HTMLElement.prototype.scrollTo;
  const originalIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollTo = scroll;
  HTMLElement.prototype.scrollIntoView = pageScroll;
  const motion = document.documentElement.dataset.crateMotion;
  document.documentElement.dataset.crateMotion = "reduced";
  try {
    render(
      <div data-slot="player-lyrics-surface">
        <PlayerProgressContext value={{ currentTime: 12, duration: 30 }}>
          <SyncedLyrics
            lines={[{ time: 10, text: "Inside panel" }]}
            onSeek={vi.fn()}
          />
        </PlayerProgressContext>
      </div>,
    );
    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant" }),
    );
    expect(pageScroll).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollTo = originalScroll;
    HTMLElement.prototype.scrollIntoView = originalIntoView;
    if (motion) document.documentElement.dataset.crateMotion = motion;
    else delete document.documentElement.dataset.crateMotion;
  }
});
