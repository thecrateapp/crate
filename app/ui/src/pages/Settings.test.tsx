import { renderWithAdminProviders as render } from "@/test/render-with-admin-providers";
import { screen, waitFor } from "@testing-library/react";
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

let pathStatus: {
  available: boolean;
  status: "configured" | "unavailable" | "legacy";
  model_id: string | null;
  error_code: string | null;
} | null = {
  available: true,
  status: "configured",
  model_id: "paths-model",
  error_code: null,
};

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: () => pathStatus,
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";

import { resetTaskCatalogForTests } from "@/lib/task-catalog";
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
    resetTaskCatalogForTests();
    pathStatus = {
      available: true,
      status: "configured",
      model_id: "paths-model",
      error_code: null,
    };
    useApiMock.mockReturnValue({
      data: settingsData,
      loading: false,
      refetch: refetchMock,
    });
  });

  it("shows one AI refinement state after setup", async () => {
    const user = userEvent.setup();

    render(<Settings />);

    await user.click(
      screen.getAllByRole("button", { name: /enrichment/i })[0]!,
    );

    expect(
      screen.getByText(/AI refinement: On · uses paths-model/),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: /manage in ai models/i });
    expect(link).toHaveAttribute("href", "/ai");
    expect(
      screen.queryByRole("switch", { name: /ai refinement/i }),
    ).not.toBeInTheDocument();
  });

  it("shows AI refinement as off when its feature is turned off", async () => {
    const user = userEvent.setup();
    pathStatus = {
      available: false,
      status: "unavailable",
      model_id: null,
      error_code: "AI_ACTION_DISABLED",
    };

    render(<Settings />);

    await user.click(
      screen.getAllByRole("button", { name: /enrichment/i })[0]!,
    );

    expect(screen.getByText(/AI refinement: Off/)).toBeVisible();
  });

  it("keeps the server-settings toggle before setup", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ ok: true });
    pathStatus = {
      available: true,
      status: "legacy",
      model_id: "paths-model",
      error_code: null,
    };

    render(<Settings />);

    await user.click(
      screen.getAllByRole("button", { name: /enrichment/i })[0]!,
    );
    await user.click(screen.getByRole("switch", { name: /ai refinement/i }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/settings/paths", "PUT", {
        llm_refinement_enabled: false,
      });
    });
    expect(refetchMock).toHaveBeenCalled();
    expect(
      screen.getByText(/Uses paths-model from server settings/),
    ).toBeVisible();
  });

  it("links the server-settings state to AI models for AI readers", async () => {
    const user = userEvent.setup();
    pathStatus = {
      available: true,
      status: "legacy",
      model_id: "paths-model",
      error_code: null,
    };

    render(<Settings />);

    await user.click(
      screen.getAllByRole("button", { name: /enrichment/i })[0]!,
    );

    expect(
      screen.getByRole("link", { name: "Manage in AI models" }),
    ).toHaveAttribute("href", "/ai");
  });

  it("names AI models without a link before setup when AI settings are not readable", async () => {
    const user = userEvent.setup();
    pathStatus = {
      available: true,
      status: "legacy",
      model_id: "paths-model",
      error_code: null,
    };

    render(<Settings />, {
      auth: { hasCapability: (cap) => cap !== "ai.config.read" },
    });

    await user.click(
      screen.getAllByRole("button", { name: /enrichment/i })[0]!,
    );

    expect(screen.getByText("Manage in AI models")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Manage in AI models" }),
    ).not.toBeInTheDocument();
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

  it("runs a schedule now with its catalog label", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/admin/task-catalog") {
        return {
          categories: {},
          types: [
            {
              type: "library_sync",
              label: "Library Scan",
              category: "library",
            },
          ],
          actions: [],
        };
      }
      if (path.startsWith("/api/worker/schedules/")) {
        return { status: "already_queued" };
      }
      return { ok: true };
    });

    render(<Settings />);

    await user.click(screen.getAllByRole("button", { name: /schedules/i })[0]!);
    await user.click(
      await screen.findByRole("button", { name: "Run Library Scan now" }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/worker/schedules/library_sync/run",
        "POST",
      );
    });
    expect(toast.info).toHaveBeenCalledWith("Library Scan is already queued");
  });
});
