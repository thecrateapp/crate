import { it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
const start = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sleep-timer", () => ({
  startSleepTimer: start,
  cancelSleepTimer: vi.fn(),
  formatRemaining: () => "",
  subscribeSleepTimer: () => () => {},
}));
import { SleepTimerSection } from "./SleepTimerSection";
it("uses the shared select for sleep modes and starts the existing timer", () => {
  const pause = vi.fn();
  renderWithListenProviders(<SleepTimerSection />, {
    playerActions: { pause },
  });
  fireEvent.pointerDown(screen.getByRole("combobox"), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(screen.getByRole("option", { name: "15 min" }));
  expect(start).toHaveBeenCalledWith("15min", pause);
});
