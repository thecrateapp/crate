import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { UpcomingItem } from "./upcoming-model";
import { I18nProvider } from "@/i18n";
import {
  formatShowTimeRemaining,
  showDirectionsUrl,
  UpcomingShowExpandedView,
} from "./UpcomingShowCardViews";

const showItem: UpcomingItem = {
  id: 42,
  event_key: "show-42",
  type: "show",
  date: "2026-07-03",
  time: "20:00",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  title: "Circolo Magnolia",
  subtitle: "Segrate, Italy",
  cover_url: null,
  status: "onsale",
  is_upcoming: true,
  url: "https://tickets.example/converge",
  venue: "Circolo Magnolia",
  address_line1: "Via Circonvallazione Idroscalo, 41",
  city: "Segrate",
  region: "Milano",
  postal_code: "20054",
  country: "Italy",
  latitude: 45.463,
  longitude: 9.278,
  genres: ["hardcore", "mathcore", "metalcore"],
  probable_setlist: [{ title: "Concubine" }],
  user_attending: true,
};

describe("UpcomingShowExpandedView", () => {
  it("summarizes distance to show date", () => {
    expect(
      formatShowTimeRemaining(showItem, new Date("2026-06-13T10:00:00")),
    ).toBe("20 days to go");
  });

  it("builds directions links from coordinates", () => {
    expect(showDirectionsUrl(showItem, "google")).toContain(
      "google.com/maps/dir/?api=1&destination=45.463%2C9.278",
    );
  });

  it("renders the ticket header, directions and genre pills", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T10:00:00"));

    try {
      render(
        <MemoryRouter>
          <I18nProvider initialLocale="en">
            <UpcomingShowExpandedView
              item={showItem}
              attending
              savingAttendance={false}
              playingSetlist={false}
              onToggleAttendance={vi.fn()}
              onPlaySetlist={vi.fn()}
              onClose={vi.fn()}
              showClose={false}
            />
          </I18nProvider>
        </MemoryRouter>,
      );
    } finally {
      vi.useRealTimers();
    }

    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(screen.getByText(/\d+ days? to go/i)).toHaveClass(
      "text-accent-action-hi",
    );
    const venueLine = screen.getByText("Circolo Magnolia").closest("p");
    expect(venueLine).toHaveClass("font-mono", "uppercase");
    expect(venueLine).toHaveTextContent(
      "Circolo Magnolia · Via Circonvallazione Idroscalo, 41 20054 · Segrate, Milano, Italy",
    );
    expect(screen.getByTitle("hardcore")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute(
      "href",
      expect.stringContaining("maps"),
    );
  });

  function renderTicket(item: UpcomingItem) {
    return render(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <UpcomingShowExpandedView
            item={item}
            attending={false}
            savingAttendance={false}
            playingSetlist={false}
            onToggleAttendance={vi.fn()}
            onPlaySetlist={vi.fn()}
            onClose={vi.fn()}
            showClose={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );
  }

  it("cuts the notches out of two stacked stubs instead of painting circles", () => {
    const { container } = renderTicket(showItem);

    const top = container.querySelector(".setlist-ticket-top");
    const bottom = container.querySelector(".setlist-ticket-bottom");
    const perforation = container.querySelector(".setlist-ticket-perforation");
    expect(top).toBeInTheDocument();
    expect(bottom).toBeInTheDocument();
    expect(top?.nextElementSibling).toBe(perforation);
    expect(perforation?.nextElementSibling).toBe(bottom);
    expect(perforation).toHaveAttribute("aria-hidden", "true");
    expect(
      container.querySelector(".rounded-full.bg-surface-canvas"),
    ).toBeNull();
  });

  it("renders setlist rows in order and keeps row nodes across refetches", () => {
    const first: UpcomingItem = {
      ...showItem,
      probable_setlist: [
        { title: "Concubine" },
        { title: "Dark Horse" },
        { title: "Concubine" },
      ],
    };
    const { rerender } = renderTicket(first);
    const list = screen.getByRole("list", { name: "Probable Setlist" });
    const before = within(list).getAllByRole("listitem");
    expect(before.map((row) => row.textContent)).toEqual([
      "01Concubine",
      "02Dark Horse",
      "03Concubine",
    ]);
    before.forEach((row) => expect(row).toHaveClass("setlist-ticket-row"));

    rerender(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <UpcomingShowExpandedView
            item={{
              ...first,
              probable_setlist: [
                { title: "Concubine", frequency: 0.9 },
                { title: "Dark Horse", frequency: 0.8 },
                { title: "Concubine" },
              ],
            }}
            attending={false}
            savingAttendance={false}
            playingSetlist={false}
            onToggleAttendance={vi.fn()}
            onPlaySetlist={vi.fn()}
            onClose={vi.fn()}
            showClose={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );
    const after = within(
      screen.getByRole("list", { name: "Probable Setlist" }),
    ).getAllByRole("listitem");
    after.forEach((row, index) => expect(row).toBe(before[index]));
  });

  it("staggers the setlist entrance in CSS and turns it off for reduced motion", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    const rowRule = css.match(/\.setlist-ticket-row \{([^}]*)\}/)?.[1] ?? "";

    expect(rowRule).toContain("animation-name: setlist-ticket-row-in");
    expect(rowRule).toContain("animation-fill-mode: backwards");
    expect(rowRule).not.toMatch(/opacity|animation:/);
    expect(css).toContain(
      ".setlist-ticket-row:nth-child(2) {\n  animation-delay: 355ms;",
    );
    expect(css).toMatch(
      /\[data-crate-motion="reduced"\] \.setlist-ticket-row \{\s*animation: none;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.setlist-ticket-row \{\s*animation: none;/,
    );
    expect(css).toContain("-webkit-mask:");
  });
});
