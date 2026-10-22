import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Imports } from "./Imports";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { mockApi, mockTaskEvents, mockToast } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockTaskEvents: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: mockApi }));
vi.mock("@/hooks/use-task-events", () => ({ useTaskEvents: mockTaskEvents }));
vi.mock("sonner", () => ({ toast: mockToast }));

const pendingItem = {
  source: "upload",
  source_path: "/srv/crate/staging/Lichen/Moss On Stone",
  artist: "Lichen",
  album: "Moss On Stone",
  track_count: 3,
  formats: ["flac"],
  total_size_mb: 187.2,
  dest_path: "/music/Lichen/Moss On Stone",
  dest_exists: false,
  status: "pending",
  last_error: null,
};

const importingItem = {
  ...pendingItem,
  source_path: "/srv/crate/staging/Glacier Veins/Slow Bloom",
  artist: "Glacier Veins",
  album: "Slow Bloom",
  status: "importing",
  task_id: "internal-task-id",
};

const importedItem = {
  ...pendingItem,
  source_path: "/srv/crate/staging/Glacier Veins/Quiet Passage",
  artist: "Glacier Veins",
  album: "Quiet Passage",
  status: "imported",
  dest_album_id: 44,
};

const sidecar = {
  schema_version: 1,
  artist: { name: "Glacier Veins" },
  album: {
    name: "Quiet Passage",
    path: "/music/Glacier Veins/Quiet Passage",
    has_cover: 1,
  },
  tracks: [
    { filename: "01 - Low Tide.flac", relative_path: "01 - Low Tide.flac" },
    { filename: "02 - Shoreline.flac", relative_path: "02 - Shoreline.flac" },
  ],
  portable_metadata: {
    sidecar_path: "/music/Glacier Veins/Quiet Passage/.crate/album.json",
    sidecar_written_at: "2026-10-21T11:00:00Z",
    audio_tags_written_at: "2026-10-21T11:00:00Z",
    tracks: 2,
    tags_written: 2,
    tag_errors: 0,
  },
};

type QueueFixture = {
  source_path: string;
  artist: string;
  album: string;
  status: string;
  last_error?: string | null;
  [key: string]: unknown;
};

let queue: QueueFixture[];

function setupApi() {
  queue = [
    structuredClone(pendingItem),
    structuredClone(importingItem),
    structuredClone(importedItem),
  ];
  mockApi.mockImplementation(
    async (url: string, method = "GET", body?: { source_path?: string }) => {
      if (url.startsWith("/api/imports/pending?")) {
        const status = new URLSearchParams(url.split("?")[1]).get("status");
        if (status === "completed")
          return queue.filter(
            (item) => item.status === "imported" || item.status === "merged",
          );
        if (status === "all") return queue;
        return queue.filter((item) => item.status === status);
      }
      if (url === "/api/imports/import" && method === "POST") {
        const item = queue.find(
          (entry) => entry.source_path === body?.source_path,
        );
        if (item)
          Object.assign(item, {
            status: "importing",
            task_id: "new-import-task",
          });
        return { task_id: "new-import-task", status: "queued" };
      }
      if (url === "/api/imports/import-all" && method === "POST") {
        for (const item of queue) {
          if (item.status === "pending")
            Object.assign(item, {
              status: "importing",
              task_id: "import-all-task",
            });
        }
        return { task_id: "import-all-task", status: "queued" };
      }
      if (url === "/api/imports/remove" && method === "POST") {
        queue = queue.filter((item) => item.source_path !== body?.source_path);
        return { task_id: "remove-task", status: "queued" };
      }
      if (url === "/api/manage/albums/44/portable-metadata") return sidecar;
      throw new Error(`Unexpected API request: ${method} ${url}`);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupApi();
  mockTaskEvents.mockReturnValue({
    events: [
      {
        id: 1,
        type: "item",
        data: { label: "Quiet Passage" },
        timestamp: "2026-10-22T10:00:00Z",
      },
    ],
    done: null,
    connected: true,
  });
});
afterEach(cleanup);

describe("Imports", () => {
  it("shows queue states, keeps source paths compact, and hides raw worker errors", async () => {
    queue[0]!.last_error = "/srv/private/music/mount failed";
    renderWithAdminProviders(<Imports />);

    await screen.findByText("Moss On Stone", { exact: true });
    expect(
      screen.getByText("Source: Lichen/Moss On Stone"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The previous attempt did not finish. You can retry this album.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/srv\/private\/music/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Importing/ }));
    expect(
      await screen.findByText("Slow Bloom", { exact: true }),
    ).toBeInTheDocument();
  });

  it("queues an import and shows friendly task activity without exposing the task id", async () => {
    renderWithAdminProviders(<Imports />);

    await screen.findByText("Moss On Stone", { exact: true });
    await userEvent.click(screen.getByRole("button", { name: "Import album" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/imports/import",
        "POST",
        expect.objectContaining({ album: "Moss On Stone" }),
      );
    });
    expect(
      await screen.findByText("Imported Quiet Passage"),
    ).toBeInTheDocument();
    expect(screen.queryByText("new-import-task")).not.toBeInTheDocument();
  });

  it("loads the selected album's sidecar from catalog data and renders its tree and JSON", async () => {
    renderWithAdminProviders(<Imports />);

    const tree = await screen.findByRole("tree", { name: "Catalog file map" });
    expect(within(tree).getByText(".crate/album.json")).toBeInTheDocument();
    expect(within(tree).getByText("01 - Low Tide.flac")).toBeInTheDocument();
    expect(screen.getByTestId("portable-json-viewer")).toHaveTextContent(
      '"schema_version": 1',
    );
    expect(mockApi).toHaveBeenCalledWith(
      "/api/manage/albums/44/portable-metadata",
    );
  });

  it("requires confirmation before queueing removal from staging", async () => {
    renderWithAdminProviders(<Imports />);

    await screen.findByText("Moss On Stone", { exact: true });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      await screen.findByRole("alertdialog", { name: "Remove staged album" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove from staging" }),
    );

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/imports/remove", "POST", {
        source_path: pendingItem.source_path,
      });
    });
  });
});
