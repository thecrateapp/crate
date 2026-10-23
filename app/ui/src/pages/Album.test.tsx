import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { mockUseApi } = vi.hoisted(() => ({ mockUseApi: vi.fn() }));

import {
  Album,
  MergeAlbumDialog,
  MoveAlbumToArtistDialog,
  SplitAlbumDialog,
} from "./Album";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: mockUseApi,
}));

vi.mock("@/hooks/use-task-events", () => ({
  useTaskEvents: () => ({ events: [], done: false }),
}));

vi.mock("@/components/album/RelatedAlbums", () => ({
  RelatedAlbums: () => null,
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
  mockUseApi.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
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

describe("Album page action labels", () => {
  it("keeps text actions free of redundant icons and confirms deletion destructively", async () => {
    mockUseApi.mockReturnValue({
      data: {
        artist: "Artist",
        name: "Album",
        path: "",
        track_count: 0,
        total_size_mb: 0,
        total_length_sec: 0,
        has_cover: false,
        cover_file: null,
        tracks: [],
        album_tags: {},
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug/:albumSlug" element={<Album />} />
      </Routes>,
      { route: "/artists/artist/album" },
    );

    for (const label of [
      "Edit Tags",
      "Move Album",
      "Merge Duplicate",
      "Split Album",
      "Analyze",
      "Delete",
    ]) {
      expect(
        screen.getByRole("button", { name: label }).querySelector("svg"),
      ).toBeNull();
    }

    const deleteAction = screen.getByRole("button", { name: "Delete" });
    expect(deleteAction).toHaveAttribute("data-variant", "outline");
    await userEvent.setup().click(deleteAction);
    const confirmation = await screen.findByRole("alertdialog");
    expect(confirmation).toHaveTextContent("This action cannot be undone.");
    expect(
      within(confirmation).getByRole("button", { name: "Delete Album" }),
    ).toHaveAttribute("data-variant", "destructive");
  });
});

describe("Album page load state", () => {
  it("shows a retryable error when the album request fails", async () => {
    const refetch = vi.fn();
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: "network error",
      refetch,
    });

    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug/:albumSlug" element={<Album />} />
      </Routes>,
      { route: "/artists/camel/mirage" },
    );

    expect(
      screen.getByText(
        "This album could not be loaded. Try again or return to Browse.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("distinguishes a missing album from a failed request", () => {
    renderWithAdminProviders(
      <Routes>
        <Route path="/artists/:artistSlug/:albumSlug" element={<Album />} />
      </Routes>,
      { route: "/artists/camel/missing-album" },
    );

    expect(
      screen.getByRole("heading", { name: "Album not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse artists" }),
    ).toHaveAttribute("href", "/browse");
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

    const result = await screen.findByText("Target Artist");
    expect(result.closest("button")).toHaveClass("hover:bg-accent-action/8");
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

    expect(screen.getByText("First Song")).toHaveAttribute(
      "data-slot",
      "form-field-value",
    );
    await userEvent.type(screen.getByRole("textbox"), "New Album");
    await userEvent.click(screen.getByLabelText(/First Song/));
    await userEvent.click(screen.getByRole("button", { name: "Split Album" }));

    expect(onSplit).toHaveBeenCalledWith("New Album", [1]);
  });
});
