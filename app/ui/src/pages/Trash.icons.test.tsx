import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { waitForTask, type TaskCompletion } from "@/lib/tasks";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import fixture from "../../../../tests/admin-e2e/fixtures/trash-1ae.json";
import { Trash } from "./Trash";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
let items = structuredClone(fixture.items);
const first = fixture.items[0]!;
beforeEach(() => {
  vi.clearAllMocks();
  items = structuredClone(fixture.items);
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === "POST"
      ? ({ task_id: "sample-trash-task" } as never)
      : ({ items: structuredClone(items), count: items.length } as never),
  );
  vi.mocked(waitForTask).mockResolvedValue({ status: "completed" });
});
async function ready() {
  renderWithAdminProviders(<Trash />);
  await screen.findByText("Marea");
}

describe("Trash text controls and retained UX", () => {
  it("uses text actions and the shared heading font without redundant glyphs", async () => {
    await ready();
    expect(screen.getByRole("heading", { name: "Library Trash" })).toHaveClass(
      "font-display",
    );
    expect(document.querySelector("svg:not(.lucide-loader-circle)")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    expect(screen.getByText(first.quarantine_path)).toBeVisible();
    expect(document.querySelector("button button,button a")).toBeNull();
  });
  it("keeps refresh and list loading indications while data is pending", () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    renderWithAdminProviders(<Trash />);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(
      refresh.querySelector('[data-admin-ux="trash-refresh-loading"]'),
    ).not.toBeNull();
    expect(screen.getByText("Loading quarantined tracks...")).toBeVisible();
    expect(
      document.querySelector('[data-admin-ux="trash-list-loading"]'),
    ).not.toBeNull();
  });
  it("refreshes the existing read endpoint without a mutation", async () => {
    await ready();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh" }));
    expect(api).toHaveBeenLastCalledWith("/api/manage/tracks/quarantine");
    expect(vi.mocked(api).mock.calls).toHaveLength(2);
  });
  it("restores the selected path through the same task and blocks concurrent actions", async () => {
    let finish!: (task: TaskCompletion) => void;
    vi.mocked(waitForTask).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await ready();
    const restore = screen.getAllByRole("button", {
      name: "Restore",
    })[0]!;
    await userEvent.setup().click(restore);
    expect(api).toHaveBeenCalledWith(
      "/api/manage/tracks/quarantine/restore",
      "POST",
      {
        quarantine_path: first.quarantine_path,
        reason: "Manual restore from .crate-trash",
      },
    );
    expect(waitForTask).toHaveBeenCalledWith("sample-trash-task", 120000);
    expect(restore).toHaveAttribute("aria-busy", "true");
    for (const button of screen.getAllByRole("button", {
      name: /^(Restore|Delete|Empty trash)$/,
    }))
      expect(button).toBeDisabled();
    items = items.slice(1);
    finish({ status: "completed" });
    await waitFor(() =>
      expect(screen.queryByText("Marea")).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Track restored from .crate-trash",
    );
  });
  it("keeps individual deletion behind confirmation and restores cancellation focus", async () => {
    const user = userEvent.setup();
    await ready();
    const trigger = screen.getAllByRole("button", {
      name: "Delete",
    })[0]!;
    await user.click(trigger);
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete Quarantined Track",
    });
    expect(dialog).toHaveAccessibleDescription(/Marea.*cannot be undone/);
    expect(
      vi.mocked(api).mock.calls.filter(([, method]) => method === "POST"),
    ).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("deletes only the confirmed path and retains the task timeout", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    items = items.slice(1);
    await user.click(
      screen.getByRole("button", { name: "Delete Permanently" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/manage/tracks/quarantine/hard-delete",
        "POST",
        {
          quarantine_path: first.quarantine_path,
          reason: "Manual hard delete from .crate-trash",
        },
      ),
    );
    expect(waitForTask).toHaveBeenCalledWith("sample-trash-task", 120000);
    await waitFor(() =>
      expect(screen.queryByText("Marea")).not.toBeInTheDocument(),
    );
  });
  it("keeps bulk deletion confirmed with its real count, size and ten-minute wait", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Empty trash" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Empty Library Trash",
    });
    expect(dialog).toHaveAccessibleDescription(
      /2 quarantined tracks.*3.0 MB.*cannot be undone/,
    );
    items = [];
    await user.click(
      within(dialog).getByRole("button", { name: "Empty Trash" }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/manage/tracks/quarantine/hard-delete-all",
        "POST",
        { reason: "Manual empty trash from admin" },
      ),
    );
    expect(waitForTask).toHaveBeenCalledWith("sample-trash-task", 600000);
    await screen.findByText(".crate-trash is empty");
    expect(screen.getByRole("button", { name: "Empty trash" })).toBeDisabled();
  });
  it.each(["failed", "rejected"])(
    "retains error feedback and releases busy actions for %s tasks",
    async (status) => {
      if (status === "failed")
        vi.mocked(waitForTask).mockResolvedValue({
          status: "failed",
          error: "Sample task failed",
        });
      else
        vi.mocked(waitForTask).mockRejectedValue(
          new Error("Sample task failed"),
        );
      await ready();
      await userEvent
        .setup()
        .click(screen.getAllByRole("button", { name: "Restore" })[0]!);
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Sample task failed"),
      );
      expect(screen.getByText("Marea")).toBeVisible();
      expect(
        screen.getAllByRole("button", { name: "Restore" })[0],
      ).toBeEnabled();
    },
  );
});
