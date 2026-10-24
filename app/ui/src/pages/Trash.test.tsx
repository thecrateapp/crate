import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Trash } from "@/pages/Trash";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";

const mockApi = vi.mocked(api);
const mockWaitForTask = vi.mocked(waitForTask);

describe("Trash", () => {
  it("keeps empty-trash confirmation locked until the worker finishes and retries after failure", async () => {
    mockApi
      .mockReset()
      .mockResolvedValueOnce({
        items: [
          {
            quarantine_path: "Artist/Album/a.flac",
            filename: "a.flac",
            size_bytes: 10,
            modified_at: "2026-10-24",
            suggested_target_path: "a.flac",
          },
        ],
        count: 1,
      })
      .mockResolvedValue({ task_id: "trash-task" });
    let finish!: (value: { status: string; error?: string }) => void;
    mockWaitForTask.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithAdminProviders(<Trash />);
    await screen.findByText("a.flac", { exact: true });
    await user.click(screen.getByRole("button", { name: "Empty trash" }));
    await user.click(screen.getByRole("button", { name: "Empty Trash" }));
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeDisabled();
    await act(async () =>
      finish({ status: "failed", error: "disk unavailable" }),
    );
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Empty Trash",
      }),
    ).toBeEnabled();
  });
  it("renders the canonical inline empty state without an unpadded list card", async () => {
    mockApi.mockReset().mockResolvedValueOnce({ items: [], count: 0 });
    renderWithAdminProviders(<Trash />);
    const empty = await screen.findByRole("status", {
      name: ".crate-trash is empty",
    });
    expect(empty).toHaveAttribute("data-variant", "inline");
    expect(empty.closest(".bg-card")).toBeNull();
    expect(empty).toHaveAccessibleDescription(
      "Quarantined tracks will appear here after manual removals or repair actions.",
    );
  });
  it("keeps a failed first load distinct from an empty trash and offers recovery", async () => {
    mockApi
      .mockReset()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ items: [], count: 0 });
    const user = userEvent.setup();
    renderWithAdminProviders(<Trash />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load quarantined tracks.",
    );
    expect(screen.queryByText(".crate-trash is empty")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(".crate-trash is empty")).toBeVisible();
  });
  it("empties all quarantined tracks through a worker task", async () => {
    const user = userEvent.setup();
    mockApi
      .mockResolvedValueOnce({
        items: [
          {
            quarantine_path: "Artist/Album/01.flac",
            filename: "01.flac",
            size_bytes: 1024,
            modified_at: new Date().toISOString(),
            suggested_target_path: "Artist/Album/01.flac",
            title: "Concubine",
            artist: "Converge",
            album: "Jane Doe",
          },
        ],
        count: 1,
      })
      .mockResolvedValueOnce({ task_id: "task-empty-trash" })
      .mockResolvedValueOnce({ items: [], count: 0 });
    mockWaitForTask.mockResolvedValue({
      status: "completed",
      result: { deleted: 1, bytes_deleted: 1024 },
    });

    renderWithAdminProviders(<Trash />);

    await screen.findByText("Concubine");
    await user.click(screen.getByRole("button", { name: "Empty trash" }));
    expect(
      screen.getByText(/Permanently delete 1 quarantined track/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Empty Trash" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/manage/tracks/quarantine/hard-delete-all",
        "POST",
        { reason: "Manual empty trash from admin" },
      );
    });
    expect(mockWaitForTask).toHaveBeenCalledWith(
      "task-empty-trash",
      10 * 60 * 1000,
    );
    await waitFor(() => {
      expect(screen.getByText(".crate-trash is empty")).toBeInTheDocument();
    });
  });
});
