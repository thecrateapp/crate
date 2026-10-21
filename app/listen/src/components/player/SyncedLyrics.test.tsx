import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState, useMemo } from "react";
import { PlayerProgressContext } from "../../contexts/player-context";
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
