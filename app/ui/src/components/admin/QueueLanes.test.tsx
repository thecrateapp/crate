import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueueLanes, type QueueLaneBreakdown } from "./QueueLanes";

const emptyCounts = {
  fast: 0,
  default: 0,
  heavy: 0,
  maintenance: 0,
  playback: 0,
};

function breakdown(
  overrides: {
    running?: Partial<QueueLaneBreakdown["running"]>;
    pending?: Partial<QueueLaneBreakdown["pending"]>;
  } = {},
): QueueLaneBreakdown {
  return {
    running: { ...emptyCounts, ...(overrides.running ?? {}) },
    pending: { ...emptyCounts, ...(overrides.pending ?? {}) },
  };
}

function mockReducedMotion(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener),
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", () => query);
  return {
    set(next: boolean) {
      (query as { matches: boolean }).matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("QueueLanes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders the five original site lanes with live tasks in their status zones", () => {
    render(
      <QueueLanes
        breakdown={breakdown({
          running: { maintenance: 2 },
          pending: { maintenance: 3 },
        })}
        runningTasks={[
          { id: "a", type: "quality_check", pool: "maintenance" },
          { id: "b", type: "repair", pool: "maintenance" },
        ]}
        pendingTasks={[
          {
            id: "c",
            type: "backfill_artwork_variants",
            pool: "maintenance",
            status: "pending",
            progress: "Deferred by resource governor: high system load",
          },
        ]}
        doneTasks={[
          { id: "d", type: "scan", pool: "maintenance", status: "completed" },
          { id: "e", type: "repair", pool: "maintenance", status: "failed" },
        ]}
        taskTypeCount={125}
      />,
    );

    const queues = screen.getByRole("region", { name: "Worker queue lanes" });
    expect(queues).toHaveTextContent("Operations");
    expect(queues).toHaveTextContent("125 task types · five queues");
    expect(queues).toHaveTextContent("governed by the resource governor");
    expect(screen.getAllByTestId(/^queue-lane-/)).toHaveLength(5);

    const maintenance = screen.getByRole("listitem", {
      name: "maintenance queue",
    });
    expect(maintenance).toHaveTextContent("5");
    expect(maintenance).toHaveTextContent("maintenance-worker ×1");
    expect(maintenance).toHaveTextContent("2 running · 3 queued");
    const maintenanceFlow = within(maintenance).getByRole("group", {
      name: "maintenance task flow",
    });
    expect(maintenanceFlow).toHaveClass("min-h-12");
    expect(maintenanceFlow).toHaveTextContent("backfill_artwork_variants");
    const qualityChip = within(maintenanceFlow).getByRole("img", {
      name: "Quality Check · running",
    });
    expect(qualityChip).toHaveClass("top-[19px]");
    expect(maintenance).toHaveTextContent("quality_check");
    expect(maintenance).toHaveTextContent("scan");
    expect(maintenance).toHaveTextContent("+1");
  });

  it("keeps empty queue zones legible and reports work beyond the task sample", () => {
    render(
      <QueueLanes
        breakdown={breakdown({ pending: { playback: 2 } })}
        runningTasks={[]}
        pendingTasks={[]}
      />,
    );

    const queues = screen.getByRole("region", { name: "Worker queue lanes" });
    expect(screen.getAllByTestId(/^queue-lane-/)).toHaveLength(5);
    expect(
      within(queues).getByRole("listitem", { name: "playback queue" }),
    ).toHaveTextContent("playback-worker");
    const playback = within(queues).getByRole("listitem", {
      name: "playback queue",
    });
    expect(
      within(playback).getByRole("group", { name: "playback task flow" }),
    ).toHaveTextContent("+2");
    expect(playback).toHaveTextContent("0 running · 2 queued");
    expect(playback).toHaveTextContent("2 queued, 0 running, 0 recently done");
  });

  it("opens the existing task detail when a task chip is selected", () => {
    const onTaskSelect = vi.fn();
    render(
      <QueueLanes
        breakdown={breakdown({ running: { heavy: 1 } })}
        runningTasks={[
          {
            id: "analysis-42",
            type: "audio_analysis",
            pool: "heavy",
            progress: { done: 25, total: 100 },
          },
        ]}
        pendingTasks={[]}
        onTaskSelect={onTaskSelect}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Audio Analysis task details · running",
      }),
    );
    expect(onTaskSelect).toHaveBeenCalledWith("analysis-42");
  });

  it("moves the same chip across the track when the live snapshot starts a queued task", () => {
    const { rerender } = render(
      <QueueLanes
        breakdown={breakdown({ pending: { fast: 1 } })}
        runningTasks={[]}
        pendingTasks={[
          {
            id: "fast-42",
            type: "fetch_cover",
            pool: "fast",
            status: "pending",
          },
        ]}
      />,
    );

    const chip = screen.getByRole("img", { name: "Fetch Cover · queued" });
    expect(chip).toHaveStyle({ left: "2%" });

    rerender(
      <QueueLanes
        breakdown={breakdown({ running: { fast: 1 } })}
        runningTasks={[
          {
            id: "fast-42",
            type: "fetch_cover",
            pool: "fast",
            status: "running",
          },
        ]}
        pendingTasks={[]}
      />,
    );

    const movedChip = screen.getByRole("img", {
      name: "Fetch Cover · running",
    });
    expect(movedChip).toBe(chip);
    expect(movedChip).toHaveStyle({ left: "36%" });
    expect(movedChip).toHaveClass("duration-700");
  });

  it("keeps the running lane visible before settling a fast completed task", () => {
    vi.useFakeTimers();
    try {
      const task = {
        id: "fast-43",
        type: "fetch_cover",
        pool: "fast",
        status: "pending",
        created_at: "2026-10-22T10:00:00.000Z",
        updated_at: "2026-10-22T10:00:00.000Z",
      };
      const baseProps = {
        breakdown: breakdown({ pending: { fast: 1 } }),
        runningTasks: [] as { id: string; type: string; pool: string }[],
        pendingTasks: [task],
      };
      const { rerender } = render(<QueueLanes {...baseProps} />);

      rerender(
        <QueueLanes
          {...baseProps}
          transitions={[
            { ...task, sequence: 1 },
            {
              ...task,
              status: "running",
              started_at: "2026-10-22T10:00:00.010Z",
              updated_at: "2026-10-22T10:00:00.010Z",
              sequence: 2,
            },
            {
              ...task,
              status: "completed",
              started_at: "2026-10-22T10:00:00.010Z",
              updated_at: "2026-10-22T10:00:00.050Z",
              sequence: 3,
            },
          ]}
        />,
      );

      expect(
        screen.getByRole("img", { name: "Fetch Cover · running" }),
      ).toHaveStyle({
        left: "36%",
      });
      act(() => vi.advanceTimersByTime(799));
      expect(
        screen.getByRole("img", { name: "Fetch Cover · running" }),
      ).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(
        screen.getByRole("img", { name: "Fetch Cover · done" }),
      ).toHaveStyle({
        left: "86%",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays lifecycle events even when the first snapshot already shows completion", () => {
    vi.useFakeTimers();
    try {
      const task = {
        id: "fast-44",
        type: "fetch_cover",
        pool: "fast",
        status: "completed",
        created_at: "2026-10-22T10:00:00.000Z",
        started_at: "2026-10-22T10:00:00.010Z",
        updated_at: "2026-10-22T10:00:00.050Z",
      };

      render(
        <QueueLanes
          breakdown={breakdown()}
          runningTasks={[]}
          pendingTasks={[]}
          doneTasks={[task]}
          transitions={[
            {
              ...task,
              status: "pending",
              updated_at: "2026-10-22T10:00:00.000Z",
              sequence: 1,
            },
            {
              ...task,
              status: "running",
              updated_at: "2026-10-22T10:00:00.010Z",
              sequence: 2,
            },
            { ...task, sequence: 3 },
          ]}
        />,
      );

      expect(
        screen.getByRole("img", { name: "Fetch Cover · running" }),
      ).toHaveStyle({ left: "36%" });
      act(() => vi.advanceTimersByTime(800));
      expect(
        screen.getByRole("img", { name: "Fetch Cover · done" }),
      ).toHaveStyle({ left: "86%" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles fast tasks immediately when reduced motion is enabled", () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    const task = {
      id: "fast-45",
      type: "fetch_cover",
      pool: "fast",
      status: "completed",
      created_at: "2026-10-22T10:00:00.000Z",
      started_at: "2026-10-22T10:00:00.010Z",
      updated_at: "2026-10-22T10:00:00.050Z",
    };

    render(
      <QueueLanes
        breakdown={breakdown()}
        runningTasks={[]}
        pendingTasks={[]}
        doneTasks={[task]}
        transitions={[
          {
            ...task,
            status: "pending",
            updated_at: "2026-10-22T10:00:00.000Z",
            sequence: 1,
          },
          {
            ...task,
            status: "running",
            updated_at: "2026-10-22T10:00:00.010Z",
            sequence: 2,
          },
          { ...task, sequence: 3 },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Fetch Cover · done" })).toHaveStyle(
      { left: "86%" },
    );
    expect(
      screen.queryByRole("img", { name: "Fetch Cover · running" }),
    ).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles an in-flight visibility hold when reduced motion becomes active", () => {
    vi.useFakeTimers();
    const media = mockReducedMotion(false);
    const task = {
      id: "fast-46",
      type: "fetch_cover",
      pool: "fast",
      status: "completed",
      created_at: "2026-10-22T10:00:00.000Z",
      started_at: "2026-10-22T10:00:00.010Z",
      updated_at: "2026-10-22T10:00:00.050Z",
    };

    render(
      <QueueLanes
        breakdown={breakdown()}
        runningTasks={[]}
        pendingTasks={[]}
        doneTasks={[task]}
        transitions={[
          {
            ...task,
            status: "pending",
            updated_at: "2026-10-22T10:00:00.000Z",
            sequence: 1,
          },
          {
            ...task,
            status: "running",
            updated_at: "2026-10-22T10:00:00.010Z",
            sequence: 2,
          },
          { ...task, sequence: 3 },
        ]}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Fetch Cover · running" }),
    ).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);

    act(() => media.set(true));

    expect(screen.getByRole("img", { name: "Fetch Cover · done" })).toHaveStyle(
      { left: "86%" },
    );
    expect(
      screen.queryByRole("img", { name: "Fetch Cover · running" }),
    ).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
