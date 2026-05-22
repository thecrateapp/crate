import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MergeAlbumDialog,
  MoveAlbumToArtistDialog,
  SplitAlbumDialog,
} from "./Album";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@nivo/radar", () => ({
  ResponsiveRadar: () => null,
}));

import { api } from "@/lib/api";

const mockApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue({
    artists: [
      {
        id: 22,
        entity_uid: "target-artist",
        slug: "target-artist",
        name: "Target Artist",
      },
    ],
    albums: [
      {
        id: 44,
        entity_uid: "target-album",
        slug: "target-album",
        artist: "Target Artist",
        name: "Target Album",
        year: 2026,
      },
    ],
  });
});

describe("MoveAlbumToArtistDialog", () => {
  it("searches artists and returns the selected target", async () => {
    const onMove = vi.fn();
    render(
      <MoveAlbumToArtistDialog
        open
        currentArtistId={12}
        currentArtistName="Source Artist"
        albumName="Wrong Album"
        busy={false}
        onOpenChange={vi.fn()}
        onMove={onMove}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "target");

    await screen.findByText("Target Artist");
    await userEvent.click(screen.getByText("Target Artist"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/search?q=target&limit=12");
    });
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 22,
        name: "Target Artist",
      }),
    );
  });
});

describe("MergeAlbumDialog", () => {
  it("searches albums and returns the selected target", async () => {
    const onMerge = vi.fn();
    render(
      <MergeAlbumDialog
        open
        currentAlbumId={12}
        currentAlbumName="Source Album"
        currentArtistName="Source Artist"
        busy={false}
        onOpenChange={vi.fn()}
        onMerge={onMerge}
      />,
    );

    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "target");

    await screen.findByText("Target Album");
    await userEvent.click(screen.getByText("Target Album"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/search?q=target&limit=12");
    });
    expect(onMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 44,
        name: "Target Album",
      }),
    );
  });
});

describe("SplitAlbumDialog", () => {
  it("returns the target album name and selected tracks", async () => {
    const onSplit = vi.fn();
    render(
      <SplitAlbumDialog
        open
        albumName="Source Album"
        tracks={[
          {
            id: 1,
            entity_uid: "track-1",
            filename: "01.flac",
            format: "FLAC",
            size_mb: 10,
            bitrate: null,
            length_sec: 120,
            tags: { title: "First Song", track: "1" },
          },
          {
            id: 2,
            entity_uid: "track-2",
            filename: "02.flac",
            format: "FLAC",
            size_mb: 10,
            bitrate: null,
            length_sec: 120,
            tags: { title: "Second Song", track: "2" },
          },
        ]}
        busy={false}
        onOpenChange={vi.fn()}
        onSplit={onSplit}
      />,
    );

    await userEvent.type(screen.getByRole("textbox"), "New Album");
    await userEvent.click(screen.getByLabelText(/First Song/));
    await userEvent.click(screen.getByRole("button", { name: "Split Album" }));

    expect(onSplit).toHaveBeenCalledWith("New Album", [1]);
  });
});
