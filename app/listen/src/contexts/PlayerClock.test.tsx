import { it, expect, vi } from "vitest";
import { useMemo, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlayerClockProvider, usePlayerClock } from "./PlayerClock";
import { PlayerProgressContext } from "./player-progress-context";
it("keeps controller subscriptions stable while event handlers read the latest time", () => {
  const renderController = vi.fn(),
    read = vi.fn();
  function Controller() {
    renderController();
    const clock = usePlayerClock();
    return (
      <button onClick={() => read(clock.current.currentTime)}>
        Read position
      </button>
    );
  }
  function Harness() {
    const [time, setTime] = useState(4);
    const child = useMemo(() => <Controller />, []);
    return (
      <PlayerClockProvider value={{ currentTime: time, duration: 204 }}>
        <PlayerProgressContext value={{ currentTime: time, duration: 204 }}>
          {child}
          <button onClick={() => setTime(94)}>Tick</button>
        </PlayerProgressContext>
      </PlayerClockProvider>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Tick" }));
  fireEvent.click(screen.getByRole("button", { name: "Read position" }));
  expect(read).toHaveBeenCalledWith(94);
  expect(renderController).toHaveBeenCalledTimes(1);
});
it("preserves progress values for legacy providers", () => {
  function Legacy() {
    return <output>{usePlayerClock().current.currentTime}</output>;
  }
  const { rerender } = render(
    <PlayerProgressContext value={{ currentTime: 12, duration: 204 }}>
      <Legacy />
    </PlayerProgressContext>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("12");
  rerender(
    <PlayerProgressContext value={{ currentTime: 30, duration: 204 }}>
      <Legacy />
    </PlayerProgressContext>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("30");
});
