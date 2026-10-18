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
  const pools = { fast: 0, default: 0, heavy: 0, maintenance: 0, playback: 0 };
  return {
    live: {
      engine: "dramatiq",
      running_tasks: history.filter((entry) => entry.status === "running"),
      pending_tasks: history.filter((entry) => entry.status === "pending"),
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
      queue_breakdown: { running: pools, pending: pools },
      db_heavy_gate: { active: 0, pending: 0, blocking: false },
      systems: { postgres: true, watcher: true },
    },
    history,
  };
}

function mockSnapshot(value = snapshot()) {
  apiMock.mockImplementation(async (path) => {
    if (path.startsWith("/api/admin/tasks-snapshot")) return value;
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
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage = null;
      onerror = null;
      close = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tasks operational controls", () => {
  it("uses the configured admission limit when consumer adoption is pending", async () => {
    mockSnapshot(snapshot({ admissionLimit: 7, workerSlots: 32 }));
    renderWithAdminProviders(<Tasks />);

    expect(await screen.findByText("7 concurrent tasks")).toBeInTheDocument();
    expect(screen.getAllByTitle("Idle slot")).toHaveLength(7);
    expect(screen.queryByText("32 concurrent tasks")).not.toBeInTheDocument();
  });

  it("keeps rendering snapshots that predate admission policy evidence", async () => {
    mockSnapshot(snapshot({ workerSlots: 5 }));
    renderWithAdminProviders(<Tasks />);

    expect(await screen.findByText("5 concurrent tasks")).toBeInTheDocument();
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
    expect(screen.getByText("Running")).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: "Cancel all" }));

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

    await user.click(await screen.findByRole("button", { name: "Cancel all" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Cancellation requested for 1 task. 1 task could not be cancelled; review current states.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
