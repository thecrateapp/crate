import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ListeningHeatmap } from "./ListeningHeatmap";
import type { StatsHeatmap } from "./stats-types";

function fixture(extra: Partial<StatsHeatmap> = {}): StatsHeatmap {
  return {
    cells: Array.from({ length: 7 }, (_, weekday) =>
      Array.from({ length: 24 }, (_, hour) =>
        weekday === 6 && hour === 22 ? 90 : 5,
      ),
    ),
    peak: { weekday: 6, hour: 22 },
    night_share: 0.38,
    night_hours: [22, 23, 0, 1, 2, 3, 4, 5],
    ...extra,
  };
}

const readout = () =>
  document.querySelector<HTMLElement>("[data-slot='heatmap-readout']")!;
const cell = (name: string) => screen.getByRole("gridcell", { name });
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement!, { key, ...init });

afterEach(() => {
  vi.useRealTimers();
});

describe("ListeningHeatmap", () => {
  it("moves focus with arrow keys and shows the readout", () => {
    renderWithListenProviders(
      <ListeningHeatmap
        heatmap={fixture()}
        timezone="Europe/Madrid"
        showNow={false}
        scope="personal"
        topGenre="Metalcore"
      />,
    );
    const grid = screen.getByRole("grid", {
      name: "Listening by weekday and hour",
    });
    expect(within(grid).getAllByRole("row")).toHaveLength(7);
    const cells = within(grid).getAllByRole("gridcell");
    expect(cells).toHaveLength(168);
    // One tab stop: the peak.
    const tabbable = cells.filter((node) => node.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Sunday 22:00, 90 minutes");
    // The readout starts on the peak and is never announced.
    expect(readout()).toHaveTextContent("Sunday 22:00 · 1h 30m");
    expect(readout().closest("[aria-live]")).toBeNull();

    act(() => tabbable[0]!.focus());
    press("ArrowRight");
    expect(document.activeElement).toBe(cell("Sunday 23:00, 5 minutes"));
    expect(readout()).toHaveTextContent("Sunday 23:00 · 5m");
    // The edges do not wrap.
    press("ArrowRight");
    expect(document.activeElement).toBe(cell("Sunday 23:00, 5 minutes"));
    press("ArrowDown");
    expect(document.activeElement).toBe(cell("Sunday 23:00, 5 minutes"));
    press("ArrowUp");
    expect(document.activeElement).toBe(cell("Saturday 23:00, 5 minutes"));
    press("Home");
    expect(document.activeElement).toBe(cell("Saturday 00:00, 5 minutes"));
    press("ArrowLeft");
    expect(document.activeElement).toBe(cell("Saturday 00:00, 5 minutes"));
    press("End");
    expect(document.activeElement).toBe(cell("Saturday 23:00, 5 minutes"));
    press("Home", { ctrlKey: true });
    expect(document.activeElement).toBe(cell("Monday 00:00, 5 minutes"));
    expect(readout()).toHaveTextContent("Monday 00:00 · 5m");
    // Still a single tab stop, now on the focused cell.
    const stops = within(grid)
      .getAllByRole("gridcell")
      .filter((node) => node.tabIndex === 0);
    expect(stops).toEqual([cell("Monday 00:00, 5 minutes")]);

    // Hover shows another cell and leaving returns to the focused one.
    fireEvent.pointerOver(cell("Wednesday 18:00, 5 minutes"));
    expect(readout()).toHaveTextContent("Wednesday 18:00 · 5m");
    fireEvent.pointerLeave(grid);
    expect(readout()).toHaveTextContent("Monday 00:00 · 5m");

    // A tap selects the cell and moves the tab stop there.
    fireEvent.click(cell("Friday 07:00, 5 minutes"));
    expect(readout()).toHaveTextContent("Friday 07:00 · 5m");
    expect(cell("Friday 07:00, 5 minutes").tabIndex).toBe(0);
    expect(cell("Monday 00:00, 5 minutes").tabIndex).toBe(-1);
  });

  it("outlines the peak and night band", () => {
    renderWithListenProviders(
      <ListeningHeatmap
        heatmap={fixture()}
        timezone="Europe/Madrid"
        showNow={false}
        scope="personal"
        topGenre="Metalcore"
      />,
    );
    const grid = screen.getByRole("grid");
    const peaks = grid.querySelectorAll("[data-peak]");
    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toBe(cell("Sunday 22:00, 90 minutes"));
    // Glow only at level 0.6 or more: the peak alone here.
    expect(grid.querySelectorAll("[data-glow]")).toHaveLength(1);
    expect(cell("Sunday 22:00, 90 minutes")).toHaveAttribute("data-glow");
    // Night 22-05: eight hours on every weekday.
    expect(grid.querySelectorAll("[data-night]")).toHaveLength(7 * 8);
    expect(cell("Monday 03:00, 5 minutes")).toHaveAttribute("data-night");
    expect(cell("Monday 23:00, 5 minutes")).toHaveAttribute("data-night");
    expect(cell("Monday 12:00, 5 minutes")).not.toHaveAttribute("data-night");
    // One shared style per cell carries the level and the wave delay.
    expect(
      cell("Sunday 22:00, 90 minutes").style.getPropertyValue("--stats-level"),
    ).toBe("1.000");
    expect(
      cell("Monday 01:00, 5 minutes").style.getPropertyValue("--stats-delay"),
    ).toBe("18ms");
    // Hour axis every six hours.
    const axis = document.querySelector("[data-slot='heatmap-hours']")!;
    expect(axis).toHaveAttribute("aria-hidden", "true");
    expect(
      Array.from(axis.children)
        .map((node) => node.textContent)
        .filter(Boolean),
    ).toEqual(["00", "06", "12", "18"]);
    // Counters: peak slot, night share and top genre.
    const counters = document.querySelector<HTMLElement>(
      "dl[data-slot='heatmap-counters']",
    )!;
    expect(within(counters).getByText("Peak")).toBeInTheDocument();
    expect(within(counters).getByText("Sunday 22:00")).toBeInTheDocument();
    expect(within(counters).getByText("Night 22–05")).toBeInTheDocument();
    expect(within(counters).getByText("38%")).toBeInTheDocument();
    expect(within(counters).getByText("Top genre")).toBeInTheDocument();
    expect(within(counters).getByText("Metalcore")).toBeInTheDocument();
    // The figure sentence summarises the grid.
    expect(
      screen.getByText(
        "Most listening happens on Sunday around 22:00; 38% of it at night.",
      ),
    ).toBeInTheDocument();
  });

  it("hides the instance grid below three listeners", () => {
    const { rerender } = renderWithListenProviders(
      <ListeningHeatmap
        heatmap={fixture({ listener_count: 2 })}
        timezone={null}
        showNow={false}
        scope="global"
        topGenre="Metalcore"
      />,
    );
    expect(screen.queryByRole("grid")).toBeNull();
    expect(
      screen.getByText(
        "The hourly pattern appears once at least 3 listeners have played music in this period.",
      ),
    ).toBeInTheDocument();
    // Only the top genre remains: the peak and night share would expose a listener.
    expect(screen.getByText("Metalcore")).toBeInTheDocument();
    expect(screen.queryByText("Peak")).toBeNull();
    expect(screen.queryByText("38%")).toBeNull();

    rerender(
      <ListeningHeatmap
        heatmap={fixture({ listener_count: 3 })}
        timezone={null}
        showNow={false}
        scope="global"
        topGenre="Metalcore"
      />,
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByText("Listener local time")).toBeInTheDocument();
  });

  it("marks the now cell and moves it on the next hour", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // Wednesday 12:59:30 in Madrid (CEST, UTC+2).
    vi.setSystemTime(new Date("2026-10-21T10:59:30Z"));
    const { unmount } = renderWithListenProviders(
      <ListeningHeatmap
        heatmap={fixture()}
        timezone="Europe/Madrid"
        showNow
        scope="personal"
        topGenre={null}
      />,
    );
    const grid = screen.getByRole("grid");
    expect(grid.querySelectorAll("[data-now]")).toHaveLength(1);
    expect(cell("Wednesday 12:00, 5 minutes, now")).toHaveAttribute("data-now");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(cell("Wednesday 13:00, 5 minutes, now")).toHaveAttribute("data-now");
    expect(cell("Wednesday 12:00, 5 minutes")).not.toHaveAttribute("data-now");
    const clear = vi.spyOn(window, "clearTimeout");
    unmount();
    expect(clear).toHaveBeenCalled();
  });

  it("shows no now cell on other subjects and schedules nothing", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:59:30Z"));
    const schedule = vi.spyOn(window, "setTimeout");
    renderWithListenProviders(
      <ListeningHeatmap
        heatmap={fixture()}
        timezone="Europe/Madrid"
        showNow={false}
        scope="user"
        topGenre={null}
      />,
    );
    expect(
      screen.getByRole("grid").querySelectorAll("[data-now]"),
    ).toHaveLength(0);
    expect(schedule.mock.calls.some(([, delay]) => delay === 30_000)).toBe(
      false,
    );
  });

  it("renders zero minutes flat and the loading and building states", () => {
    const { rerender } = renderWithListenProviders(
      <ListeningHeatmap
        heatmap={fixture({
          cells: Array.from({ length: 7 }, () => Array(24).fill(0)),
          peak: null,
          night_share: 0,
        })}
        timezone={null}
        showNow={false}
        scope="personal"
        topGenre={null}
      />,
    );
    const grid = screen.getByRole("grid");
    expect(grid.querySelectorAll("[data-peak]")).toHaveLength(0);
    expect(
      cell("Sunday 22:00, 0 minutes").style.getPropertyValue("--stats-level"),
    ).toBe("0.000");
    expect(
      screen.getByText("No listening hours to show for this period yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Peak")).toBeNull();

    rerender(
      <ListeningHeatmap
        heatmap={null}
        loading
        timezone={null}
        showNow={false}
        scope="personal"
        topGenre={null}
      />,
    );
    expect(screen.queryByRole("grid")).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();

    rerender(
      <ListeningHeatmap
        heatmap={null}
        pending
        timezone={null}
        showNow={false}
        scope="personal"
        topGenre={null}
      />,
    );
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByText("Building the hourly pattern")).toBeInTheDocument();
  });
});
