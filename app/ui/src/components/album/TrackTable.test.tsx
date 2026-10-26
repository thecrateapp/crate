import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackTable } from "./TrackTable";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

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

vi.mock("@/components/ui/music-context-menu", () => ({
  MusicContextMenu: ({
    children,
    onMoveTrack,
    onQuarantineTrack,
  }: {
    children: ReactNode;
    onMoveTrack?: () => void;
    onQuarantineTrack?: () => void;
  }) => (
    <>
      {children}
      <tr>
        <td colSpan={20}>
          {onMoveTrack ? (
            <button type="button" onClick={onMoveTrack}>
              Move to Album
            </button>
          ) : null}
          {onQuarantineTrack ? (
            <button type="button" onClick={onQuarantineTrack}>
              Quarantine Track
            </button>
          ) : null}
        </td>
      </tr>
    </>
  ),
}));

vi.mock("@nivo/radar", () => ({
  ResponsiveRadar: () => null,
}));

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";

const mockApi = vi.mocked(api);
const mockWaitForTask = vi.mocked(waitForTask);

const track = {
  id: 44,
  entity_uid: "track-uid",
  filename: "01 - Concubine.flac",
  format: ".flac",
  size_mb: 18,
  bitrate: 950,
  sample_rate: 44100,
  bit_depth: 16,
  length_sec: 79,
  tags: {
    title: "Concubine",
    artist: "Converge",
    album: "Jane Doe",
    tracknumber: "1",
  },
  path: "Converge/Jane Doe/01 - Concubine.flac",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 2,
      email: "librarian@example.test",
      name: "Librarian",
      role: "librarian",
      capabilities: ["library.track.remove"],
    },
    loading: false,
    logout: vi.fn(),
    isAdmin: false,
    canAccessAdmin: true,
    hasCapability: vi.fn((capability: string) =>
      ["library.track.remove"].includes(capability),
    ),
    hasAnyCapability: vi.fn(),
    refetch: vi.fn(),
  });
  mockWaitForTask.mockResolvedValue({ status: "completed", result: {} });
  mockApi.mockImplementation(async (url, method) => {
    if (method === "POST") {
      return { task_id: "task-move-1" };
    }
    if (String(url).startsWith("/api/search")) {
      return {
        albums: [
          {
            id: 99,
            entity_uid: "target-album",
            artist: "Converge",
            name: "Axe to Fall",
            year: "2009",
          },
        ],
      };
    }
    return {};
  });
});

describe("TrackTable", () => {
  it("queues a track move task from the move-to-album dialog", async () => {
    const onTrackQuarantined = vi.fn();
    render(
      <TrackTable
        tracks={[track]}
        artist="Converge"
        artistId={12}
        album="Jane Doe"
        albumId={34}
        onTrackQuarantined={onTrackQuarantined}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /move to album/i }),
    );

    await screen.findByText("Axe to Fall");
    await userEvent.click(screen.getByText("Axe to Fall"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/manage/tracks/by-entity/track-uid/move",
        "POST",
        {
          target_album_id: 99,
          reason: "Manual track move from album view",
        },
      );
    });
    expect(mockWaitForTask).toHaveBeenCalledWith("task-move-1", 120000);
    expect(onTrackQuarantined).toHaveBeenCalled();
  });
});

it("keeps the semantic management table and shows only existing Camelot analysis", () => {
  render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{
        concubine: {
          tempo: 124,
          key: "A",
          scale: "minor",
          energy: null,
          mood: null,
          danceability: null,
          valence: null,
          acousticness: null,
          instrumentalness: null,
          loudness: null,
          dynamic_range: null,
          spectral_complexity: null,
        },
      }}
    />,
  );
  expect(screen.getByRole("table")).toHaveClass("crate-track-table");
  expect(screen.getByText("124 · 8A")).toHaveClass("crate-track-analysis");
  expect(screen.getByText("1:19")).toHaveClass("font-mono", "tabular-nums");
  expect(screen.getByRole("link", { name: "Download track" })).toHaveAttribute(
    "download",
  );
});

it("marks synced lyrics as available rather than waiting", () => {
  render(
    <TrackTable
      tracks={[{ ...track, lyrics: { has_synced: true } }]}
      artist="Converge"
    />,
  );
  expect(screen.getByText("SYNCED")).toHaveClass("text-accent-action-hi");
});

it("opens a wide scrollable track profile and preserves Escape, close and trigger focus", async () => {
  const user = userEvent.setup();
  render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{
        concubine: {
          tempo: 124,
          key: "A",
          scale: "minor",
          energy: 0.8,
          mood: null,
          danceability: null,
          valence: null,
          acousticness: null,
          instrumentalness: null,
          loudness: null,
          dynamic_range: null,
          spectral_complexity: null,
        },
      }}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Show audio profile" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Concubine · Audio profile",
  });
  const panel = dialog.querySelector("[data-app-modal-panel]");
  expect(panel).toHaveClass("flex", "flex-col");
  expect(panel).toHaveAttribute("data-overlay-size", "3xl");
  expect(
    dialog.querySelector('[data-slot="audio-profile-scroll"]'),
  ).toHaveClass("overflow-y-auto", "min-h-0");
  expect(
    screen.getByRole("region", { name: "Sound profile" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Close audio profile" }),
    ).toHaveFocus(),
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Close audio profile" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("blocks repeated quarantine confirmation until the task finishes", async () => {
  mockApi.mockResolvedValueOnce({ task_id: "pending-quarantine" });
  let finish!: (result: Awaited<ReturnType<typeof waitForTask>>) => void;
  mockWaitForTask.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }) as ReturnType<typeof waitForTask>,
  );
  render(<TrackTable tracks={[track]} artist="Converge" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Quarantine Track" }),
  );
  const confirms = screen.getAllByRole("button", { name: "Quarantine Track" });
  const confirm = confirms[confirms.length - 1]!;
  await userEvent.click(confirm);
  expect(confirm).toBeDisabled();
  expect(screen.getByRole("alertdialog")).toBeVisible();
  finish({ status: "completed" } as Awaited<ReturnType<typeof waitForTask>>);
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
});
