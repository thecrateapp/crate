import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmStatus } = vi.hoisted(() => ({
  llmStatus: {
    available: true,
    model: "gemini-test",
    provider: "gemini",
  },
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ playlistId: "42" }),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: () => llmStatus,
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

function mockRule(op: string, value: number | number[], field = "year") {
  const surface = structuredClone(editorSurface);
  const smartRules = {
    ...surface.playlist.smart_rules,
    rules: [{ field, op, value }],
    max_per_artist: 3,
    deduplicate_artist: true,
  };
  const yearSurface = {
    ...surface,
    playlist: { ...surface.playlist, smart_rules: smartRules },
  };
  mockUseApi.mockImplementation((url: string | null) => ({
    data: url?.includes("/editor-snapshot") ? yearSurface : null,
    error: null,
    loading: false,
    refetch: vi.fn(),
  }));
  vi.mocked(api).mockResolvedValue({
    total_matching: 0,
    tracks: [],
    genre_distribution: {},
    artist_distribution: {},
    format_distribution: {},
    duration_total_sec: 0,
    avg_year: null,
    year_range: null,
  } as never);
}

describe("PlaylistEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llmStatus.available = true;
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
      screen.getByRole("searchbox", { name: "Search tracks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Suggest refinements/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add rule")).toBeInTheDocument();
    expect(screen.getByText("generated")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload cover" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Cover image")).toHaveAttribute(
      "accept",
      "image/*",
    );
  });

  it("saves metadata without resubmitting unchanged legacy year rules", async () => {
    mockRule("gte", 2000);
    render(<PlaylistEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    const call = vi.mocked(api).mock.calls[0];
    if (!call) throw new Error("Metadata save did not issue a request");
    const [url, method, body] = call;
    expect(url).toBe("/api/admin/system-playlists/42");
    expect(method).toBe("PUT");
    expect(body).toMatchObject({
      name: "Screamo Core",
      auto_refresh_enabled: true,
    });
    expect(body).not.toHaveProperty("smart_rules");
  });

  it.each([
    { op: "gte", value: 2000, expected: "2000" },
    { op: "between", value: [2000, 2020], expected: ["2000", "2020"] },
  ])(
    "previews legacy $op years as text while preserving rule options",
    async ({ op, value, expected }) => {
      mockRule(op, value);
      render(<PlaylistEditor />);
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      await waitFor(() =>
        expect(api).toHaveBeenCalledWith(
          "/api/admin/system-playlists/42/preview",
          "POST",
          {
            smart_rules: {
              match: "all",
              limit: 50,
              sort: "random",
              rules: [{ field: "year", op, value: expected }],
              max_per_artist: 3,
              deduplicate_artist: true,
            },
          },
        ),
      );
    },
  );

  it("saves edited year filters as four-digit text", async () => {
    mockRule("gte", 2000);
    render(<PlaylistEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "2030" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "year", op: "gte", value: "2030" }],
            max_per_artist: 3,
          }),
        }),
      ),
    );
  });

  it("keeps edited BPM filters numeric", async () => {
    mockRule("gte", 120, "bpm");
    render(<PlaylistEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "171.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "bpm", op: "gte", value: 171.25 }],
          }),
        }),
      ),
    );
  });

  it("preserves textual year bounds when editing either range endpoint", async () => {
    mockRule("between", [2000, 2020]);
    render(<PlaylistEditor />);
    fireEvent.change(screen.getByRole("textbox", { name: "Minimum" }), {
      target: { value: "1990" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Maximum" }), {
      target: { value: "2030" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/preview",
        "POST",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "year", op: "between", value: ["1990", "2030"] }],
          }),
        }),
      ),
    );
  });

  it("stages AI description copy without applying it and preserves normalized rule options", async () => {
    mockRule("gte", 2000);
    vi.mocked(api).mockResolvedValue({
      description: "Generated editorial copy",
    } as never);
    render(<PlaylistEditor />);

    fireEvent.click(
      screen.getByRole("button", { name: "Generate description with AI" }),
    );

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/ai-description",
        "POST",
        {
          apply: false,
          smart_rules: {
            match: "all",
            limit: 50,
            sort: "random",
            rules: [{ field: "year", op: "gte", value: "2000" }],
            max_per_artist: 3,
            deduplicate_artist: true,
          },
        },
      ),
    );
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Generated editorial copy",
    );
    expect(vi.mocked(api).mock.calls).toHaveLength(1);
  });

  it("hides the AI description action when no model is configured", () => {
    llmStatus.available = false;
    render(<PlaylistEditor />);

    expect(
      screen.queryByRole("button", { name: "Generate description with AI" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeEnabled();
    expect(api).not.toHaveBeenCalled();
  });

  it("applies only server-stored refinement action IDs", async () => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (url.endsWith("/refine")) {
        return {
          proposal_id: "proposal-1",
          editorial_revision: 7,
          summary: "One repeated track",
          issues: [],
          actions: [
            {
              id: "remove:1",
              type: "remove_track",
              label: "Remove duplicate",
              reason: "Repeated",
              position: 1,
              track_id: 1,
            },
          ],
        } as never;
      }
      return { ok: true, applied_count: 1 } as never;
    });
    render(<PlaylistEditor />);
    fireEvent.click(
      screen.getByRole("button", { name: /Suggest refinements/i }),
    );
    await screen.findByText("Editorial refinement proposal");
    fireEvent.click(screen.getByRole("button", { name: /Apply safe fixes/i }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/refine/apply",
        "POST",
        { proposal_id: "proposal-1", action_ids: ["remove:1"] },
      ),
    );
  });
});
