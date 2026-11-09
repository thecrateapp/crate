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

function grantCapabilities(capabilities: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    ...vi.mocked(useAuth)(),
    hasCapability: vi.fn((capability: string) =>
      capabilities.includes(capability),
    ),
  });
}

const profiledTrack = {
  track_id: 44,
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
  smart_mix: { quality: "full", analyzer_version: "smart-mix-audio-v7" },
};

it("draws the stored phrase structure in the track profile for analysis managers", async () => {
  grantCapabilities(["library.track.remove", "library.analysis.manage"]);
  mockApi.mockImplementation(async (url) =>
    String(url) === "/api/admin/smart-mix/tracks/44/structure"
      ? {
          trackId: 44,
          analyzerVersion: "smart-mix-audio-v7",
          profileVersion: 1,
          durationMs: 79_000,
          structureConfidence: 0.7,
          phrases: [
            {
              startBeat: 0,
              startMs: 0,
              endMs: 32_000,
              bars: 16,
              energy: 0.7,
              deltaEnergy: null,
              kind: "body",
              vocalPresence: null,
              voiced: null,
            },
          ],
          energyCurve: [100, 200],
          barStartsMs: [0, 2_000],
        }
      : {},
  );
  const user = userEvent.setup();
  render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{ concubine: profiledTrack }}
    />,
  );

  expect(mockApi).not.toHaveBeenCalledWith(
    "/api/admin/smart-mix/tracks/44/structure",
    expect.anything(),
    undefined,
  );
  await user.click(screen.getByRole("button", { name: "Show audio profile" }));
  // The structure is read when its tab opens, not with the dialog.
  expect(
    mockApi.mock.calls.some(([url]) => String(url).endsWith("/structure")),
  ).toBe(false);
  await user.click(screen.getByRole("tab", { name: "Phrases" }));

  const phrases = await screen.findByRole("list", { name: "Phrases" });
  expect(phrases).toHaveTextContent("body · 16");
});

it("does not request the phrase structure without analysis management", async () => {
  const user = userEvent.setup();
  render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{ concubine: profiledTrack }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Show audio profile" }));

  expect(
    screen.getByRole("dialog", { name: "Concubine · Audio profile" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Phrases" })).toBeNull();
  expect(
    mockApi.mock.calls.some(([url]) => String(url).endsWith("/structure")),
  ).toBe(false);
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

it("keeps the audio profile dialog the same size on every tab", async () => {
  const user = userEvent.setup();
  render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{ concubine: profiledTrack }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Show audio profile" }));

  // A fixed height, not one that follows the open tab; the body scrolls instead
  // and keeps the scrollbar's room so the width does not jump either.
  expect(document.querySelector('[data-app-modal-panel="true"]')).toHaveClass(
    "h-[min(56rem,calc(100dvh-2rem))]",
  );
  expect(
    document.querySelector('[data-slot="audio-profile-scroll"]'),
  ).toHaveClass("[scrollbar-gutter:stable]");
});

const STEMS_URL = "/api/smart-mix/tracks/44/stems";

function stemsResponse(changes: Record<string, unknown> = {}) {
  return {
    trackId: 44,
    trackEntityUid: "track-uid",
    durationMs: 79_000,
    sourceRevision: "a".repeat(64),
    profileAnalyzedAt: null,
    sourceStaleAt: null,
    vocalDetector: null,
    phrases: [],
    analyses: [],
    stems: null,
    job: null,
    file: null,
    playlists: [],
    ...changes,
  };
}

it("the stems tab appears only with stem data", async () => {
  let response: Record<string, unknown> = stemsResponse();
  mockApi.mockImplementation(async (url) =>
    String(url) === STEMS_URL ? response : {},
  );
  const user = userEvent.setup();
  const { unmount } = render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{ concubine: profiledTrack }}
    />,
  );

  // Read when the dialog opens, for every user: the tab list depends on it.
  expect(mockApi.mock.calls.some(([url]) => String(url) === STEMS_URL)).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: "Show audio profile" }));
  await waitFor(() =>
    expect(mockApi.mock.calls.some(([url]) => String(url) === STEMS_URL)).toBe(
      true,
    ),
  );
  expect(screen.queryByRole("tab", { name: "Stems" })).toBeNull();
  unmount();

  // A job the server is running is enough.
  response = stemsResponse({
    job: {
      state: "analyzing",
      attempts: 1,
      maxAttempts: 3,
      requestedAt: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      secondsPerTrack: 240,
    },
  });
  render(
    <TrackTable
      tracks={[track]}
      artist="Converge"
      analysisData={{ concubine: profiledTrack }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Show audio profile" }));
  const tab = await screen.findByRole("tab", { name: "Stems" });
  const names = screen.getAllByRole("tab").map((entry) => entry.textContent);
  // After the phrases, before provenance.
  expect(names.indexOf("Stems")).toBe(names.indexOf("Provenance") - 1);
  await user.click(tab);
  expect(
    await screen.findByText("Separating on the server"),
  ).toBeInTheDocument();
});
