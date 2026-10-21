import { installRadixElementPolyfills } from "@/test/radix-element-polyfills";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ playlistId: "42" }),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: () => ({
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

  it("keeps metadata and actions in the named page identity, with Back outside it", () => {
    render(<PlaylistEditor />);
    const title = screen.getByRole("heading", {
      level: 1,
      name: "Screamo Core",
    });
    const header = title.closest("header");
    expect(header).not.toBeNull();
    expect(header).toHaveAttribute("aria-labelledby", title.id);
    expect(header).toContainElement(screen.getByText("0 followers"));
    expect(header).toContainElement(
      screen.getByRole("button", { name: "Save changes" }),
    );
    expect(header).not.toContainElement(
      screen.getByRole("button", { name: "Back to playlists" }),
    );
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

  it("uses the shared operator select, retains keyboard focus and resets the rule value", async () => {
    mockApi.mockResolvedValue({});
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toHaveTextContent("screamo");
    const operator = screen.getByRole("combobox", { name: "Operator" });
    expect(operator).toHaveTextContent("Contains");
    await user.click(operator);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(operator).toHaveTextContent("Not contains");
    expect(operator).toHaveFocus();
    expect(
      screen.getByRole("combobox", { name: "Select genre" }),
    ).toHaveTextContent("Select genre");
    await user.click(operator);
    await user.keyboard("{Home}{Enter}");
    expect(operator).toHaveTextContent("Equals");
    expect(operator).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "genre", op: "eq", value: "" }],
          }),
        }),
      ),
    );
  });
});

let disposeRadix: () => void;
beforeAll(() => {
  disposeRadix = installRadixElementPolyfills();
});
afterAll(() => disposeRadix());
