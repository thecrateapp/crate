import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refetchMock, useApiMock, toastMock, hasCapabilityMock } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    refetchMock: vi.fn(),
    useApiMock: vi.fn(),
    toastMock: { error: vi.fn(), success: vi.fn() },
    hasCapabilityMock: vi.fn(),
  }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasCapability: hasCapabilityMock }),
}));

import {
  SmartMixPlaylists,
  duration,
  gib,
  type AdminSmartMixPlaylist,
  type AdminSmartMixPlaylists,
} from "./SmartMixPlaylists";

const GIB = 1024 ** 3;
const zero = { pending: 0, analyzing: 0, ready: 0, failed: 0 };

function playlist(
  changes: Partial<AdminSmartMixPlaylist>,
): AdminSmartMixPlaylist {
  return {
    playlistId: 41,
    name: "Warehouse 03:00",
    owner: { id: 2, username: "diego.rin" },
    enabled: true,
    enabledAt: "2026-11-06T10:00:00Z",
    disabledAt: null,
    lastUsedAt: "2026-11-09T01:41:00Z",
    total: 48,
    counts: { pending: 5, analyzing: 1, ready: 41, failed: 1 },
    estimatedSecondsLeft: 1_440,
    failures: [
      {
        trackId: 7,
        title: "Assimilate",
        artist: "Skinny Puppy",
        attempts: 3,
        lastError: "ffmpeg could not decode Assimilate.flac",
        finishedAt: "2026-11-09T00:47:00Z",
      },
    ],
    fileBytes: 1.9 * GIB,
    files: 41,
    ...changes,
  };
}

const LISTING: AdminSmartMixPlaylists = {
  playlists: [
    playlist({}),
    playlist({
      playlistId: 42,
      name: "Cold Waves B2B",
      owner: { id: 3, username: "lucia.ggc" },
      total: 118,
      counts: { ...zero, ready: 118 },
      estimatedSecondsLeft: null,
      failures: [],
      fileBytes: 4.6 * GIB,
    }),
    playlist({
      playlistId: 28,
      name: "PARA EL COCHE",
      owner: { id: 4, username: "rustifari" },
      enabled: false,
      disabledAt: "2026-11-02T10:00:00Z",
      total: 52,
      counts: zero,
      estimatedSecondsLeft: null,
      failures: [],
      fileBytes: 2.1 * GIB,
    }),
  ],
  overview: {
    playlistsOn: 2,
    playlistsOff: 1,
    tracks: 166,
    counts: { pending: 5, analyzing: 1, ready: 159, failed: 1 },
    estimatedSecondsLeft: 1_440,
    secondsPerTrack: 240,
    serverSeparator: "htdemucs-onnx-1",
    storage: { usedBytes: 21.4 * GIB, files: 512, evictableBytes: 2.1 * GIB },
    settings: {
      maxTracksPerPlaylist: 300,
      maxTracksPerUser: null,
      quotaGib: 50,
      uploadsEnabled: true,
    },
  },
};

