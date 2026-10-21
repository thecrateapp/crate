import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { ArtistRepairDialog } from "./ArtistRepairDialog";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("@/hooks/use-task-events", () => ({
  useTaskEvents: () => ({ events: [], done: null }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockApi = vi.mocked(api);
const mockWaitForTask = vi.mocked(waitForTask);

function makePlan() {
  return {
    artist: "Selected",
    status: "completed",
    preparation_task_id: "prepare-job",
    plan_version: "repair-preview:complete-plan-version",
    total: 2,
    executable: 2,
    manual_only: 0,
    items: [
      {
        issue_id: 7,
        item_key: "issue:7",
        plan_item_id: "repair-plan:photo",
        check_type: "has_photo_desync",
        support: "automatic",
        risk: "safe",
        scope: "db",
        requires_confirmation: false,
        supports_batch: true,
        supports_artist_scope: true,
        auto_fixable: true,
        executable: true,
        target: "Selected",
        issue: {
          id: 7,
          check: "has_photo_desync",
          details: { artist: "Selected" },
        },
      },
      {
        issue_id: 8,
        item_key: "issue:8",
        plan_item_id: "repair-plan:duplicates",
        check_type: "duplicate_tracks",
        support: "automatic",
        risk: "destructive",
        scope: "hybrid",
        requires_confirmation: true,
        supports_batch: false,
        supports_artist_scope: true,
        auto_fixable: true,
        executable: true,
        target: "Selected/Album",
        issue: {
          id: 8,
          check: "duplicate_tracks",
          details: { artist: "Selected" },
        },
      },
    ],
  };
}

let plan: ReturnType<typeof makePlan>;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  plan = makePlan();
  mockWaitForTask.mockResolvedValue({ status: "completed" });
  mockApi.mockImplementation(async (path, method) => {
    if (path.endsWith("/repair-plan") && method === "POST")
      return { task_id: "prepare-job", status: "pending" };
    if (path === "/api/manage/repair-issues" && method === "POST")
      return { task_id: "selection-job" };
    return plan;
  });
});

async function renderPlan() {
  renderWithAdminProviders(
    <ArtistRepairDialog
      open
      onOpenChange={vi.fn()}
      artistName="Selected"
      artistEntityUid="b0000000-0000-0000-0000-000000000001"
    />,
  );
  await screen.findByRole("checkbox", { name: "Select Photo desync" });
}

function repairRequests() {
  return mockApi.mock.calls.filter(
    ([path, method]) =>
      path === "/api/manage/repair-issues" && method === "POST",
  );
}

describe("ArtistRepairDialog selection contract", () => {
  it("waits for worker preparation and loads the owned completed plan", async () => {
    await renderPlan();
    expect(mockApi).toHaveBeenCalledWith(
      "/api/manage/artists/by-entity/b0000000-0000-0000-0000-000000000001/repair-plan",
      "POST",
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockWaitForTask).toHaveBeenCalledWith(
      "prepare-job",
      1800000,
      expect.any(AbortSignal),
      "/api/manage/repair-preparations/prepare-job",
    );
    expect(mockApi).toHaveBeenCalledWith(
      "/api/manage/repair-preparations/prepare-job",
      "GET",
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(repairRequests()).toHaveLength(0);
  });

  it("does not offer actions after preparation fails", async () => {
    mockWaitForTask.mockResolvedValue({ status: "failed" });
    renderWithAdminProviders(
      <ArtistRepairDialog
        open
        onOpenChange={vi.fn()}
        artistName="Selected"
        artistEntityUid="b0000000-0000-0000-0000-000000000001"
      />,
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to load repair plan"),
    );
    expect(
      screen.queryByRole("button", { name: "Run fix" }),
    ).not.toBeInTheDocument();
    expect(repairRequests()).toHaveLength(0);
  });

  it("sends the owned preparation reference and its version when running one safe item", async () => {
    const user = userEvent.setup();
    await renderPlan();
    await user.click(screen.getAllByRole("button", { name: "Run fix" })[0]!);
    await waitFor(() => expect(repairRequests()).toHaveLength(1));
    expect(repairRequests()[0]![2]).toEqual({
      dry_run: false,
      preparation_task_id: plan.preparation_task_id,
      plan_version: plan.plan_version,
      plan_item_ids: ["repair-plan:photo"],
      confirm_risky: false,
    });
    expect(screen.queryByText("Confirm risky repair")).not.toBeInTheDocument();
  });

  it("uses the prepared plan while running only the checked subset", async () => {
    const user = userEvent.setup();
    await renderPlan();
    await user.click(
      screen.getByRole("checkbox", { name: "Select Duplicate tracks" }),
    );
    await user.click(screen.getByRole("button", { name: "Run selected" }));
    await waitFor(() => expect(repairRequests()).toHaveLength(1));
    expect(repairRequests()[0]![2]).toMatchObject({
      preparation_task_id: plan.preparation_task_id,
      plan_version: plan.plan_version,
      plan_item_ids: ["repair-plan:photo"],
      confirm_risky: false,
    });
  });

  it("does not turn an empty selection into a full repair", async () => {
    const user = userEvent.setup();
    await renderPlan();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Run selected" })).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select Photo desync" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Duplicate tracks" }),
    ).not.toBeChecked();
    expect(repairRequests()).toHaveLength(0);
  });

  it("requires confirmation for the selected risky item from the prepared plan", async () => {
    const user = userEvent.setup();
    await renderPlan();
    await user.click(screen.getAllByRole("button", { name: "Run fix" })[1]!);
    expect(screen.getByText("Confirm risky repair")).toBeInTheDocument();
    expect(repairRequests()).toHaveLength(0);
    await user.click(
      screen.getByRole("button", { name: "Run confirmed repair" }),
    );
    await waitFor(() => expect(repairRequests()).toHaveLength(1));
    expect(repairRequests()[0]![2]).toMatchObject({
      preparation_task_id: plan.preparation_task_id,
      plan_version: plan.plan_version,
      plan_item_ids: ["repair-plan:duplicates"],
      confirm_risky: true,
    });
  });
});
