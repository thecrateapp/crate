import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ShowCard } from "./ShowCard";
import type { UpcomingItem } from "./upcoming-model";

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

describe("ShowCard surface shadows", () => {
  it("uses semantic accent card shadows for expanded shows", () => {
    renderWithListenProviders(
      <ShowCard item={item} expanded onToggle={vi.fn()} />,
    );

    expect(
      screen.getByText("Converge").closest(".shadow-accent-action-card"),
    ).toHaveClass("shadow-accent-action-card");
  });

  it("uses the stronger semantic shadow for featured expanded shows", () => {
    renderWithListenProviders(<ShowCard item={item} variant="feature" />);

    expect(
      screen
        .getByText("Converge")
        .closest(".shadow-accent-action-card-featured"),
    ).toHaveClass("shadow-accent-action-card-featured");
  });
});

describe("ShowCard row", () => {
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
