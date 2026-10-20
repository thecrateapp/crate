import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock, toastSuccess } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: toastSuccess },
}));

import { SmartMixTracks } from "./SmartMixTracks";

const counts = {
  totalTracks: 120_000,
  currentProfiles: 100_000,
  outdatedProfiles: 4_000,
  sourceChangedProfiles: 12,
  quality: { unavailable: 300 },
  versions: [
    { analyzerVersion: "smart-mix-audio-v4", profiles: 100_012, current: true },
    { analyzerVersion: "smart-mix-audio-v3", profiles: 4_000, current: false },
  ],
};

function track(trackId: number, overrides: Record<string, unknown> = {}) {
  return {
    trackId,
    title: `Track ${trackId}`,
    artist: "Artist",
    album: "Album",
    status: "current",
    analyzerVersion: "smart-mix-audio-v4",
    quality: "full",
    bpm: 121.3,
    introBpm: 121.0,
    outroBpm: 121.6,
    analyzedAt: "2026-10-19T10:00:00Z",
    processingState: "done",
    processingError: null,
    ...overrides,
  };
}

function lastUrl() {
  return useApiMock.mock.lastCall?.[0] as string;
}

describe("SmartMixTracks", () => {
  beforeEach(() => {
    apiMock.mockReset();
    toastSuccess.mockReset();
    useApiMock.mockReset();
    useApiMock.mockImplementation(() => ({
      data: {
        tracks: [
          track(30),
          track(20, {
            status: "outdated",
            analyzerVersion: "smart-mix-audio-v3",
            introBpm: null,
            outroBpm: null,
          }),
        ],
        nextBefore: 20,
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  it("lists each track with its profile version, status and local tempo", () => {
    render(<SmartMixTracks counts={counts} />);

    expect(screen.getByText("Track 30")).toBeInTheDocument();
    expect(
      screen.getByText("Outdated", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("smart-mix-audio-v3")).toHaveLength(1);
    expect(screen.getByText("121.0 to 121.6")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^Outdated · 4\D?000$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^No profile · 15\D?688$/ }),
    ).toBeInTheDocument();
    expect(lastUrl()).toBe("/api/admin/smart-mix/tracks?status=all");
  });

  it("filters by status and by version", async () => {
    const user = userEvent.setup();
    render(<SmartMixTracks counts={counts} />);

    await user.click(screen.getByRole("tab", { name: /File changed/ }));
    expect(lastUrl()).toBe("/api/admin/smart-mix/tracks?status=source_changed");

    await user.click(
      screen.getByRole("button", { name: /smart-mix-audio-v3 · 4\D?000/ }),
    );
    expect(lastUrl()).toBe(
      "/api/admin/smart-mix/tracks?status=source_changed&version=smart-mix-audio-v3",
    );
  });

  it("only searches from three characters on", async () => {
    const user = userEvent.setup();
    render(<SmartMixTracks counts={counts} />);
    const input = screen.getByRole("textbox", { name: "Search tracks" });

    await user.type(input, "fa");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(lastUrl()).toBe("/api/admin/smart-mix/tracks?status=all");

    await user.type(input, "z");
    await waitFor(() =>
      expect(lastUrl()).toBe("/api/admin/smart-mix/tracks?status=all&q=faz"),
    );
  });

  it("queues a reanalysis for one track", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ taskId: "task-1", status: "queued" });
    render(<SmartMixTracks counts={counts} />);

    const [first] = screen.getAllByRole("button", { name: "Reanalyze track" });
    await user.click(first!);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/smart-mix/tracks/30/reanalyze",
        "POST",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Queued" }),
    ).toBeDisabled();
    expect(toastSuccess).toHaveBeenCalledWith("Smart Mix reanalysis queued");
  });

  it("appends the next page from the cursor", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ tracks: [track(10)], nextBefore: null });
    render(<SmartMixTracks counts={counts} />);

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Track 10")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/smart-mix/tracks?status=all&before=20",
    );
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
