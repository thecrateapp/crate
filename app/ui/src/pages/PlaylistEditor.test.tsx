import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const mockApi = vi.mocked(api);

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
      screen.getByRole("button", { name: /Refine tracklist with AI/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add rule")).toBeInTheDocument();
    expect(screen.getByText("generated")).toBeInTheDocument();
    expect(
      screen.getByText(/Upload a clean image-only hero asset/i),
    ).toBeInTheDocument();
  });

  it("keeps operator focus across consecutive arrow changes and resets the rule value", async () => {
    mockApi.mockResolvedValue({});
    render(<PlaylistEditor />);
    const genre = screen.getByRole("combobox", { name: "Select genre" });
    expect(genre).toHaveTextContent("screamo");
    const operator = () => screen.getByRole("radiogroup", { name: "Operator" });
    await userEvent.click(
      within(operator()).getByRole("radio", { name: "Contains" }),
    );

    await userEvent.keyboard("{ArrowRight}");
    const notContains = within(operator()).getByRole("radio", {
      name: "Not contains",
    });
    expect(notContains).toHaveAttribute("aria-checked", "true");
    expect(notContains).toHaveFocus();
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toHaveTextContent("Select genre");

    await userEvent.keyboard("{ArrowRight}");
    const equals = within(operator()).getByRole("radio", { name: "Equals" });
    expect(equals).toHaveAttribute("aria-checked", "true");
    expect(equals).toHaveFocus();
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toHaveTextContent("Select genre");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "genre", op: "eq", value: "" }],
          }),
        }),
      );
    });
  });
});
