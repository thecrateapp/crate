import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../tests/admin-e2e/fixtures/playlist-editor-1aq.json";

vi.mock("react-router", () => ({
  useParams: () => ({ playlistId: "42" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: () => ({ available: false }),
}));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(),
  apiSseUrl: (path: string) => path,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { PlaylistEditor } from "./PlaylistEditor";

const mockApi = vi.mocked(api);
let supported: boolean;
let snapshotLoading: boolean;
let surface: typeof fixture.surface;
const refetch = vi.fn();
class MockEventSource {
  close = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("EventSource", MockEventSource);
  supported = true;
  snapshotLoading = false;
  surface = structuredClone(fixture.surface);
  vi.mocked(useApi).mockImplementation((url: string | null) => ({
    data: url?.endsWith("editor-snapshot")
      ? snapshotLoading
        ? null
        : surface
      : url === "/api/capabilities"
        ? { smart_mix: { available: supported } }
        : fixture.filterOptions,
    loading: url?.endsWith("editor-snapshot") ? snapshotLoading : false,
    error: null,
    refetch,
  }));
  mockApi.mockImplementation(async (path) =>
    path.endsWith("/preview") ? fixture.preview : surface.playlist,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function savedFullProfile() {
  Object.assign(surface.playlist.smart_rules, {
    require_full_mix_profile: true,
  });
}

describe("PlaylistEditor Full Smart Mix requirement", () => {
  it("keeps saved-rule search as the default when the first smart snapshot arrives", () => {
    snapshotLoading = true;
    const view = render(<PlaylistEditor />);
    expect(
      screen.queryByRole("combobox", { name: "Search scope" }),
    ).not.toBeInTheDocument();
    snapshotLoading = false;
    view.rerender(<PlaylistEditor />);
    expect(
      screen.getByRole("combobox", { name: "Search scope" }),
    ).toHaveTextContent("Matching rules");
    expect(
      screen.getByRole("combobox", { name: "Search scope" }),
    ).toHaveAccessibleDescription(/Uses saved rules/);
  });

  it("offers the requirement within Smart rules and previews the same condition", async () => {
    render(<PlaylistEditor />);
    const toggle = screen.getByRole("switch", {
      name: "Full Smart Mix profile only",
    });
    expect(toggle).not.toBeChecked();
    expect(toggle.closest("section")).toContainElement(
      screen.getByRole("heading", { name: "Smart rules" }),
    );
    expect(toggle).toHaveAccessibleDescription(
      /Manually added and locked tracks are preserved/,
    );
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42/preview",
        "POST",
        {
          smart_rules: expect.objectContaining({
            require_full_mix_profile: true,
          }),
        },
      ),
    );
  });

  it("saves the requirement when it is the only changed rule setting", async () => {
    render(<PlaylistEditor />);
    await userEvent.click(
      screen.getByRole("switch", { name: "Full Smart Mix profile only" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            require_full_mix_profile: true,
          }),
        }),
      ),
    );
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("generates from the new requirement without saving pending editorial copy", async () => {
    render(<PlaylistEditor />);
    const description = screen.getByRole("textbox", { name: "Description" });
    await userEvent.clear(description);
    await userEvent.type(description, "Keep my pending copy");
    await userEvent.click(
      screen.getByRole("switch", { name: "Full Smart Mix profile only" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save rules + generate" }),
    );
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        {
          smart_rules: expect.objectContaining({
            require_full_mix_profile: true,
          }),
          auto_refresh_enabled: true,
        },
      ),
    );
    expect(mockApi).not.toHaveBeenCalledWith(
      expect.stringContaining("/generate"),
      "POST",
    );
    expect(description).toHaveValue("Keep my pending copy");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("persists false when disabling an existing requirement", async () => {
    savedFullProfile();
    render(<PlaylistEditor />);
    const toggle = screen.getByRole("switch", {
      name: "Full Smart Mix profile only",
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            require_full_mix_profile: false,
          }),
        }),
      ),
    );
  });

  it("prevents preview actions from competing with a pending global save", async () => {
    let finishSave!: () => void;
    mockApi.mockImplementation(async (path, method) => {
      if (path.endsWith("/preview")) return fixture.preview;
      if (method === "PUT")
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
      return surface.playlist;
    });
    render(<PlaylistEditor />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("button", { name: "Generate current rules" });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.any(Object),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Generate current rules" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Recalculate preview" }),
    ).toBeDisabled();
    await act(async () => {
      finishSave();
    });
    expect(
      screen.getByRole("button", { name: "Generate current rules" }),
    ).toBeEnabled();
  });

  it("marks the existing preview stale when the requirement changes", async () => {
    render(<PlaylistEditor />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("button", { name: "Generate current rules" });
    await userEvent.click(
      screen.getByRole("switch", { name: "Full Smart Mix profile only" }),
    );
    expect(screen.getByText("Out of date")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Generate current rules" }),
    ).toBeDisabled();
  });

  it("hides the control without support and preserves a saved requirement", async () => {
    supported = false;
    savedFullProfile();
    render(<PlaylistEditor />);
    expect(
      screen.queryByRole("switch", { name: "Full Smart Mix profile only" }),
    ).not.toBeInTheDocument();
    const limit = screen.getByRole("textbox", { name: "Limit" });
    await userEvent.clear(limit);
    await userEvent.type(limit, "80");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/api/admin/system-playlists/42",
        "PUT",
        expect.objectContaining({
          smart_rules: expect.objectContaining({
            limit: 80,
            require_full_mix_profile: true,
          }),
        }),
      ),
    );
  });

  it("does not offer generation requirements on static playlists", async () => {
    Object.assign(surface.playlist, {
      is_smart: false,
      generation_mode: "static",
      smart_rules: null,
    });
    await act(async () => {
      render(<PlaylistEditor />);
    });
    expect(
      screen.queryByRole("switch", { name: "Full Smart Mix profile only" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Smart rules" }),
    ).not.toBeInTheDocument();
  });
});
