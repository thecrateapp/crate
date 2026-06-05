import { screen, waitFor } from "@testing-library/react";
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
