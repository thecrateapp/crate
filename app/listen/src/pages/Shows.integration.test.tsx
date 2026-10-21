import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { api } from "@/lib/api";
import { Shows } from "./Shows";
import type { UpcomingItem } from "../components/upcoming/upcoming-types";

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/cache", () => ({
  cacheGet: (url: string) => cache.get(url) ?? null,
  cacheSet: (url: string, data: unknown) => cache.set(url, data),
  onCacheInvalidation: () => () => {},
  onCacheReconnect: () => () => {},
  scopesForUrl: () => [],
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));

const show: UpcomingItem = {
  id: 42,
  event_key: "show-42",
  type: "show",
  date: "2030-01-20",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  title: "The Forum",
  subtitle: "London",
  venue: "The Forum",
  city: "London",
  cover_url: null,
  status: "onsale",
  is_upcoming: true,
  genres: ["hardcore"],
};
function snapshot(attending: boolean) {
  return {
    items: [{ ...show, user_attending: attending }],
    summary: {
      followed_artists: 1,
      show_count: 1,
      release_count: 0,
      attending_count: Number(attending),
      insight_count: 0,
    },
  };
}

describe("Radar with the real cached API hook", () => {
  beforeEach(() => {
    cache.clear();
    vi.mocked(api).mockReset();
  });
  it("honors a genre404 after serving a cached snapshot", async () => {
    cache.set("/api/genres/hardcore?view=genre-detail-v5", {
      name: "hardcore",
      slug: "hardcore",
      shows: [show],
    });
    vi.mocked(api).mockRejectedValue(
      Object.assign(new Error("Genre not found"), { status: 404 }),
    );
    renderWithListenProviders(<Shows />, {
      route: "/upcoming?genre=hardcore",
      path: "/upcoming",
    });
    await waitFor(() =>
      expect(screen.getByText("Genre not found")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: "Converge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Radar summary" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes the authoritative count and featured selection after attendance succeeds", async () => {
    let attending = false;
    vi.mocked(api).mockImplementation(async (path, method) => {
      if (path === "/api/me/upcoming") return snapshot(attending);
      if (path === "/api/me/shows/42/attendance") {
        attending = method === "POST";
        return { ok: true };
      }
      return {
        id: 7,
        name: "Converge",
        genre_profile: [{ name: "hardcore", percent: 83 }],
      };
    });
    renderWithListenProviders(<Shows />);
    const mark = await screen.findByRole("button", {
      name: "Mark as attending",
    });
    expect(screen.queryByText("Next show")).not.toBeInTheDocument();
    fireEvent.click(mark);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Next show" }),
      ).toBeInTheDocument(),
    );
    const summary = screen.getByRole("list", { name: "Radar summary" });
    expect(
      within(summary).getByText("Attending").closest("li"),
    ).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    await waitFor(() =>
      expect(screen.queryByText("Next show")).not.toBeInTheDocument(),
    );
    expect(
      within(summary).getByText("Attending").closest("li"),
    ).toHaveTextContent("0");
  });

  it("reuses actual genre percentages without another request on ticket reopen", async () => {
    vi.mocked(api).mockImplementation(async (path) =>
      path === "/api/me/upcoming"
        ? snapshot(false)
        : {
            id: 7,
            name: "Converge",
            genre_profile: [{ name: "hardcore", percent: 83 }],
          },
    );
    renderWithListenProviders(<Shows />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Converge.*The Forum/ }),
    );
    await screen.findByText("83%");
    fireEvent.click(screen.getByRole("button", { name: "Close show details" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Converge.*The Forum/ }),
    );
    await screen.findByText("83%");
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path === "/api/artist-slugs/converge"),
    ).toHaveLength(1);
  });
});
