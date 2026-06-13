import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(),
  };
});

import { api, ApiError } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { SearchResults } from "./SearchResults";

describe("SearchResults", () => {
  it("shows a helpful empty state when no music matches the query", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=imaginary-band",
    });

    await waitFor(() => {
      expect(screen.getByText("No music found")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Try another artist, album, or track."),
    ).toBeInTheDocument();
  });

  it("shows an error state instead of no results when search fails", async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(401, "Not authenticated"));

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=high-vis",
    });

    await waitFor(() => {
      expect(screen.getByText("Search unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("No music found")).not.toBeInTheDocument();
  });
});
