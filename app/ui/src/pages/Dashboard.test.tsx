import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import data from "../../../../tests/admin-e2e/fixtures/dashboard-snapshot.json";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Dashboard } from "./Dashboard";
vi.mock("@/contexts/OpsSnapshotContext", () => ({ useOpsSnapshot: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn(async () => {});
const now = Date.parse("2026-10-18T10:00:00Z");
function fresh() {
  const value = structuredClone(data);
  value.snapshot.built_at = "2026-10-18T09:59:45Z";
  value.snapshot.stale_after = "2026-10-18T10:00:45Z";
  value.live.running_tasks[0]!.status = "running";
  value.live.running_tasks[0]!.progress = JSON.stringify({
    done: 3,
    total: 12,
    phase: "processing",
    item: "Costa Norte",
  });
  return value;
}
function snapshot(overrides: Partial<ReturnType<typeof useOpsSnapshot>> = {}) {
  vi.mocked(useOpsSnapshot).mockReturnValue({
    data: fresh() as unknown as ReturnType<typeof useOpsSnapshot>["data"],
    loading: false,
    error: null,
    refresh,
    ...overrides,
  });
}
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(isAdmin = true, capabilities?: string[]) {
  return renderWithAdminProviders(
    <>
      <Dashboard />
      <Location />
    </>,
    {
      auth: {
        isAdmin,
        hasCapability: (capability) =>
          !capabilities || capabilities.includes(capability),
      },
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockReset().mockResolvedValue({ task_id: "sample" });
  vi.spyOn(Date, "now").mockReturnValue(now);
  snapshot();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("Dashboard three-block operational summary", () => {
  it("keeps three named regions and removes unrelated content and repeated readouts", () => {
    const { container } = mount();
    for (const name of ["System", "Work in progress", "Needs attention"])
      expect(screen.getByRole("region", { name })).toBeVisible();
    expect(screen.getAllByRole("region")).toHaveLength(3);
    for (const name of [
      "Right Now",
      "Pipeline",
      "Library Changes",
      "Advanced Diagnostics",
      "Formats",
      "Upcoming",
    ])
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    expect(screen.getByText("Reported services responding")).toBeVisible();
    expect(
      screen.queryByText("Healthy", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Worker availability is not reported/),
    ).toBeVisible();
    expect(container.querySelectorAll("svg")).toHaveLength(3);
    for (const [name, marker] of [
      ["Refresh", "header-refresh"],
      ["Maintenance", "header-maintenance"],
    ]) {
      expect(
        screen.getByRole("button", { name }).querySelector("svg"),
      ).toHaveAttribute("data-admin-ux", marker);
    }
  });
  it("shows reported progress, daemon activity and dated historical failures without false urgency", () => {
    mount();
    expect(
      screen.getByRole("progressbar", {
        name: "Reported progress: Artist enrichment",
      }),
    ).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("processing · Costa Norte")).toBeVisible();
    expect(screen.getByText("Audio analysis")).toBeVisible();
    expect(screen.getByText(/^Last recorded failure/)).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Needs attention" }),
      ).queryByText(/failure/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Artist enrichment" }),
    ).toHaveAttribute("href", "/tasks?task=sample-running");
  });
  it("limits interruption warnings to explicit current service reports", () => {
    const value = fresh();
    value.live.systems.postgres = false;
    snapshot({
      data: value as unknown as ReturnType<typeof useOpsSnapshot>["data"],
    });
    mount();
    expect(screen.getByText("Service interruption reported")).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Needs attention" })).getByText(
        "PostgreSQL reported offline",
      ),
    ).toBeVisible();
  });
  it.each(["stale", "unavailable", "absent"])(
    "qualifies %s background analysis instead of claiming current activity",
    (kind) => {
      const value = fresh();
      if (kind !== "absent")
        Object.assign(value.analysis, {
          stale: true,
          unavailable: kind === "unavailable",
        });
      snapshot({
        data: value as unknown as ReturnType<typeof useOpsSnapshot>["data"],
      });
      mount();
      const work = within(
        screen.getByRole("region", { name: "Work in progress" }),
      );
      expect(
        work.getByText(
          kind === "stale"
            ? "Background analysis report out of date."
            : kind === "absent"
              ? "Background analysis report freshness unknown."
              : "Background analysis activity unavailable.",
        ),
      ).toBeVisible();
      if (kind === "unavailable")
        expect(
          work.queryByRole("list", { name: "Background analysis activity" }),
        ).not.toBeInTheDocument();
      else expect(work.getAllByText(/last reported active$/)).toHaveLength(2);
    },
  );
  it("expires an open report without polling and suppresses obsolete offline warnings", async () => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const value = fresh();
    value.live.systems.postgres = false;
    value.snapshot.stale_after = "2026-10-18T10:00:01Z";
    snapshot({
      data: value as unknown as ReturnType<typeof useOpsSnapshot>["data"],
    });
    const { unmount } = mount();
    expect(screen.getByText("Service interruption reported")).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.getByText("Report out of date")).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Work in progress" }),
      ).getByText(/^Last report ·/),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Needs attention" }),
      ).queryByText("PostgreSQL reported offline"),
    ).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves cached data after a refresh error without claiming fresh health", () => {
    snapshot({ error: "offline" });
    mount();
    expect(screen.getByText("Could not update the report")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Work in progress" }),
    ).toBeVisible();
  });
  it("names initial loading and first-load retry without invented counters", async () => {
    snapshot({ data: null, loading: true });
    const { unmount } = mount();
    expect(
      screen.getByRole("status", { name: "Loading dashboard" }),
    ).toBeVisible();
    unmount();
    snapshot({ data: null, error: "offline" });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to load dashboard",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledWith(true);
  });
  it("retains the last report while a background refresh is loading", () => {
    snapshot({ loading: true });
    mount();
    expect(screen.getByRole("region", { name: "System" })).toBeVisible();
  });
  it("keeps unknown payloads honest and omits links and maintenance without capabilities", () => {
    snapshot({
      data: { snapshot: {} } as ReturnType<typeof useOpsSnapshot>["data"],
    });
    mount(false, []);
    expect(screen.getByText("Report freshness unknown")).toBeVisible();
    expect(screen.getAllByText("Unreported")).toHaveLength(3);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Maintenance" }),
    ).not.toBeInTheDocument();
  });
  it("keeps only sync available for a non-admin with import capability", async () => {
    mount(false, ["library.import.manage", "library.maintenance.manage"]);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Maintenance" }));
    const dialog = screen.getByRole("dialog", { name: "Library maintenance" });
    expect(
      within(dialog).getByRole("button", { name: "Sync library" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "Wipe database" }),
    ).not.toBeInTheDocument();
  });
  it.each([false, true])(
    "preserves sync result and failure recovery: %s",
    async (fail) => {
      if (fail) vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
      mount();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Maintenance" }));
      await user.click(screen.getByRole("button", { name: "Sync library" }));
      expect(api).toHaveBeenCalledExactlyOnceWith(
        "/api/tasks/sync-library",
        "POST",
      );
      if (fail) {
        expect(toast.error).toHaveBeenCalledWith(
          "Sync already running or failed",
        );
        expect(refresh).not.toHaveBeenCalled();
      } else {
        expect(toast.success).toHaveBeenCalledWith("Library sync started");
        expect(refresh).toHaveBeenCalledWith(true);
      }
    },
  );
  it.each([
    [
      "Rebuild library",
      "Rebuild Library",
      "REBUILD",
      "/api/manage/rebuild",
      undefined,
      "Library rebuild started",
      "Failed to start rebuild",
    ],
    [
      "Wipe database",
      "Wipe Database",
      "WIPE",
      "/api/manage/wipe",
      { rebuild: false },
      "Library database wiped",
      "Failed to wipe database",
    ],
  ] as const)(
    "retains typed %s and cancellation",
    async (trigger, confirm, word, path, body, success, error) => {
      mount();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Maintenance" }));
      const open = screen.getByRole("button", { name: trigger });
      await user.click(open);
      let dialog = screen.getByRole("alertdialog");
      expect(
        within(dialog).getByRole("button", { name: confirm }),
      ).toBeDisabled();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(api).not.toHaveBeenCalled();
      await user.click(open);
      dialog = screen.getByRole("alertdialog");
      await user.type(
        within(dialog).getByLabelText(`Type ${word} to confirm`),
        word,
      );
      await user.click(within(dialog).getByRole("button", { name: confirm }));
      expect(api).toHaveBeenCalledWith(
        ...(body ? [path, "POST", body] : [path, "POST"]),
      );
      expect(toast.success).toHaveBeenCalledWith(success);
      expect(refresh).toHaveBeenCalledWith(true);
      vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
      await user.click(open);
      dialog = screen.getByRole("alertdialog");
      await user.type(
        within(dialog).getByLabelText(`Type ${word} to confirm`),
        word,
      );
      await user.click(within(dialog).getByRole("button", { name: confirm }));
      expect(toast.error).toHaveBeenCalledWith(error);
    },
  );
});
