import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { releaseSurface } = vi.hoisted(() => ({
  releaseSurface: { releases: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: releaseSurface,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiSseUrl: vi.fn(() => "/api/acquisition/new-releases/stream"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { NewReleases } from "./NewReleases";

describe("NewReleases pagination", () => {
  beforeEach(() => {
    releaseSurface.releases = Array.from({ length: 23 }, (_, index) => ({
      id: index + 1,
      artist_name: `Artist ${index + 1}`,
      album_title: `Album ${index + 1}`,
      tidal_id: `tidal-${index + 1}`,
      tidal_url: "",
      cover_url: "",
      year: "2026",
      release_date: null,
      release_type: "album",
      tracks: 10,
      quality: "",
      status: "detected",
      detected_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      downloaded_at: null,
    }));
    vi.stubGlobal(
      "EventSource",
      class {
        onmessage: ((event: MessageEvent<string>) => void) | null = null;
        close = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates release rows and advances to the remaining results", async () => {
    renderWithAdminProviders(<NewReleases />, { route: "/new-releases" });

    expect(
      await screen.findByRole("article", {
        name: "Album 23 by Artist 23",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Album 3 by Artist 3" }),
    ).toBeNull();
    expect(screen.getByText("1–20 of 23 · page 1 of 2")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Next releases page" }),
    );

    expect(
      await screen.findByRole("article", { name: "Album 3 by Artist 3" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "Album 23 by Artist 23" }),
    ).toBeNull();
    expect(screen.getByText("21–23 of 23 · page 2 of 2")).toBeInTheDocument();
  });
});
