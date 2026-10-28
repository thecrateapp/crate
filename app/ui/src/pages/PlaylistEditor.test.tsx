import { installRadixElementPolyfills } from "@/test/radix-element-polyfills";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
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
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    eventSources.push(this);
  }

  close = vi.fn();
}

const eventSources: MockEventSource[] = [];

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
      rules: [
        {
          field: "genre",
          op: "contains",
          value: "screamo" as string | number | (string | number)[],
        },
      ],
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

const previewResult = {
  total_matching: 124,
  tracks: [],
  genre_distribution: {},
  artist_distribution: {},
  format_distribution: {},
  duration_total_sec: 7200,
  avg_year: null,
  year_range: null,
};

const filterOptions = {
  genres: ["screamo"],
  formats: ["flac"],
  keys: [],
  artists: [],
};

function mockSnapshot(
  read: () => {
    data: typeof editorSurface | null;
    error: string | null;
    loading?: boolean;
  },
  refetch = vi.fn(),
) {
  mockUseApi.mockImplementation((url: string | null) => {
    if (url?.includes("/editor-snapshot"))
      return { loading: false, ...read(), refetch };
    return {
      data: url === "/api/playlists/filter-options" ? filterOptions : null,
      error: null,
      loading: false,
      refetch: vi.fn(),
    };
  });
  return refetch;
}

function sendSnapshot(surface: typeof editorSurface) {
  act(() => {
    eventSources[0]?.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(surface) }),
    );
  });
}

