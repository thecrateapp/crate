import { render, screen } from "@testing-library/react";
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

  it("renders directions and genre pills in the expanded card", () => {
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
    expect(screen.getByText(/\d+ days? to go/i)).toBeInTheDocument();
    expect(screen.getByTitle("hardcore")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute(
      "href",
      expect.stringContaining("maps"),
    );
  });
});
