import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistMetadataEditor } from "./ArtistMetadataEditor";

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

const artist = {
  id: 12,
  entity_uid: "artist-uid",
  name: "High Vis",
  albums: [],
  total_tracks: 0,
  total_size_mb: 0,
  genre_profile: [],
  issue_count: 0,
  is_v2: true,
  bio: "Old bio",
  tags_json: ["post-punk"],
  urls_json: { official: "https://highvis.example" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue({ task_id: "task-1" });
  mockWaitForTask.mockResolvedValue({ status: "completed", result: {} });
});

describe("ArtistMetadataEditor", () => {
  it("queues artist metadata with canonical genres and urls", async () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ArtistMetadataEditor
        open
        onOpenChange={onOpenChange}
        artist={artist}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), {
      target: { value: "New bio" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /external urls/i }), {
      target: {
        value:
          "official=https://highvis.example\nbandcamp=https://highvis.bandcamp.com",
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: /save metadata/i }),
    );

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(mockApi).toHaveBeenCalledWith(
      "/api/artists/by-entity/artist-uid/metadata",
      "PUT",
      expect.objectContaining({
        bio: "New bio",
        genres: [],
        urls: {
          official: "https://highvis.example",
          bandcamp: "https://highvis.bandcamp.com",
        },
      }),
    );
    expect(mockWaitForTask).toHaveBeenCalledWith("task-1", 60000);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("reviews unsaved changes through the shared confirmation before closing", async () => {
    const onOpenChange = vi.fn();
    render(
      <ArtistMetadataEditor open onOpenChange={onOpenChange} artist={artist} />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /bio/i }),
      " changed",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("alertdialog", {
        name: "Discard artist metadata changes?",
      }),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Discard changes" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
