import { fireEvent, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StatsTape } from "@/components/stats/stats-types";
import { StatsExplorerView } from "@/components/stats/explorer/StatsExplorerView";
import {
  explorerMode,
  type ExplorerMode,
  type ExplorerWindow,
} from "@/components/stats/explorer/stats-explorer-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const DAY = 86_400_000;
const CHART = "Listening in the selected stretch";

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// 2026-07-01 onwards; July starts at 0, August at 31 and September at 62.
function dailyTape(days = 92): StatsTape {
  const start = Date.UTC(2026, 6, 1);
  return {
    granularity: "day",
    start: iso(start),
    end: iso(start + days * DAY),
    points: Array.from({ length: days }, (_, index) => ({
      bucket: iso(start + index * DAY),
      minutes: index % 9 === 0 ? 0 : 20 + (index % 5) * 10,
      plays: 4,
    })),
    mood: [],
    peaks: [
      {
        kind: "longest_day",
        bucket: "2026-08-20",
        day: "2026-08-20",
        value: 120,
      },
      {
        kind: "discovery",
        bucket: "2026-08-25",
        day: "2026-08-25",
        value: 3,
        artist: "Duster",
      },
    ],
    months: [],
  };
}

function Harness({
  tape,
  mode,
  initial,
  onWindowChange = () => {},
  onOpenBucket = () => {},
  onMonth = () => {},
  panel,
}: {
  tape: StatsTape;
  mode: ExplorerMode;
  initial: ExplorerWindow;
  onWindowChange?: (window: ExplorerWindow) => void;
  onOpenBucket?: (index: number) => void;
  onMonth?: (month: string) => void;
  panel?: ReactNode;
}) {
  const [current, setCurrent] = useState(initial);
  const [cursor, setCursor] = useState<number | null>(null);
  return (
    <StatsExplorerView
      tape={tape}
      mode={mode}
      window={current}
      cursor={cursor}
      onWindowChange={(next) => {
        onWindowChange(next);
        setCurrent(next);
      }}
      onCursorChange={setCursor}
      onOpenBucket={onOpenBucket}
      onMonth={onMonth}
      panel={panel}
    />
  );
}

