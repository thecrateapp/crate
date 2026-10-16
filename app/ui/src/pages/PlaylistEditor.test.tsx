import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ playlistId: "42" }),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/hooks/use-llm", () => ({
  useLLMStatus: () => ({
    available: true,
    model: "gemini-test",
    provider: "gemini",
  }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(),
  apiSseUrl: (path: string) => path,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { PlaylistEditor } from "./PlaylistEditor";

const mockUseApi = vi.mocked(useApi);

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public readonly url: string) {}

  close = vi.fn();
}

const editorSurface = {
  playlist: {
    id: 42,
    name: "Screamo Core",
    description: "Editorial draft",
    generation_mode: "smart",
    is_smart: true,
    is_active: true,
    is_curated: true,
    auto_refresh_enabled: true,
    category: "genre",
    featured_rank: null,
    track_count: 2,
    total_duration: 360,
    follower_count: 0,
    smart_rules: {
      match: "all",
      limit: 50,
      sort: "random",
      rules: [{ field: "genre", op: "contains", value: "screamo" }],
    },
    generation_status: "idle",
    generation_error: null,
    last_generated_at: null,
    cover_data_url: null,
    tracks: [
      {
        id: 1,
        track_id: 10,
        title: "First",
        artist: "Artist A",
        album: "Album A",
        duration: 180,
        source: "generated",
        locked: false,
      },
    ],
  },
  history: [],
};

describe("PlaylistEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("EventSource", MockEventSource);
    mockUseApi.mockImplementation((url: string | null) => {
      if (url?.includes("/editor-snapshot")) {
        return {
          data: editorSurface,
          error: null,
          loading: false,
          refetch: vi.fn(),
        };
      }
      if (url === "/api/playlists/filter-options") {
        return {
          data: {
            genres: ["screamo"],
            formats: ["flac"],
            keys: [],
            artists: [],
          },
          error: null,
          loading: false,
          refetch: vi.fn(),
        };
      }
      return { data: null, error: null, loading: false, refetch: vi.fn() };
    });
  });

  it("renders the curator track search and AI refinement controls", () => {
    render(<PlaylistEditor />);

    expect(
      screen.getByPlaceholderText("Search tracks matching this playlist..."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Suggest refinements/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add rule")).toBeInTheDocument();
    expect(screen.getByText("generated")).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a clean image-only hero asset/i),
    ).toBeInTheDocument();
  });

  it("applies only server-stored refinement action IDs", async () => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (url.endsWith("/refine")) {
        return {
          proposal_id: "proposal-1",
          editorial_revision: 7,
          summary: "One repeated track",
          issues: [],
          actions: [{ id: "remove:1", type: "remove_track", label: "Remove duplicate", reason: "Repeated", position: 1, track_id: 1 }],
        } as never;
      }
      return { ok: true, applied_count: 1 } as never;
    });
    render(<PlaylistEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Suggest refinements/i }));
    await screen.findByText("Editorial refinement proposal");
    fireEvent.click(screen.getByRole("button", { name: /Apply safe fixes/i }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/refine/apply", "POST",
      { proposal_id: "proposal-1", action_ids: ["remove:1"] },
    ));
  });
});
