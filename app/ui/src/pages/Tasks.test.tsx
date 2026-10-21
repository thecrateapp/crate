import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Tasks } from "./Tasks";

const taskEvents = vi.hoisted(() => ({
  done: null as { status: string } | null,
}));

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/hooks/use-task-events", () => ({
  useTaskEvents: () => ({
    events: [],
    done: taskEvents.done,
    connected: true,
    reset: vi.fn(),
  }),
}));
vi.mock("@/lib/task-catalog", () => ({
  useTaskCatalog: () => null,
  taskLabel: (type: string) => type,
}));

let taskStream: {
  onmessage: ((event: MessageEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
};
const streamCreated = vi.fn();

function taskSnapshot(progress: Record<string, unknown>) {
  const task = {
    id: "active-scan",
    type: "library_scan",
    status: "running",
    progress,
    created_at: "2026-10-16T10:00:00Z",
    started_at: "2026-10-16T10:00:00Z",
    updated_at: "2026-10-16T10:01:00Z",
    error: null,
    params: null,
    result: null,
  };
  const queues = { fast: 0, default: 0, heavy: 0, maintenance: 0, playback: 0 };
  return {
    live: {
      engine: "dramatiq",
      running_tasks: [task],
      pending_tasks: [],
      recent_tasks: [],
      worker_slots: { max: 3, active: 1 },
      queue_breakdown: { running: queues, pending: queues },
      db_heavy_gate: { active: 0, pending: 0, blocking: false },
      systems: { postgres: true, watcher: true },
    },
    history: [task],
  };
}

function serveTasks(progress: Record<string, unknown>) {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/api/admin/tasks-snapshot"))
      return taskSnapshot(progress);
    return null;
  });
}

describe("Tasks progress", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    taskEvents.done = null;
    streamCreated.mockClear();
    vi.stubGlobal("EventSource", function (url: string) {
      streamCreated(url);
      taskStream = { onmessage: null, close: vi.fn() };
      return taskStream;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders named task progress from snapshots and updates it through the existing stream", async () => {
    serveTasks({
      phase: "Scanning",
      item: "Slowdive",
      done: 2,
      total: 8,
      rate: 1.5,
      eta_sec: 4,
    });
    renderWithAdminProviders(<Tasks />, { route: "/tasks" });
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAccessibleName();
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/2.*8/),
    );
    expect(screen.getByText("Slowdive")).toBeInTheDocument();
    expect(screen.getByText("1.5/s")).toBeInTheDocument();
    expect(screen.getByText("ETA 4s")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel" }).className,
    ).not.toMatch(/state-warning|destructive/);
    expect(
      screen
        .getAllByText("Running", { exact: true })
        .some((node) => node.className.includes("text-accent-action-hi")),
    ).toBe(true);
    act(
      () =>
        taskStream.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(
              taskSnapshot({ phase: "Scanning", done: 4, total: 8 }),
            ),
          }),
        ),
    );
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(streamCreated).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/tasks-stream?limit=100",
    );
  });

  it("preserves server percentage when it differs from the item ratio", async () => {
    serveTasks({ phase: "Analysing", done: 2, total: 8, percent: 61 });
    renderWithAdminProviders(<Tasks />, { route: "/tasks" });
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "61",
    );
  });

  it("keeps unknown totals indeterminate while retaining the task step", async () => {
    serveTasks({ phase: "Preparing", step: "opening_library", total: 0 });
    renderWithAdminProviders(<Tasks />, { route: "/tasks" });
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAccessibleName();
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("data-indeterminate", "true");
    expect(screen.getByText(/opening library/i)).toBeInTheDocument();
  });
  it.each(["completed", "failed", "cancelled"])(
    "stops indeterminate progress when task events report %s before the snapshot catches up",
    async (status) => {
      const progress = { step: "opening_library", total: 0 };
      serveTasks(progress);
      renderWithAdminProviders(<Tasks />, { route: "/tasks" });
      const bar = await screen.findByRole("progressbar");
      expect(bar).toHaveAttribute("data-indeterminate", "true");
      expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

      act(() => {
        taskEvents.done = { status };
        taskStream.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(taskSnapshot(progress)),
          }),
        );
      });

      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.getByText(/opening library/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    },
  );

  it("preserves the final numeric reading after a terminal task event", async () => {
    const progress = { phase: "Analysing", done: 2, total: 8, percent: 61 };
    serveTasks(progress);
    renderWithAdminProviders(<Tasks />, { route: "/tasks" });
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "61");

    act(() => {
      taskEvents.done = { status: "completed" };
      taskStream.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(taskSnapshot(progress)),
        }),
      );
    });

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "61",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
