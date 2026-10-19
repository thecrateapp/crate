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
