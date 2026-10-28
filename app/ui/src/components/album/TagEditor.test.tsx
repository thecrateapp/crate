import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TagEditor } from "./TagEditor";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/api/genres"
      ? [{ name: "ambient", count: 3 }]
      : { task_id: "save-tags" },
  );
  vi.mocked(waitForTask).mockResolvedValue({
    status: "completed",
    result: { updated: 1 },
  } as Awaited<ReturnType<typeof waitForTask>>);
});
it("keeps shared genre add/remove and labelled track edits in the queued tag write", async () => {
  const saved = vi.fn();
  const user = userEvent.setup();
  render(
    <TagEditor
      albumId={44}
      tags={{ artist: "Artist", album: "Album", year: "2001", genre: "metal" }}
      tracks={[{ filename: "one.flac", title: "Before", tracknumber: "1" }]}
      onSaved={saved}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "ambient" }));
  await user.click(screen.getByRole("button", { name: "Remove genre metal" }));
  await user.clear(screen.getByRole("textbox", { name: /Title for one.flac/ }));
  await user.type(
    screen.getByRole("textbox", { name: /Title for one.flac/ }),
    "After",
  );
  await user.click(screen.getByRole("button", { name: "Save Tags" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/albums/44/tags",
      "PUT",
      expect.objectContaining({
        genre: "ambient",
        tracks: { "one.flac": { title: "After" } },
      }),
    ),
  );
  expect(saved).toHaveBeenCalled();
});
