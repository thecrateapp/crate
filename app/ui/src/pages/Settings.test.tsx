import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refetchMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  refetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/contexts/OpsSnapshotContext", () => ({
  useOpsSnapshot: () => ({ data: null }),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { Settings } from "./Settings";

const settingsData = {
  schedules: {
    library_sync: 3600,
    enrich_artists: 0,
  },
  worker: { max_workers: 5 },
  enrichment: {
    lastfm: true,
    spotify: true,
    fanart: true,
    setlistfm: true,
    musicbrainz: true,
  },
  db_stats: {
    library_tracks: { size: 1024, rows: 120 },
  },
  library: {
    path: "/music",
    storage_layout: "v2-uuid",
    audio_extensions: [".flac", ".mp3"],
  },
  processing: {
    mb_auto_apply_threshold: 95,
    enrichment_min_age_hours: 24,
    max_track_popularity: 50,
  },
  paths: {
    llm_refinement_enabled: true,
    llm_refinement_cache_ttl_hours: 168,
  },
  telegram: {
    enabled: false,
    bot_token: "",
    chat_id: "",
    has_token: false,
  },
  about: {
    version: "dev",
    git_commit: "abcdef123",
    python: "3.13",
    uptime_seconds: 600,
    artists: 10,
    albums: 20,
    tracks: 120,
    total_size_gb: 1.2,
  },
};

describe("Settings", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: settingsData,
      loading: false,
      refetch: refetchMock,
    });
  });

  it("saves the Music Paths LLM refinement toggle", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ ok: true });

    render(<Settings />);

    await user.click(
      screen.getAllByRole("button", { name: /enrichment/i })[0]!,
    );
    await user.click(screen.getByRole("switch", { name: /llm refinement/i }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/settings/paths", "PUT", {
        llm_refinement_enabled: false,
      });
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("exposes a targeted Music Paths AI cache clear action", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ ok: true });

    render(<Settings />);

    await user.click(screen.getAllByRole("button", { name: /storage/i })[0]!);
    await user.click(screen.getByRole("button", { name: /music paths ai/i }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/settings/cache/clear",
        "POST",
        {
          type: "paths_llm",
        },
      );
    });
  });
});
