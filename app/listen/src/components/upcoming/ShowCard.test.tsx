import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ShowCard } from "./ShowCard";
import type { UpcomingItem } from "./upcoming-model";
import { useApi } from "@/hooks/use-api";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

const item: UpcomingItem = {
  id: 42,
  event_key: "show-42",
  type: "show",
  date: "2026-09-12",
  time: "20:00",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  title: "The Forum",
  subtitle: "London, United Kingdom",
  cover_url: null,
  status: "onsale",
  is_upcoming: true,
  url: "https://tickets.example/show-42",
  venue: "The Forum",
  city: "London",
  region: "England",
  country: "United Kingdom",
  genres: ["hardcore"],
  probable_setlist: [],
};

describe("ShowCard ticket", () => {
  const setlistItem: UpcomingItem = {
    ...item,
    user_attending: true,
    probable_setlist: [
      { title: "Concubine", position: 1, frequency: 0.92 },
      { title: "Dark Horse", position: 2 },
    ],
  };

  it("renders the expanded show as a flat hairline ticket", () => {
    renderWithListenProviders(
      <ShowCard item={setlistItem} expanded onToggle={vi.fn()} />,
    );

    const article = screen.getByRole("article");
    expect(article).toHaveClass("rounded-panel", "border-transparent");
    expect(article).not.toHaveClass("bg-surface-object");
    expect(article.querySelector(".setlist-ticket-top")).toBeInTheDocument();
    expect(article.className).not.toMatch(/shadow-/);
    expect(screen.getByRole("link", { name: "Converge" })).toHaveClass(
      "font-display",
      "leading-display",
    );
    expect(screen.getByRole("link", { name: "Converge" })).toHaveAttribute(
      "href",
      "/artists/converge",
    );
  });

  it("lists the probable setlist as numbered hairline rows", () => {
    renderWithListenProviders(
      <ShowCard item={setlistItem} variant="feature" />,
    );

    const setlist = screen.getByRole("list", { name: "Probable Setlist" });
    const rows = within(setlist).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("01 Concubine 92%");
    expect(rows[1]).toHaveTextContent(/^02 Dark Horse$/);
    expect(
      screen.getByRole("heading", { level: 3, name: /Probable Setlist/ }),
    ).toHaveTextContent("2 songs");
  });

  it("keeps the setlist play action and attendance status", () => {
    renderWithListenProviders(
      <ShowCard item={setlistItem} variant="feature" />,
    );

    expect(screen.getByRole("button", { name: "Play Setlist" })).toBeEnabled();
    expect(
      screen.getByText("Attending").closest("[data-tone]"),
    ).toHaveAttribute("data-tone", "on");
    expect(screen.getByRole("button", { name: /Going/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("disables the play action when no setlist is known", () => {
    renderWithListenProviders(<ShowCard item={item} variant="feature" />);

    expect(screen.getByRole("button", { name: "Play Setlist" })).toBeDisabled();
    expect(screen.queryByRole("list", { name: "Probable Setlist" })).toBeNull();
  });
});

describe("ShowCard row", () => {
  it("loads actual genre percentages only for an open ticket, preserving zero and source", () => {
    const profile = [
      { name: "hardcore", slug: "hardcore", percent: 0, source: "enrichment" },
    ];
    vi.mocked(useApi).mockReturnValue({
      data: { id: 7, name: "Converge", genre_profile: profile },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { unmount } = renderWithListenProviders(
      <ShowCard item={item} expanded={false} />,
    );
    expect(useApi).toHaveBeenLastCalledWith(null, "GET", undefined, {
      revalidateIfCached: "never",
    });
    unmount();
    renderWithListenProviders(<ShowCard item={item} expanded />);
    expect(useApi).toHaveBeenLastCalledWith(
      "/api/artist-slugs/converge",
      "GET",
      undefined,
      { revalidateIfCached: "never" },
    );
    expect(
      screen.getByText("hardcore").closest(".genre-pill")!,
    ).toBeInTheDocument();
  });

  it("does not fetch or replace a percentage-bearing show profile", () => {
    renderWithListenProviders(
      <ShowCard
        item={{
          ...item,
          genre_profile: [{ name: "hardcore", percent: 83, source: "manual" }],
        }}
        expanded
      />,
    );
    expect(useApi).toHaveBeenLastCalledWith(null, "GET", undefined, {
      revalidateIfCached: "never",
    });
    expect(
      screen.getByText("hardcore").closest(".genre-pill")!,
    ).toBeInTheDocument();
  });

  it("never assigns a cached profile belonging to a different artist", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        id: 99,
        name: "Another artist",
        genre_profile: [{ name: "hardcore", percent: 99 }],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithListenProviders(<ShowCard item={item} expanded />);
    expect(
      screen.getByText("hardcore").closest(".genre-pill")!,
    ).toBeInTheDocument();
    expect(screen.queryByText("99%")).not.toBeInTheDocument();
  });

  it("renders an article with an inner toggle button instead of a button root", () => {
    const onToggle = vi.fn();
    renderWithListenProviders(
      <ShowCard item={item} expanded={false} onToggle={onToggle} />,
    );

    const article = screen.getByRole("article");
    expect(article).not.toHaveAttribute("role", "button");
    const toggle = screen.getByRole("button", { name: /Converge/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("opens the show menu from the more button", () => {
    renderWithListenProviders(
      <ShowCard item={item} expanded={false} onToggle={vi.fn()} />,
    );

    expect(screen.queryByRole("menuitem")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: /Open tickets/ }),
    ).toBeInTheDocument();
  });

  it("opens the show menu with a context click", () => {
    renderWithListenProviders(
      <ShowCard item={item} expanded={false} onToggle={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByRole("article"), {
      clientX: 10,
      clientY: 10,
    });
    expect(
      screen.getByRole("menuitem", { name: /Open artist/ }),
    ).toBeInTheDocument();
  });

  it("opens the show menu with a touch long-press without toggling", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn();
    try {
      renderWithListenProviders(
        <ShowCard item={item} expanded={false} onToggle={onToggle} />,
      );
      const toggle = screen.getByRole("button", { name: /Converge/ });

      fireEvent.pointerDown(toggle, { pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      fireEvent.pointerUp(toggle, { pointerType: "touch" });
      fireEvent.click(toggle);
    } finally {
      vi.useRealTimers();
    }

    expect(
      screen.getByRole("menuitem", { name: /Open tickets/ }),
    ).toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows the more button on expanded preview cards", () => {
    renderWithListenProviders(<ShowCard item={item} variant="preview" />);

    expect(
      screen.queryByRole("button", { name: /close/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More actions" }),
    ).toBeInTheDocument();
  });
});