const STATUS = {
  tracks: [
    {
      trackId: 7,
      title: "Assimilate",
      artist: "Skinny Puppy",
      state: "failed",
      attempts: 3,
      startedAt: null,
      finishedAt: "2026-11-09T00:47:00Z",
      lastError: "ffmpeg could not decode Assimilate.flac",
    },
    {
      trackId: 8,
      title: "Pain",
      artist: "Boy Harsher",
      state: "ready",
      attempts: 1,
      startedAt: null,
      finishedAt: "2026-11-09T02:14:00Z",
      lastError: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  hasCapabilityMock.mockImplementation(() => true);
  useApiMock.mockImplementation((url: string | null) =>
    url === "/api/admin/smart-mix/playlists"
      ? { data: LISTING, loading: false, error: null, refetch: refetchMock }
      : url?.startsWith("/api/smart-mix/playlists/")
        ? { data: STATUS, loading: false, error: null, refetch: vi.fn() }
        : { data: null, loading: false, error: null, refetch: vi.fn() },
  );
  apiMock.mockResolvedValue({});
});

describe("SmartMixPlaylists", () => {
  it("shows the overview, the quota and every playlist's stem work", () => {
    render(<SmartMixPlaylists />);

    expect(screen.getByText("Smart Mix playlists")).toBeInTheDocument();
    expect(screen.getByText("96% ready")).toBeInTheDocument();
    expect(screen.getByText("2 on · 1 off")).toBeInTheDocument();
    expect(screen.getByText("htdemucs-onnx-1")).toBeInTheDocument();
    expect(screen.getByText("≈ 24 min queued")).toBeInTheDocument();
    expect(screen.getByText("21.4 of 50 GiB")).toBeInTheDocument();
    expect(
      screen.getByText(/^2\.1 GiB belong only to playlists turned off/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^512 files on the music volume/),
    ).toBeInTheDocument();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const warehouse = within(rows[0]!);
    expect(warehouse.getByText("diego.rin · 48 tracks")).toBeInTheDocument();
    expect(warehouse.getByText("41 / 48 ready")).toBeInTheDocument();
    expect(warehouse.getByText("1 separating")).toBeInTheDocument();
    expect(warehouse.getByText("5 pending")).toBeInTheDocument();
    // Failures in the warning tone: red is only for confirmations.
    expect(warehouse.getByText("1 failed")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(warehouse.getByText("≈ 24 min left")).toBeInTheDocument();
    expect(
      warehouse.getByText(
        "Assimilate · ffmpeg could not decode Assimilate.flac",
      ),
    ).toHaveClass("text-state-warning-text");
    expect(warehouse.getByText("1.9 GiB")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Done")).toBeInTheDocument();
    const off = within(rows[2]!);
    expect(off.getByText("Off")).toBeInTheDocument();
    expect(off.getByText("Analyses kept, files evictable")).toBeInTheDocument();
  });

  it("filters by state and searches playlist or owner", async () => {
    const user = userEvent.setup();
    render(<SmartMixPlaylists />);

    expect(
      screen.getByRole("radio", { name: "In progress · 1" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Off · 1" }));
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(1);
    expect(screen.getByText("PARA EL COCHE")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "All · 3" }));
    await user.type(
      screen.getByRole("searchbox", { name: "Search playlists" }),
      "lucia",
    );
    await waitFor(() =>
      expect(screen.getAllByRole("row").slice(1)).toHaveLength(1),
    );
    expect(screen.getByText("Cold Waves B2B")).toBeInTheDocument();
  });

  it("saves the stem settings for settings managers", async () => {
    const user = userEvent.setup();
    render(<SmartMixPlaylists />);

    const perUser = screen.getByLabelText("Tracks per user");
    await user.type(perUser, "900");
    await user.click(
      screen.getByRole("switch", { name: "Crate Decks uploads" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save stem settings" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/settings/smart-mix", "PUT", {
        stem_max_tracks_per_playlist: 300,
        stem_max_tracks_per_user: 900,
        stem_quota_gib: 50,
        stem_uploads_enabled: false,
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith("Stem settings saved");
    expect(refetchMock).toHaveBeenCalled();
  });

  it("refuses invalid settings and keeps them read-only without settings.manage", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SmartMixPlaylists />);
    const perPlaylist = screen.getByLabelText("Tracks per playlist");
    await user.clear(perPlaylist);
    await user.type(perPlaylist, "0");
    await user.click(
      screen.getByRole("button", { name: "Save stem settings" }),
    );
    expect(apiMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("Check the stem settings");
    unmount();

    hasCapabilityMock.mockImplementation(
      (capability: string) => capability !== "settings.manage",
    );
    render(<SmartMixPlaylists />);
    expect(screen.getByLabelText("Tracks per playlist")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save stem settings" }),
    ).toBeDisabled();
  });

  it("opens a playlist's track states", async () => {
    const user = userEvent.setup();
    render(<SmartMixPlaylists />);

    await user.click(
      screen.getByRole("button", { name: "Track states of Warehouse 03:00" }),
    );

    expect(useApiMock).toHaveBeenCalledWith("/api/smart-mix/playlists/41");
    const dialog = await screen.findByRole("dialog", {
      name: "Warehouse 03:00 · Track states",
    });
    expect(within(dialog).getByText("Assimilate")).toBeInTheDocument();
    expect(within(dialog).getByText("Failed")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(
      within(dialog).getByText("ffmpeg could not decode Assimilate.flac"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Ready")).toBeInTheDocument();
  });

  it("formats sizes and estimates", () => {
    expect(gib(1.94 * GIB)).toBe("1.9 GiB");
    expect(duration(1_440)).toBe("≈ 24 min");
    expect(duration(16_080)).toBe("≈ 4 h 28 min");
  });
});
