import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { cacheClear } from "@/lib/cache";
import { checkDiscoveryAvailable, startShapedRadio } from "@/lib/radio";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { RadioPage } from "./Radio";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
  };
});

vi.mock("@/lib/radio", () => ({
  checkDiscoveryAvailable: vi.fn(),
  startShapedRadio: vi.fn(),
}));

describe("RadioPage", () => {
  beforeEach(() => {
    cacheClear();
    vi.mocked(api).mockReset();
    vi.mocked(checkDiscoveryAvailable).mockResolvedValue(true);
    vi.mocked(startShapedRadio).mockResolvedValue({
      sessionId: "radio-session-1",
      seedLabel: "hardcore",
      tracks: [],
      source: {
        type: "radio",
        name: "hardcore Radio",
        radio: {
          seedType: "genre",
          seedId: "hardcore",
          shapedSessionId: "radio-session-1",
        },
      },
    });
    vi.mocked(api).mockImplementation(async (url) => {
      if (url === "/api/radio/stations") {
        return {
          artist_stations: [
            {
              type: "artist",
              seed_type: "artist",
              seed_value: "7",
              seed_label: "Converge",
              seed_subtitle: "Artist",
              artist_id: 7,
              artist_name: "Converge",
              title: "Converge Radio",
              subtitle: "",
              play_count: 44,
              minutes_listened: 180,
            },
          ],
          genre_stations: [
            {
              type: "genre",
              seed_type: "genre",
              seed_value: "hardcore",
              seed_label: "hardcore",
              seed_subtitle: "Genre",
              genre_slug: "hardcore",
              genre_name: "hardcore",
              cover_url: "/api/genres/hardcore/cover?size=640&format=webp",
              title: "hardcore Radio",
              subtitle: "",
              play_count: 88,
              minutes_listened: 320,
            },
          ],
        };
      }
      if (url === "/api/genres") return [];
      if (url.startsWith("/api/search")) return { artists: [], albums: [] };
      throw new Error(`Unexpected API call: ${url}`);
    });
  });

  it("renders personalized artist and genre station rails", async () => {
    renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
    });

    expect(await screen.findByText("Converge")).toBeInTheDocument();
    expect(screen.getByText("Artist Stations")).toBeInTheDocument();
    expect(screen.getByText("Genre Stations")).toBeInTheDocument();
    expect(screen.getByText("hardcore")).toBeInTheDocument();
    expect(screen.queryByText("Based on your heavy rotation")).toBeNull();
  });

  it("starts seeded genre radio from a genre station", async () => {
    const playAll = vi.fn();

    renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
      playerActions: { playAll },
    });

    fireEvent.click(await screen.findByRole("button", { name: /hardcore/i }));

    await waitFor(() => {
      expect(startShapedRadio).toHaveBeenCalledWith(
        "seeded",
        "genre",
        "hardcore",
      );
    });
    expect(playAll).toHaveBeenCalled();
  });
});
