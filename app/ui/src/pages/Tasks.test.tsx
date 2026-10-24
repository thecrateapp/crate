import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Tasks } from "./Tasks";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/task-catalog", () => ({
  useTaskCatalog: () => null,
  taskLabel: (type: string) => type,
}));

const streamCreated = vi.fn();

class TestEventSource {
  static taskStream: TestEventSource | undefined;
  static taskEventStream: TestEventSource | undefined;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners: Record<string, (event: MessageEvent) => void> = {};
  close = vi.fn();

  constructor(readonly url: string) {
    streamCreated(url);
    if (url === "/api/admin/tasks-stream?limit=100")
      TestEventSource.taskStream = this;
    if (url.startsWith("/api/events/task/"))
      TestEventSource.taskEventStream = this;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners[type] = listener;
  }

  dispatch(type: string, payload: unknown) {
    this.listeners[type]?.(
      new MessageEvent(type, { data: JSON.stringify(payload) }),
    );
  }
}

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
    snapshot: {
      scope: "ops:tasks",
      subject_key: "global",
      version: 1,
      built_at: "2026-10-22T09:30:00Z",
      stale_after: "2026-10-22T09:35:00Z",
      stale: false,
      generation_ms: 2,
    },
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
  it("retains cancellation confirmation while its request is pending", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api).mockImplementation((path, method) =>
      method === "POST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(
            path.startsWith("/api/admin/tasks-snapshot")
              ? taskSnapshot({ percent: 10 })
              : null,
          ),
    );
    renderWithAdminProviders(<Tasks />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel task",
      }),
    );
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeDisabled();
    await act(async () => finish({ status: "cancelled" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  beforeEach(() => {
    vi.mocked(api).mockReset();
    TestEventSource.taskStream = undefined;
    TestEventSource.taskEventStream = undefined;
    streamCreated.mockClear();
    vi.stubGlobal("EventSource", TestEventSource);
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
    act(() =>
      TestEventSource.taskStream?.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(
            taskSnapshot({ phase: "Scanning", done: 4, total: 8 }),
          ),
        }),
      ),
    );
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(
      streamCreated.mock.calls.filter(
        ([url]) => url === "/api/admin/tasks-stream?limit=100",
      ),
    ).toHaveLength(1);
  });

  it("keeps the last successful task snapshot visible when a manual refresh fails", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/api/admin/tasks-snapshot")) {
        if (path.includes("fresh=1")) throw new Error("network unavailable");
        return taskSnapshot({ phase: "Scanning", done: 2, total: 8 });
      }
      return null;
    });
    const user = userEvent.setup();
    renderWithAdminProviders(<Tasks />, { route: "/tasks" });

    expect(await screen.findByRole("progressbar")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Refresh" })[0]!);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Showing the last successful snapshot.");
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.getByText("Snapshot stale")).toBeVisible();
  });

  it("reuses the active task stream when its live event log is expanded", async () => {
    const user = userEvent.setup();
    serveTasks({ phase: "Scanning", item: "Slowdive" });
    renderWithAdminProviders(<Tasks />, { route: "/tasks" });

    await screen.findByRole("progressbar");
    const activeTaskStreams = () =>
      streamCreated.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/events/task/active-scan"),
      );
    expect(activeTaskStreams()).toHaveLength(1);
    expect(streamCreated).toHaveBeenCalledWith(
      "/api/events/task/active-scan?generic=1",
    );

    await user.click(screen.getByRole("button", { name: "Live events" }));
    act(() => TestEventSource.taskEventStream?.onopen?.(new Event("open")));

    expect(screen.getByText("Waiting for live events…")).toBeInTheDocument();
    expect(activeTaskStreams()).toHaveLength(1);
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
        TestEventSource.taskEventStream?.dispatch("task_done", { status });
        TestEventSource.taskStream?.onmessage?.(
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
      TestEventSource.taskEventStream?.dispatch("task_done", {
        status: "completed",
      });
      TestEventSource.taskStream?.onmessage?.(
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