describe("PlaylistEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.mockReset();
    eventSources.length = 0;
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

  it("uses shared accent captions for editor sections and generation history", () => {
    const withHistory = {
      ...editorSurface,
      history: [
        {
          id: 1,
          status: "completed",
          started_at: "2026-10-20T12:00:00Z",
          triggered_by: "manual",
          track_count: 2,
          duration_sec: 3,
          error: null,
        },
      ],
    };
    mockUseApi.mockImplementation((url: string | null) => ({
      data: url?.includes("/editor-snapshot")
        ? withHistory
        : { genres: [], formats: [], keys: [], artists: [] },
      error: null,
      loading: false,
      refetch: vi.fn(),
    }));
    render(<PlaylistEditor />);
    for (const name of [
      "Editorial data",
      "Smart rules",
      "Tracks",
      "Generation history",
    ]) {
      expect(screen.getByRole("heading", { name })).toHaveClass(
        "crate-mono-label",
        "text-accent-action-hi",
      );
    }
    expect(
      screen.queryByRole("heading", { name: "Status" }),
    ).not.toBeInTheDocument();
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
      screen.getByRole("searchbox", { name: "Search tracks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Suggest refinements/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add rule")).toBeInTheDocument();
    expect(screen.getByText("generated")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Automatic album collage. Image changes apply immediately.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Playlist tracks" })).toBeVisible();
    expect(
      screen.getByRole("group", {
        name: "Rule 1: Genre CONTAINS screamo",
      }),
    ).toBeVisible();
    const removeRule = screen.getByRole("button", { name: "Remove rule 1" });
    expect(removeRule).not.toHaveAttribute("title");
    expect(removeRule.closest("fieldset")).toBe(
      screen.getByRole("group", { name: "Rule 1" }),
    );
    expect(removeRule.closest("[data-slot='card']")).toBeNull();
    expect(screen.getByRole("region", { name: "Smart rules" })).toHaveAttribute(
      "data-slot",
      "instrument-panel",
    );
    expect(
      screen.getByRole("status", { name: "Playlist generation progress" }),
    ).toBeVisible();
  });

  it("uses the preview endpoint count as the primary matching-track readout", async () => {
    mockApi.mockImplementation(async (url: string) => {
      if (url.endsWith("/preview")) {
        return {
          total_matching: 124,
          tracks: [],
          genre_distribution: {},
          artist_distribution: {},
          format_distribution: {},
          duration_total_sec: 7200,
          avg_year: null,
          year_range: null,
        };
      }
      return {};
    });
    render(<PlaylistEditor />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("124")).toBeVisible();
    expect(screen.getByText("Matching tracks")).toBeVisible();
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/preview",
      "POST",
      expect.objectContaining({ smart_rules: expect.any(Object) }),
    );
  });

  it("updates the generation phase from the reconnectable playlist stream", async () => {
    render(<PlaylistEditor />);
    const source = eventSources[0];
    expect(source?.url).toBe("/api/admin/system-playlists/42/stream");

    const runningSurface = structuredClone(editorSurface);
    runningSurface.playlist.generation_status = "running";
    act(() => {
      source?.onopen?.();
      source?.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify(runningSurface) }),
      );
    });

    expect(
      await screen.findByRole("status", {
        name: "Playlist generation progress",
      }),
    ).toHaveTextContent("Generating");
    expect(
      screen.getByRole("status", { name: "Playlist generation progress" }),
    ).toHaveTextContent("Live updates");
  });

  it("keeps an inline busy chip visible while AI description generation is pending", async () => {
    let resolveDescription: ((value: { description: string }) => void) | null =
      null;
    mockApi.mockImplementation((url: string) => {
      if (url.endsWith("/ai-description")) {
        return new Promise((resolve) => {
          resolveDescription = resolve;
        });
      }
      return Promise.resolve({});
    });
    render(<PlaylistEditor />);
    await userEvent.click(
      screen.getByRole("button", { name: "Generate description with AI" }),
    );
    const busyChip = document.querySelector("[data-ai-description-busy]");
    expect(busyChip).toBeVisible();
    expect(busyChip).toHaveTextContent("Generating");

    await act(async () => {
      resolveDescription?.({ description: "Generated description" });
    });
    expect(document.querySelector("[data-ai-description-busy]")).toBeNull();
  });

  it("uses the shared operator select, retains keyboard focus and resets the rule value", async () => {
    mockApi.mockResolvedValue({});
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    expect(screen.getByRole("combobox", { name: "Value" })).toHaveTextContent(
      "screamo",
    );
    const operator = screen.getByRole("combobox", { name: "Operator" });
    expect(operator).toHaveTextContent("Contains");
    await user.click(operator);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(operator).toHaveTextContent("Not contains");
    expect(operator).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Value" })).toHaveTextContent(
      "Select genre",
    );
    await user.click(operator);
    await user.keyboard("{Home}{Enter}");
    expect(operator).toHaveTextContent("Equals");
    expect(operator).toHaveFocus();
    await user.click(screen.getByRole("combobox", { name: "Value" }));
    await user.click(screen.getByRole("option", { name: "screamo" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            rules: [{ field: "genre", op: "eq", value: "screamo" }],
          }),
        }),
      ),
    );
  });

  it("preserves dirty editorial and rule drafts across SSE and refetched snapshots", async () => {
    const user = userEvent.setup();
    let snapshot = structuredClone(editorSurface);
    mockSnapshot(() => ({ data: snapshot, error: null }));
    const view = render(<PlaylistEditor />);
    const description = screen.getByRole("textbox", { name: "Description" });
    const limit = screen.getByRole("textbox", { name: "Limit" });
    await user.clear(description);
    await user.type(description, "Pending editorial copy");
    await user.clear(limit);
    await user.type(limit, "70");

    const streamed = structuredClone(editorSurface);
    streamed.playlist.name = "Updated by stream";
    streamed.playlist.description = "Server copy from stream";
    streamed.playlist.smart_rules.limit = 88;
    sendSnapshot(streamed);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Updated by stream",
    );
    expect(description).toHaveValue("Pending editorial copy");
    expect(limit).toHaveValue("70");

    snapshot = structuredClone(editorSurface);
    snapshot.playlist.name = "Updated by refetch";
    snapshot.playlist.description = "Server copy from refetch";
    snapshot.playlist.smart_rules.limit = 100;
    view.rerender(<PlaylistEditor />);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Updated by refetch",
    );
    expect(description).toHaveValue("Pending editorial copy");
    expect(limit).toHaveValue("70");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(eventSources).toHaveLength(1);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("invalidates the preview when the selection limit changes and requires a fresh preview before generating it", async () => {
    const user = userEvent.setup();
    mockApi.mockResolvedValue(previewResult);
    render(<PlaylistEditor />);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const preview = await screen.findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("Current rules")).toBeVisible();
    expect(
      within(preview).getByRole("button", { name: "Generate current rules" }),
    ).toBeEnabled();

    const limit = screen.getByRole("textbox", { name: "Limit" });
    await user.clear(limit);
    await user.type(limit, "60");

    expect(within(preview).getByText("Out of date")).toBeVisible();
    const generate = within(preview).getByRole("button", {
      name: "Generate current rules",
    });
    expect(generate).toBeDisabled();
    await user.click(generate);
    expect(mockApi).toHaveBeenCalledTimes(1);

    await user.click(
      within(preview).getByRole("button", { name: "Update preview" }),
    );
    expect(mockApi).toHaveBeenLastCalledWith(
      "/api/admin/system-playlists/42/preview",
      "POST",
      { smart_rules: expect.objectContaining({ limit: 60 }) },
    );
    expect(within(preview).getByText("Current rules")).toBeVisible();
    expect(
      within(preview).getByRole("button", { name: "Generate current rules" }),
    ).toBeEnabled();
  });

  it("compares a pending preview against the rules actually submitted rather than newer edits", async () => {
    const user = userEvent.setup();
    let finish!: (value: typeof previewResult) => void;
    mockApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<PlaylistEditor />);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/preview",
      "POST",
      { smart_rules: expect.objectContaining({ limit: 50 }) },
    );

    const limit = screen.getByRole("textbox", { name: "Limit" });
    await user.clear(limit);
    await user.type(limit, "65");
    await act(async () => {
      finish(previewResult);
    });

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByText("124")).toBeVisible();
    expect(within(preview).getByText("Out of date")).toBeVisible();
    expect(
      within(preview).getByRole("button", { name: "Generate current rules" }),
    ).toBeDisabled();
    expect(limit).toHaveValue("65");
  });

  it("generates changed rules without saving or discarding pending editorial data", async () => {
    const user = userEvent.setup();
    let snapshot = structuredClone(editorSurface);
    const refetch = vi.fn();
    mockSnapshot(() => ({ data: snapshot, error: null }), refetch);
    mockApi.mockResolvedValue({});
    const view = render(<PlaylistEditor />);
    const description = screen.getByRole("textbox", { name: "Description" });
    await user.clear(description);
    await user.type(description, "Keep this editorial draft");
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Pending name");
    const rank = screen.getByRole("textbox", { name: "Featured rank" });
    await user.type(rank, "9");
    const limit = screen.getByRole("textbox", { name: "Limit" });
    await user.clear(limit);
    await user.type(limit, "80");

    await user.click(
      screen.getByRole("button", { name: "Save rules + generate" }),
    );

    expect(mockApi).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/system-playlists/42",
      "PUT",
      {
        auto_refresh_enabled: true,
        smart_rules: expect.objectContaining({
          limit: 80,
          rules: [{ field: "genre", op: "contains", value: "screamo" }],
        }),
      },
    );
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(description).toHaveValue("Keep this editorial draft");
    expect(name).toHaveValue("Pending name");
    expect(rank).toHaveValue("9");
    expect(screen.getByText("Unsaved changes")).toBeVisible();

    snapshot = structuredClone(editorSurface);
    snapshot.playlist.smart_rules.limit = 80;
    snapshot.playlist.generation_status = "queued";
    view.rerender(<PlaylistEditor />);
    expect(description).toHaveValue("Keep this editorial draft");
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("does not acknowledge rule edits made while generation is being saved", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    mockApi.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<PlaylistEditor />);
    const limit = screen.getByRole("textbox", { name: "Limit" });
    await user.clear(limit);
    await user.type(limit, "70");
    await user.click(
      screen.getByRole("button", { name: "Save rules + generate" }),
    );
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({ limit: 70 }),
        }),
      ),
    );
    await user.clear(limit);
    await user.type(limit, "90");
    await act(async () => {
      finish();
    });

    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42",
      "PUT",
      expect.objectContaining({
        smart_rules: expect.objectContaining({ limit: 70 }),
      }),
    );
    expect(limit).toHaveValue("90");
    expect(
      screen.getByRole("button", { name: "Save rules + generate" }),
    ).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("presents an initial transport error with Retry and recovers into the editor", async () => {
    const user = userEvent.setup();
    let data: typeof editorSurface | null = null;
    let error: string | null = "Offline";
    const refetch = mockSnapshot(() => ({ data, error }));
    const view = render(<PlaylistEditor />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the playlist editor.",
    );
    expect(screen.queryByText("Playlist not found")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);

    data = editorSurface;
    error = null;
    view.rerender(<PlaylistEditor />);
    expect(
      screen.getByRole("heading", { name: "Screamo Core", level: 1 }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a missing-playlist state only after a successful response with no playlist", () => {
    mockSnapshot(() => ({ data: null, error: null }));
    render(<PlaylistEditor />);
    expect(screen.getByText("Playlist not found")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to playlists" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("distinguishes track-search failures from no results and retries the same query", async () => {
    const user = userEvent.setup();
    mockApi
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ tracks: [] });
    render(<PlaylistEditor />);
    await user.type(
      screen.getByRole("searchbox", { name: "Search tracks" }),
      "Echo",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not search tracks. Try again.",
    );
    expect(
      screen.queryByText("No candidate tracks found in this scope."),
    ).not.toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/system-playlists/42/track-search?q=Echo&scope=rules&limit=12",
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("No candidate tracks found in this scope."),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(mockApi).toHaveBeenLastCalledWith(
      "/api/admin/system-playlists/42/track-search?q=Echo&scope=rules&limit=12",
    );
    expect(
      screen.getByRole("searchbox", { name: "Search tracks" }),
    ).toHaveValue("Echo");
  });

  it("retains partial rank and limit text until validation and attaches inline errors to their fields", async () => {
    const user = userEvent.setup();
    mockApi.mockResolvedValue({});
    render(<PlaylistEditor />);
    const rank = screen.getByRole("textbox", { name: "Featured rank" });
    const limit = screen.getByRole("textbox", { name: "Limit" });
    await user.type(rank, "1e");
    await user.clear(limit);
    await user.type(limit, "-");
    expect(rank).toHaveValue("1e");
    expect(limit).toHaveValue("-");
    expect(rank).not.toHaveAttribute("aria-invalid");
    expect(limit).not.toHaveAttribute("aria-invalid");
    expect(mockApi).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mockApi).not.toHaveBeenCalled();
    expect(rank).toHaveAttribute("aria-invalid", "true");
    expect(rank).toHaveAccessibleDescription(
      "Enter a whole number or leave this blank.",
    );
    expect(limit).toHaveAttribute("aria-invalid", "true");
    expect(limit).toHaveAccessibleDescription(
      "1–500 tracks Enter a whole number from 1 to 500.",
    );
    expect(rank).toHaveValue("1e");
    expect(limit).toHaveValue("-");

    await user.clear(rank);
    await user.type(rank, "0");
    await user.clear(limit);
    await user.type(limit, "25");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mockApi).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/system-playlists/42",
      "PUT",
      expect.objectContaining({
        featured_rank: 0,
        smart_rules: expect.objectContaining({ limit: 25 }),
      }),
    );
  });

  it("keeps partial numeric rule ranges as text and serializes only after valid submission", async () => {
    const user = userEvent.setup();
    const numeric = structuredClone(editorSurface);
    numeric.playlist.smart_rules.rules = [
      { field: "bpm", op: "between", value: [100, 120] },
    ];
    mockSnapshot(() => ({ data: numeric, error: null }));
    mockApi.mockResolvedValue(previewResult);
    render(<PlaylistEditor />);
    const minimum = screen.getByRole("textbox", { name: "Minimum" });
    const maximum = screen.getByRole("textbox", { name: "Maximum" });
    await user.clear(minimum);
    await user.type(minimum, "-");
    await user.clear(maximum);
    expect(minimum).toHaveValue("-");
    expect(maximum).toHaveValue("");
    expect(mockApi).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(mockApi).not.toHaveBeenCalled();
    expect(minimum).toHaveAttribute("aria-invalid", "true");
    expect(maximum).toHaveAttribute("aria-invalid", "true");
    expect(minimum).toHaveAccessibleDescription("Enter a finite number.");
    expect(maximum).toHaveAccessibleDescription("Enter a finite number.");

    await user.clear(minimum);
    await user.type(minimum, "99.5");
    await user.type(maximum, "120.5");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(mockApi).toHaveBeenCalledExactlyOnceWith(
      "/api/admin/system-playlists/42/preview",
      "POST",
      {
        smart_rules: expect.objectContaining({
          rules: [{ field: "bpm", op: "between", value: [99.5, 120.5] }],
        }),
      },
    );
    expect(minimum).toHaveValue("99.5");
    expect(maximum).toHaveValue("120.5");
  });

  it.each(["remove", "reorder"] as const)(
    "keeps the track list intact and avoids a success announcement after a failed %s",
    async (action) => {
      const user = userEvent.setup();
      const snapshot = structuredClone(editorSurface);
      snapshot.playlist.tracks.push({
        ...snapshot.playlist.tracks[0]!,
        id: 2,
        title: "Second",
      });
      mockSnapshot(() => ({ data: snapshot, error: null }));
      mockApi.mockRejectedValue(new Error("Offline"));
      render(<PlaylistEditor />);
      const list = screen.getByRole("list", { name: "Playlist tracks" });
      const status = within(list.parentElement!).getByRole("status");

      await user.click(
        screen.getByRole("button", {
          name:
            action === "remove"
              ? "Remove First, position 1"
              : "Move First down, position 1",
        }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The track list could not be updated. Try again.",
      );
      expect(status).toBeEmptyDOMElement();
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((row) => row.getAttribute("data-playlist-entry-id")),
      ).toEqual(["1", "2"]);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        action === "remove"
          ? "Failed to remove track"
          : "Failed to reorder tracks",
      );
      if (action === "remove") {
        expect(mockApi).toHaveBeenCalledExactlyOnceWith(
          "/api/admin/system-playlists/42/tracks/1",
          "DELETE",
        );
      } else {
        expect(mockApi).toHaveBeenCalledExactlyOnceWith(
          "/api/admin/system-playlists/42/tracks/reorder",
          "POST",
          { track_ids: [2, 1] },
        );
      }
    },
  );
});

let disposeRadix: () => void;
beforeAll(() => {
  disposeRadix = installRadixElementPolyfills();
});
afterAll(() => disposeRadix());
