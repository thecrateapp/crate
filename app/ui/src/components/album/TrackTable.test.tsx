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
    <div>
      {children}
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
    </div>
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
