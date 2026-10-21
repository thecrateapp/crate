import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { installRadixElementPolyfills } from "@/test/radix-element-polyfills";
import fixture from "../../../../tests/admin-e2e/fixtures/playlist-editor-1aq.json";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({
  useParams: () => ({ playlistId: "42" }),
  useNavigate: () => navigate,
}));
vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/hooks/use-llm", () => ({ useActionLLMStatus: vi.fn() }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(),
  apiSseUrl: (path: string) => path,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useApi } from "@/hooks/use-api";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PlaylistEditor } from "./PlaylistEditor";
const mockApi = vi.mocked(api),
  mockUseApi = vi.mocked(useApi);
let surface: {
  playlist: Record<string, unknown>;
  history: unknown[];
  snapshot: null;
};
let loading = false;
const refetch = vi.fn();
const streams: SampleStream[] = [];
let restoreRadix: () => void;
beforeAll(() => {
  restoreRadix = installRadixElementPolyfills();
});
afterAll(() => restoreRadix());
class SampleStream {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    streams.push(this);
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  streams.length = 0;
  loading = false;
  surface = structuredClone(fixture.surface);
  vi.stubGlobal("EventSource", SampleStream);
  vi.mocked(useActionLLMStatus).mockReturnValue({
    available: true,
  } as ReturnType<typeof useActionLLMStatus>);
  mockUseApi.mockImplementation((url: string | null) => ({
    data: url?.endsWith("editor-snapshot") ? surface : fixture.filterOptions,
    error: null,
    loading: url?.endsWith("editor-snapshot") ? loading : false,
    refetch,
  }));
  mockApi.mockImplementation(async (path) =>
    path.endsWith("/preview")
      ? fixture.preview
      : path.endsWith("/refine")
        ? fixture.proposal
        : path.endsWith("/ai-description")
          ? fixture.description
          : path.includes("track-search?")
            ? { tracks: fixture.candidates, scope: "rules" }
            : path.endsWith("/duplicate")
              ? { id: 99 }
              : fixture.surface.playlist,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlaylistEditor text actions with real consumers", () => {
  it("keeps only marked UX glyphs and names the formerly icon-only removals", () => {
    render(<PlaylistEditor />);
    const disclosures = [
      ...document.querySelectorAll("svg:not([data-admin-ux])"),
    ].filter((glyph) => !glyph.closest("[data-admin-ux]"));
    expect(disclosures).toHaveLength(7);
    for (const glyph of disclosures)
      expect(glyph.closest('[data-slot="select-trigger"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove rule 1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove Marea" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Remove Marea" }).textContent,
    ).toBe("");
    expect(
      screen
        .getByRole("button", { name: "Remove rule 1" })
        .querySelector('svg[data-admin-ux="editor-remove-rule"]'),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Costa de noche" })).toHaveClass(
      "font-display",
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Costa de noche",
    );
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      fixture.surface.playlist.description,
    );
  });

  it("names the four compact header actions and keeps the dirty generation meaning", async () => {
    render(<PlaylistEditor />);
    for (const [name, glyph] of [
      ["Duplicate", "editor-duplicate-action"],
      ["Preview", "editor-preview-action"],
      ["Generate", "editor-generate-action"],
      ["Save changes", "editor-save-action"],
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-size", "icon-lg");
      expect(button).toHaveAttribute("data-variant", "ghost");
      expect(button.textContent).toBe("");
      expect(
        button.querySelector(
          `svg[data-admin-ux="${glyph}"][aria-hidden="true"]`,
        ),
      ).not.toBeNull();
    }
    fireEvent.change(screen.getByRole("spinbutton", { name: "Limit" }), {
      target: { value: "75" },
    });
    expect(
      screen.getByRole("button", { name: "Save + generate" }),
    ).not.toHaveAttribute("title");
  });

  it("uses standard Category, Match and Sort selects with unchanged saved values", async () => {
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    for (const [name, option] of [
      ["Category", "Genre"],
      ["Match", "Any rule"],
      ["Sort", "Popularity"],
    ]) {
      await user.click(screen.getByRole("combobox", { name }));
      await user.click(screen.getByRole("option", { name: option }));
    }
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          category: "genre",
          smart_rules: {
            ...fixture.surface.playlist.smart_rules,
            match: "any",
            sort: "popularity",
          },
        }),
      ),
    );
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "None" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({ category: null }),
      ),
    );
  });

  it("uses a scope Select, accurate placeholder and unchanged scoped search requests", async () => {
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "Search tracks" });
    const scope = screen.getByRole("combobox", { name: "Search scope" });
    expect(scope).toHaveTextContent("Matching rules");
    expect(search).toHaveAttribute(
      "placeholder",
      "Search tracks matching this playlist...",
    );
    await user.click(scope);
    await user.click(screen.getByRole("option", { name: "Entire library" }));
    expect(search).toHaveAttribute("placeholder", "Search library tracks...");
    await user.click(scope);
    await user.click(screen.getByRole("option", { name: "Matching rules" }));
    expect(search).toHaveAttribute(
      "placeholder",
      "Search tracks matching this playlist...",
    );
    await user.type(search, "Bruma");
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/track-search?q=Bruma&scope=rules&limit=12",
      ),
    );
    await user.click(scope);
    await user.click(screen.getByRole("option", { name: "Entire library" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/track-search?q=Bruma&scope=library&limit=12",
      ),
    );
    expect(search).toHaveValue("Bruma");
    expect(search).toHaveAttribute("placeholder", "Search library tracks...");
  });

  it("saves the same metadata and smart-rule payload through named controls", async () => {
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Costa editada",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        {
          name: "Costa editada",
          description: fixture.surface.playlist.description,
          category: "editorial",
          featured_rank: 1,
          is_active: true,
          is_curated: true,
          auto_refresh_enabled: true,
        },
      ),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps simulation separate from persisted tracks and saves dirty rules before generation", async () => {
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("3 matching tracks")).toBeInTheDocument();
    expect(screen.getByText("Marea", { exact: true })).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/preview",
      "POST",
      { smart_rules: fixture.surface.playlist.smart_rules },
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Limit" }), {
      target: { value: "75" },
    });
    await user.click(screen.getByRole("button", { name: "Save + generate" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        {
          smart_rules: { ...fixture.surface.playlist.smart_rules, limit: 75 },
          auto_refresh_enabled: true,
        },
      ),
    );
    expect(
      mockApi.mock.calls.some(([path]) => path.endsWith("/generate")),
    ).toBe(false);
  });

  it("retains clean generation busy state and failure feedback", async () => {
    let reject!: (error: Error) => void;
    mockApi.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/generate",
      "POST",
    );
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generate" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await act(async () => reject(new Error("Sample failure")));
    expect(toast.error).toHaveBeenCalledWith("Failed to enqueue generation");
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("generates description without applying it and keeps refinement review/apply payloads", async () => {
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: "Generate description with AI",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
        fixture.description.description,
      ),
    );
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/ai-description",
      "POST",
      { apply: false, smart_rules: fixture.surface.playlist.smart_rules },
    );
    await user.click(
      screen.getByRole("button", {
        name: "Suggest refinements",
      }),
    );
    expect(
      await screen.findByText(fixture.proposal.summary),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply safe fixes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/refine/apply",
        "POST",
        { proposal_id: "review-proposal-1", action_ids: ["remove-duplicate"] },
      ),
    );
  });

  it("keeps candidate identity, remove positions and drag ordering", async () => {
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Search tracks" }),
      "Bruma",
    );
    await user.click(await screen.findByRole("button", { name: "Add locked" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/tracks",
        "POST",
        {
          tracks: [
            {
              track_id: 12,
              entity_uid: "track:sample-12",
              track_entity_uid: "track:sample-12",
              track_storage_id: "store-12",
              path: "sample/bruma.flac",
              title: "Bruma",
              artist: "Costa Norte",
              album: "Luz de octubre",
              duration: 210,
            },
          ],
        },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Remove Marea" }));
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42/tracks/1",
      "DELETE",
    );
    const rows = document.querySelectorAll("[draggable=true]");
    fireEvent.dragStart(rows[0]!);
    fireEvent.dragOver(rows[1]!);
    fireEvent.drop(rows[1]!);
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/tracks/reorder",
        "POST",
        { track_ids: [2, 1] },
      ),
    );
  });

  it("retains static mode, duplicate/back navigation and unavailable AI", async () => {
    surface.playlist = {
      ...surface.playlist,
      is_smart: false,
      generation_mode: "static",
      smart_rules: null,
    };
    vi.mocked(useActionLLMStatus).mockReturnValue({
      available: false,
    } as ReturnType<typeof useActionLLMStatus>);
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    expect(
      screen.queryByRole("button", { name: "Generate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Suggest refinements",
      }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/playlists/99"));
    await user.click(screen.getByRole("button", { name: "Back to playlists" }));
    expect(navigate).toHaveBeenCalledWith("/playlists");
  });

  it("preserves the identity-bound SSE connection and cleanup", () => {
    const { unmount } = render(<PlaylistEditor />);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.url).toBe("/api/admin/system-playlists/42/stream");
    act(
      () =>
        streams[0]!.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              ...fixture.surface,
              playlist: {
                ...fixture.surface.playlist,
                generation_status: "running",
              },
            }),
          }),
        ),
    );
    expect(screen.getByText("Generating")).toBeInTheDocument();
    expect(streams).toHaveLength(1);
    unmount();
    expect(streams[0]!.close).toHaveBeenCalledOnce();
  });

  it("keeps native cover upload encoding, reset and removal contracts", async () => {
    surface.playlist.cover_data_url = "data:image/png;base64,c2FtcGxl";
    render(<PlaylistEditor />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove cover" }));
    expect(mockApi).toHaveBeenCalledWith(
      "/api/admin/system-playlists/42",
      "PUT",
      { cover_data_url: null },
    );
    const input = screen.getByLabelText("Cover image") as HTMLInputElement;
    await user.upload(
      input,
      new File(["sample"], "sample.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        { cover_data_url: "data:image/png;base64,c2FtcGxl" },
      ),
    );
    await waitFor(() => expect(input.value).toBe(""));
    expect(toast.success).toHaveBeenCalledWith("Cover upload started");
  });

  it("preserves initial loading and missing-snapshot states", () => {
    loading = true;
    const view = render(<PlaylistEditor />);
    expect(
      screen.getByRole("status", {
        name: "Loading playlist editor",
      }),
    ).toBeInTheDocument();
    view.unmount();
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch,
    });
    render(<PlaylistEditor />);
    expect(
      screen.getByText("Playlist not found", { exact: true }),
    ).toBeInTheDocument();
  });
});
