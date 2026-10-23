import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/hooks/use-task-events", () => ({
  useTaskEvents: () => ({ events: [], done: null }),
}));
vi.mock("@/lib/task-catalog", () => ({
  useTaskCatalog: () => null,
  taskLabel: (type: string) => type,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Tasks } from "./Tasks";

const apiMock = vi.mocked(api);
const timestamp = "2026-10-16T10:00:00Z";

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners = new Map<string, EventListener[]>();
  close = vi.fn();

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit,
  ) {
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function task(overrides = {}) {
  return {
    id: "maintenance-1",
    type: "quality_check",
    status: "running",
    progress: {},
    error: null,
    params: {},
    result: null,
    pool: "maintenance",
    created_at: timestamp,
    started_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}

function snapshot({
  admissionLimit,
  workerSlots = 32,
  history = [] as ReturnType<typeof task>[],
}: {
  admissionLimit?: number;
  workerSlots?: number;
  history?: ReturnType<typeof task>[];
} = {}) {
  const runningTasks = history.filter((entry) => entry.status === "running");
  const pendingTasks = history.filter((entry) => entry.status === "pending");
  const countsFor = (tasks: ReturnType<typeof task>[]) => {
    const counts = {
      fast: 0,
      default: 0,
      heavy: 0,
      maintenance: 0,
      playback: 0,
    };
    for (const entry of tasks) {
      if (entry.pool && entry.pool in counts)
        counts[entry.pool as keyof typeof counts] += 1;
    }
    return counts;
  };
  return {
    live: {
      engine: "dramatiq",
      running_tasks: runningTasks,
      pending_tasks: pendingTasks,
      recent_tasks: [],
      worker_slots: { max: workerSlots, active: 0 },
      ...(admissionLimit === undefined
        ? {}
        : {
            admission_policy: {
              max_running: admissionLimit,
              configured_revision: 7,
              effective_revision: 6,
            },
          }),
      queue_breakdown: {
        running: countsFor(runningTasks),
        pending: countsFor(pendingTasks),
      },
      db_heavy_gate: { active: 0, pending: 0, blocking: false },
      systems: { postgres: true, watcher: true },
    },
    history,
  };
}

function mockSnapshot(value = snapshot()) {
  apiMock.mockImplementation(async (path) => {
    if (path.startsWith("/api/admin/tasks-snapshot")) return value;
    if (path === "/api/admin/governor") {
      return { available: false, stale: false, gauges: [] };
    }
    if (path === "/api/admin/playback-delivery?limit=8") {
      return {
        stats: {},
        runtime: { active: 0, limit: 2 },
        recent_variants: [],
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.latest = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tasks operational controls", () => {
  it("shows running and pending task detail in the matching queue lane", async () => {
    mockSnapshot(
      snapshot({
        history: [
          task({ id: "active-maintenance", type: "quality_check" }),
          task({
            id: "queued-maintenance",
            type: "metadata_sync",
            status: "pending",
            started_at: null,
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    const lane = await screen.findByRole("listitem", {
      name: "maintenance queue",
    });
    expect(lane).toHaveTextContent("1 running · 1 queued");
    expect(lane).toHaveTextContent("quality_check");
    expect(lane).toHaveTextContent("metadata_sync");
  });

  it("moves a queue chip as soon as the task lifecycle SSE event arrives", async () => {
    mockSnapshot(
      snapshot({
        history: [
          task({
            id: "queued-transition",
            type: "metadata_sync",
            status: "pending",
            started_at: null,
            pool: "maintenance",
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    expect(
      await screen.findByRole("button", {
        name: "Open metadata_sync task details · queued",
      }),
    ).toBeVisible();
    const stream = FakeEventSource.latest;
    expect(stream?.url).toBe("/api/admin/tasks-stream?limit=100");

    stream?.emit(
      "task_transition",
      JSON.stringify({
        id: "queued-transition",
        type: "metadata_sync",
        status: "running",
        pool: "maintenance",
        created_at: timestamp,
        started_at: "2026-10-16T10:00:01Z",
        updated_at: "2026-10-16T10:00:01Z",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Open metadata_sync task details · running",
      }),
    ).toHaveStyle({ left: "36%" });
  });

  it("gives the DB-heavy gate room after the governor unavailable message", async () => {
    mockSnapshot();
    renderWithAdminProviders(<Tasks />);

    const governor = await screen.findByRole("region", {
      name: "Resource governor",
    });
    expect(
      screen.getByText("No worker sample is available yet."),
    ).toBeVisible();

    const gate = screen.getByRole("group", { name: "DB-heavy gate" });
    expect(governor.parentElement).toHaveClass("flex", "flex-col", "gap-10");
    expect(gate.parentElement).toBe(governor.parentElement);
    expect(
      screen.getByText("No DB-heavy serialization pressure right now."),
    ).toBeVisible();
  });

  it("keeps live work, attention and history in one task desk instead of duplicate panels", async () => {
    const user = userEvent.setup();
    mockSnapshot(
      snapshot({
        history: [
          task({ id: "running-task", label: "Live enrichment" }),
          task({
            id: "failed-task",
            label: "Failed import",
            status: "failed",
            error: "Import failed",
            started_at: timestamp,
          }),
          task({
            id: "completed-task",
            label: "Finished sync",
            status: "completed",
            started_at: timestamp,
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    expect(
      await screen.findByRole("heading", { name: "Task desk" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Worker runtime" }),
    ).toBeVisible();
    expect(screen.queryByText("Success rate")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Playback delivery" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recent repair runs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Active & queued" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Live enrichment")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Needs attention" }));
    expect(screen.getByText("Failed import")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("Finished sync")).toBeVisible();
    const cleanupActions = screen.getByRole("button", {
      name: "Task cleanup actions",
    });
    expect(cleanupActions).toBeVisible();
    expect(cleanupActions).not.toHaveAttribute("title");
  });

  it("keeps task error details on the approved warning palette", async () => {
    const user = userEvent.setup();
    mockSnapshot(
      snapshot({
        history: [
          task({
            id: "failed-task",
            label: "Failed import",
            status: "failed",
            error: "Import failed",
            started_at: timestamp,
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    await user.click(
      await screen.findByRole("tab", { name: "Needs attention" }),
    );
    await user.click(screen.getByText("Failed import"));

    const errorDetails = await screen.findByText("Import failed", {
      selector: "pre",
    });
    expect(errorDetails).toHaveClass(
      "border-state-warning/20",
      "bg-state-warning/[0.05]",
      "text-state-warning-text",
    );
  });

  it("uses aligned family filters and the compact page-header refresh action", async () => {
    const user = userEvent.setup();
    mockSnapshot(
      snapshot({
        history: [
          task({
            id: "analysis-task",
            type: "analyze_tracks",
            label: "Analysis work",
            pool: "heavy",
          }),
          task({
            id: "repair-task",
            type: "quality_check",
            label: "Repair work",
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    const refresh = await screen.findByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("data-size", "icon-lg");
    expect(refresh).not.toHaveTextContent("Refresh");

    const workerLogs = screen.getByRole("link", { name: "Worker logs" });
    expect(workerLogs).toHaveAttribute("href", "/logs");
    expect(workerLogs).toHaveAttribute("data-size", "icon-lg");
    expect(workerLogs).not.toHaveTextContent("Worker logs");
    const cancelAll = screen.getByRole("button", {
      name: "Cancel all tasks",
    });
    expect(cancelAll).toHaveAttribute("data-size", "icon-lg");
    expect(cancelAll).not.toHaveTextContent("Cancel all");
    const restartWorker = screen.getByRole("button", {
      name: "Restart crate-worker",
    });
    expect(restartWorker).toHaveAttribute("data-size", "icon-lg");
    expect(restartWorker).not.toHaveTextContent("Restart");
    await user.hover(restartWorker);
    expect(
      await screen.findByRole("tooltip", {
        name: "Restarts crate-worker: default and fast queues plus its service loop.",
      }),
    ).toBeVisible();
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/stack/container/crate-worker/logs?tail=40",
    );
    expect(screen.queryByText("Loading worker logs…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase worker concurrency" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Worker concurrency controls" }),
    ).toBeVisible();
    await user.hover(
      screen.getByRole("button", { name: "Increase worker concurrency" }),
    );
    expect(
      await screen.findByRole("tooltip", {
        name: "Increase worker concurrency",
      }),
    ).toBeVisible();

    expect(await screen.findByText("Analysis work")).toBeVisible();
    expect(screen.getByText("Repair work")).toBeVisible();
    const familyFilter = screen.getByRole("combobox", { name: "Task family" });
    expect(familyFilter).toHaveTextContent("All families");
    await user.click(familyFilter);
    await user.click(await screen.findByRole("option", { name: "Analysis" }));

    expect(screen.getByText("Analysis work")).toBeVisible();
    expect(screen.queryByText("Repair work")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "All task types" }),
    ).toBeVisible();
  });

  it("uses the configured admission limit when consumer adoption is pending", async () => {
    mockSnapshot(snapshot({ admissionLimit: 7, workerSlots: 32 }));
    renderWithAdminProviders(<Tasks />);

    expect(await screen.findByText("7 concurrent tasks")).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", { name: /Worker slot \d+: Idle/ }),
    ).toHaveLength(7);
    expect(screen.queryAllByTitle("Idle slot")).toHaveLength(0);
    expect(screen.queryByText("32 concurrent tasks")).not.toBeInTheDocument();
  });

  it("keeps rendering snapshots that predate admission policy evidence", async () => {
    mockSnapshot(snapshot({ workerSlots: 5 }));
    renderWithAdminProviders(<Tasks />);

    expect(await screen.findByText("5 concurrent tasks")).toBeInTheDocument();
  });

  it("uses shared status badges and an accessible retry action in attention rows", async () => {
    const user = userEvent.setup();
    mockSnapshot(
      snapshot({
        history: [
          task({
            id: "failed-repair",
            type: "repair",
            label: "Failed quality check",
            status: "failed",
            params: { artist: "Slowdive" },
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    await user.click(
      await screen.findByRole("tab", { name: "Needs attention" }),
    );
    const failedBadge = screen
      .getByText("Failed", { exact: true })
      .closest('[data-slot="info-badge"]');
    const familyBadge = screen
      .getByText("Repair", { exact: true })
      .closest('[data-slot="info-badge"]');
    expect(failedBadge).toHaveAttribute("data-tone", "danger");
    expect(familyBadge).toHaveAttribute("data-tone", "neutral");

    const retry = screen.getByRole("button", {
      name: "Retry Failed quality check: Slowdive",
    });
    expect(retry).toHaveAttribute("data-size", "icon-lg");
    expect(retry).not.toHaveAttribute("title");
    expect(retry.parentElement?.closest("button")).toBeNull();
    await user.hover(retry);
    expect(
      await screen.findByRole("tooltip", { name: "Retry task" }),
    ).toBeVisible();

    const expand = screen.getByRole("button", {
      name: /Failed quality check: SlowdiveFailedRepair/,
    });
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Params")).toBeVisible();
    await user.click(expand!);
    expect(expand).toHaveAttribute("aria-expanded", "false");
  });

  it("uses the shared inline empty state when active tasks are filtered out", async () => {
    mockSnapshot();
    renderWithAdminProviders(<Tasks />);

    const emptyState = await screen.findByTestId("empty-state");
    expect(emptyState).toHaveTextContent(
      "No active tasks match the current filters.",
    );
    expect(emptyState).not.toHaveClass("border-dashed");
  });

  it("keeps a running task active while cancellation awaits acknowledgement", async () => {
    mockSnapshot(
      snapshot({
        history: [task({ cancellation_requested_at: timestamp })],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    expect(
      await screen.findByText("Cancellation requested"),
    ).toBeInTheDocument();
    const taskMetadata = screen
      .getByText("Cancellation requested")
      .closest('[data-slot="info-badge"]')?.parentElement;
    expect(taskMetadata).toHaveTextContent("Running");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("hides the pending cancellation label after worker acknowledgement", async () => {
    mockSnapshot(
      snapshot({
        history: [
          task({
            cancellation_requested_at: timestamp,
            cancellation_acknowledged_at: timestamp,
          }),
        ],
      }),
    );
    renderWithAdminProviders(<Tasks />);

    await screen.findByRole("button", { name: "Cancel" });
    expect(
      screen.queryByText("Cancellation requested"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["running", "Cancellation requested"],
    ["cancelled", "Task cancelled"],
  ])("reports the cancellation response state %s", async (status, message) => {
    const user = userEvent.setup();
    const current = snapshot({ history: [task()] });
    mockSnapshot(current);
    const read = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path, ...args) =>
      path === "/api/tasks/maintenance-1/cancel"
        ? { status, cancellation_requested: true }
        : read(path, ...args),
    );
    renderWithAdminProviders(<Tasks />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel task",
      }),
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(message));
    expect(apiMock).toHaveBeenCalledWith(
      "/api/tasks/maintenance-1/cancel",
      "POST",
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/tasks-snapshot?limit=100&fresh=1",
    );
  });

  it("reports cancel-all acceptance as requested cancellation", async () => {
    const user = userEvent.setup();
    mockSnapshot();
    const read = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path, ...args) =>
      path === "/api/worker/cancel-all"
        ? { cancelled: 2 }
        : read(path, ...args),
    );
    renderWithAdminProviders(<Tasks />);

    await user.click(
      await screen.findByRole("button", { name: "Cancel all tasks" }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Cancellation requested for 2 tasks",
      ),
    );
  });

  it("reports jobs skipped by cancel-all instead of claiming all requests succeeded", async () => {
    const user = userEvent.setup();
    mockSnapshot();
    const read = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path, ...args) =>
      path === "/api/worker/cancel-all"
        ? {
            cancelled: 1,
            skipped: 1,
            items: [
              {
                task_id: "finishing",
                request_state: "rejected",
                error_code: "STATE_CONFLICT",
              },
            ],
          }
        : read(path, ...args),
    );
    renderWithAdminProviders(<Tasks />);

    await user.click(
      await screen.findByRole("button", { name: "Cancel all tasks" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Cancellation requested for 1 task. 1 task could not be cancelled; review current states.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
