import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlbumHeader } from "./AlbumHeader";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ task_id: "album-task" });
  vi.mocked(waitForTask).mockResolvedValue({ status: "completed" } as Awaited<
    ReturnType<typeof waitForTask>
  >);
});

const baseProps = {
  albumId: 1,
  artist: "Converge",
  album: "Jane Doe",
  albumTags: {
    artist: "Converge",
    album: "Jane Doe",
    year: "2001",
    genre: "hardcore",
  },
  trackCount: 12,
  totalLengthSec: 2700,
  totalSizeMb: 420,
  hasCover: true,
};

function renderHeader(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("AlbumHeader", () => {
  it("keeps legacy admin actions hidden for partial metadata editors", () => {
    renderHeader(
      <AlbumHeader
        {...baseProps}
        isAdmin={false}
        canDownload
        canEditArtwork={false}
        canEnrich={false}
        canQueueMetadata={false}
      >
        <button>Edit Tags</button>
      </AlbumHeader>,
    );

    expect(screen.getByText("Edit Tags")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "download",
    );
    expect(
      screen.queryByRole("button", { name: "Enrich" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Lyrics" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Metadata" }),
    ).not.toBeInTheDocument();
  });

  it("uses discoverable shared icon actions for album operations", () => {
    renderHeader(
      <AlbumHeader
        {...baseProps}
        canEditArtwork={false}
        canEnrich
        canDownload
        canQueueMetadata
      />,
    );

    for (const label of [
      "Enrich",
      "Download",
      "Lyrics",
      "Metadata",
      "Export",
    ]) {
      const action =
        label === "Download"
          ? screen.getByRole("link", { name: label })
          : screen.getByRole("button", { name: label });
      expect(action).toHaveAttribute("data-size", "icon-lg");
      expect(action).not.toHaveAttribute("title");
      expect(action.textContent).toBe("");
      expect(action.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });
});

it.each([
  [
    "Lyrics",
    "lyrics",
    "/api/manage/sync-lyrics",
    { album_id: 1, refresh_mode: "due", limit: 500 },
  ],
  [
    "Metadata",
    "portable",
    "/api/manage/portable-metadata",
    { album_id: 1, write_audio_tags: true, write_sidecars: true, limit: 1 },
  ],
  [
    "Export",
    "export",
    "/api/manage/portable-metadata/export-rich",
    { album_id: 1, include_audio: false, write_rich_tags: false, limit: 1 },
  ],
])(
  "preserves %s task and queued callback from the compact action",
  async (label, action, endpoint, body) => {
    const queued = vi.fn();
    renderHeader(
      <AlbumHeader
        {...baseProps}
        canEditArtwork={false}
        canQueueMetadata
        onMetadataTaskQueued={queued}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: String(label) }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        endpoint,
        "POST",
        expect.objectContaining(body),
      ),
    );
    expect(queued).toHaveBeenCalledWith(action, "album-task");
  },
);
it("preserves album enrichment completion and refresh", async () => {
  const refreshed = vi.fn();
  renderHeader(
    <AlbumHeader
      {...baseProps}
      canEditArtwork={false}
      canEnrich
      onAnalysisComplete={refreshed}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Enrich" }));
  await waitFor(() =>
    expect(waitForTask).toHaveBeenCalledWith("album-task", 120000),
  );
  expect(refreshed).toHaveBeenCalledOnce();
});

it("uses MonoLabel for release, collection and popularity metadata", () => {
  renderHeader(<AlbumHeader {...baseProps} popularityScore={0.67} />);
  for (const label of [
    "2001",
    "12 tracks",
    "45:00",
    "420 MB",
    "Popularity 67%",
  ]) {
    expect(screen.getByText(label)).toHaveClass("crate-mono-label");
    expect(screen.getByTestId("page-hero-meta")).toContainElement(
      screen.getByText(label),
    );
  }
});
it("keeps the hero and action inset on the same Admin content edge", () => {
  const { container } = renderHeader(<AlbumHeader {...baseProps} />);
  const hero = container.querySelector('[data-testid="page-hero"]')!;
  expect(hero.querySelector(".max-w-content, .px-4")).toBeNull();
  const actions = screen.getByRole("group", { name: "Album actions" });
  expect(actions.parentElement).toHaveClass("py-4");
  expect(actions.parentElement).not.toHaveClass("p-4");
});