function stripRect(slider: HTMLElement, width: number) {
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: 52,
    width,
    height: 52,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("StatsExplorerView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves and resizes the window with the keyboard", () => {
    const tape = dailyTape();
    const onWindowChange = vi.fn();
    renderWithListenProviders(
      <Harness
        tape={tape}
        mode={explorerMode("90d", tape)}
        initial={{ from: 30, to: 60 }}
        onWindowChange={onWindowChange}
      />,
      { locale: "en" },
    );
    const slider = screen.getByRole("slider", { name: "Selected stretch" });
    expect(slider).toHaveAttribute("aria-valuetext", "Jul 31 – Aug 29");

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onWindowChange).toHaveBeenLastCalledWith({ from: 31, to: 61 });
    expect(slider).toHaveAttribute("aria-valuetext", "Aug 1 – Aug 30");

    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(onWindowChange).toHaveBeenLastCalledWith({ from: 38, to: 68 });
    expect(slider).toHaveAttribute("aria-valuetext", "Aug 8 – Sep 6");

    fireEvent.keyDown(slider, { key: "+" });
    expect(onWindowChange).toHaveBeenLastCalledWith({ from: 41, to: 65 });
    expect(slider).toHaveAttribute("aria-valuetext", "Aug 11 – Sep 3");

    fireEvent.keyDown(slider, { key: "-" });
    expect(onWindowChange).toHaveBeenLastCalledWith({ from: 38, to: 68 });

    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuetext", "Sep 1 – Sep 30");
    // Clamped at today: a further step changes nothing.
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onWindowChange).toHaveBeenCalledTimes(5);
  });

  it("drags the window with the pointer", () => {
    const tape = dailyTape();
    const onWindowChange = vi.fn();
    renderWithListenProviders(
      <Harness
        tape={tape}
        mode={explorerMode("90d", tape)}
        initial={{ from: 30, to: 60 }}
        onWindowChange={onWindowChange}
      />,
      { locale: "en" },
    );
    const slider = screen.getByRole("slider", { name: "Selected stretch" });
    stripRect(slider, 920); // 10px per bucket

    const frame = slider.querySelector('[data-part="window"]')!;
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 450, button: 0 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 550 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 550 });
    expect(onWindowChange).toHaveBeenLastCalledWith({ from: 40, to: 70 });
    expect(slider).toHaveAttribute("aria-valuetext", "Aug 10 – Sep 8");

    const end = slider.querySelector('[data-part="end"]')!;
    fireEvent.pointerDown(end, {
      pointerId: 2,
      clientX: 700,
      pointerType: "touch",
    });
    fireEvent.pointerMove(slider, {
      pointerId: 2,
      clientX: 800,
      pointerType: "touch",
    });
    fireEvent.pointerUp(slider, { pointerId: 2 });
    expect(onWindowChange).toHaveBeenLastCalledWith({ from: 40, to: 80 });

    const calls = onWindowChange.mock.calls.length;
    fireEvent.pointerMove(slider, { pointerId: 2, clientX: 100 });
    expect(onWindowChange).toHaveBeenCalledTimes(calls);
  });

  it("opens a bucket with Enter", () => {
    const tape = dailyTape();
    const onOpenBucket = vi.fn();
    renderWithListenProviders(
      <Harness
        tape={tape}
        mode={explorerMode("90d", tape)}
        initial={{ from: 30, to: 60 }}
        onOpenBucket={onOpenBucket}
      />,
      { locale: "en" },
    );
    const chart = screen.getByRole("group", { name: CHART });

    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(within(chart).getByText("Fri, Aug 28")).toBeInTheDocument();
    expect(
      within(chart).getByText("Select to see the day"),
    ).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(onOpenBucket).toHaveBeenLastCalledWith(58);

    fireEvent.keyDown(chart, { key: "Home" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: " " });
    expect(onOpenBucket).toHaveBeenLastCalledWith(30);
  });

  it("has no slider in full mode", () => {
    const tape = dailyTape(30);
    const onOpenBucket = vi.fn();
    renderWithListenProviders(
      <Harness
        tape={tape}
        mode={explorerMode("30d", tape)}
        initial={{ from: 0, to: 30 }}
        onOpenBucket={onOpenBucket}
      />,
      { locale: "en" },
    );

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.queryByText("Drag the window, stretch its edges or pick a day."),
    ).not.toBeInTheDocument();
    const chart = screen.getByRole("group", { name: CHART });
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(onOpenBucket).toHaveBeenCalledWith(29);
  });

  it("month labels link to the month view", () => {
    const tape = dailyTape();
    const onMonth = vi.fn();
    renderWithListenProviders(
      <Harness
        tape={tape}
        mode={explorerMode("90d", tape)}
        initial={{ from: 62, to: 92 }}
        onMonth={onMonth}
      />,
      { locale: "en" },
    );

    expect(
      screen
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["July 2026", "August 2026", "September 2026"]);
    const august = screen.getByRole("link", { name: "August 2026" });
    expect(august).toHaveAttribute("href", "?month=2026-08");
    expect(august).toHaveTextContent("Aug");

    fireEvent.click(august);
    expect(onMonth).toHaveBeenCalledWith("2026-08");
  });

  it("renders at 375px", () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375,
    });
    try {
      const start = Date.UTC(2025, 9, 22);
      const tape: StatsTape = {
        ...dailyTape(),
        start: iso(start),
        end: iso(start + 365 * DAY),
        points: Array.from({ length: 365 }, (_, index) => ({
          bucket: iso(start + index * DAY),
          minutes: (index % 7) * 15,
          plays: 3,
        })),
      };
      const mode = explorerMode("365d", tape);
      const { container } = renderWithListenProviders(
        <Harness
          tape={tape}
          mode={mode}
          initial={{ from: 335, to: 365 }}
          panel={<aside data-testid="panel" />}
        />,
        { locale: "en" },
      );

      const layout = container.querySelector(".stats-explorer-layout")!;
      // The panel follows the chart, so a single-column container stacks it below.
      expect(layout.lastElementChild).toBe(screen.getByTestId("panel"));
      // Instruments scale with their container; nothing has a fixed pixel width.
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
      for (const svg of svgs) {
        expect(svg).toHaveAttribute("preserveAspectRatio", "none");
        expect(svg).not.toHaveAttribute("width");
      }
      // Dense month labels mark alternates so narrow containers can thin them.
      const months = screen.getAllByRole("link");
      expect(months.length).toBeGreaterThan(6);
      expect(
        months.filter((link) => link.hasAttribute("data-minor")),
      ).toHaveLength(Math.floor(months.length / 2));
      expect(
        screen.getByRole("slider", { name: "Selected stretch" }),
      ).toHaveAttribute("aria-valuetext", "Sep 22 – Oct 21");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
    }
  });
});
